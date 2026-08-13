import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type AuditEvent } from '../../generated/prisma/client';
import {
  AuditEventFilters,
  AuditEventPage,
  AuditEventRecord,
  AuditOverviewMetrics,
  AuditScope,
  clampAuditLimit,
  clampAuditOffset,
  resolveAuditResourceType,
  resolveAuditResult,
} from './audit-events';

const auditActionPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const maximumAuditActionLength = 128;
const auditScanBatchSize = 500;

type AuditOverviewAggregateRow = {
  date: string;
  result: 'success' | 'failed';
  resourceType: AuditEventRecord['resourceType'];
  total: bigint | number;
};

type RawAuditEventRow = Omit<AuditEvent, 'createdAt'> & {
  createdAt: Date | string;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(filters: AuditEventFilters = {}): Promise<AuditEventPage> {
    this.validateFilters(filters);
    const limit = clampAuditLimit(filters.limit);
    const offset = clampAuditOffset(filters.offset);
    const scope = this.resolveScope(filters);
    const snapshotAt = new Date();
    const generatedAt = snapshotAt.toISOString();
    const actionFilter = this.resolveActionFilter(
      filters.action,
      filters.resourceType,
    );
    if (actionFilter === null) {
      return this.emptyPage(scope, generatedAt, limit, offset);
    }

    const where = this.buildWhere(filters, scope, actionFilter, snapshotAt);
    const orderBy = this.resolveOrderBy(filters);
    const items: AuditEventRecord[] = [];
    const actors = new Set<AuditEventRecord['actor']>();
    const actions = new Set<string>();
    let success = 0;
    let failed = 0;
    let total = 0;
    let cursor: AuditEvent | undefined;

    while (true) {
      const rows = await this.prisma.auditEvent.findMany({
        where: cursor
          ? { AND: [where, this.resolveKeysetWhere(cursor, filters)] }
          : where,
        orderBy,
        take: auditScanBatchSize,
      });
      for (const row of rows) {
        const event = this.mapRow(row);
        if (!this.matchesServiceFilters(event, filters)) continue;
        actors.add(event.actor);
        actions.add(event.action);
        if (event.result === 'failed') failed += 1;
        else success += 1;
        if (total >= offset && items.length < limit) items.push(event);
        total += 1;
      }
      if (rows.length < auditScanBatchSize) break;
      cursor = rows.at(-1);
    }

    return {
      items,
      total,
      limit,
      offset,
      facets: {
        actors: [...actors].sort(),
        actions: [...actions].sort(),
      },
      summary: { success, failed },
      scope,
      generatedAt,
    };
  }

  async getOverviewMetrics(
    filters: AuditEventFilters,
  ): Promise<AuditOverviewMetrics> {
    this.validateFilters(filters);
    const scope = this.resolveScope(filters);
    const createdFrom = this.parseDate(filters.createdFrom, 'createdFrom');
    const createdTo = this.parseDate(filters.createdTo, 'createdTo');
    if (!createdFrom || !createdTo) {
      throw new BadRequestException(
        'createdFrom and createdTo are required for overview metrics',
      );
    }
    if (createdFrom > createdTo) {
      throw new BadRequestException('createdFrom must not be after createdTo');
    }

    const [aggregateRows, riskRows] = await Promise.all([
      this.queryOverviewAggregates(scope, createdFrom, createdTo),
      this.queryRecentRiskEvents(scope, createdFrom, createdTo),
    ]);
    const daily = new Map<string, { total: number; failed: number }>();
    const resources = new Map<AuditEventRecord['resourceType'], number>();
    let total = 0;
    let failed = 0;
    for (const row of aggregateRows) {
      const count = Number(row.total);
      total += count;
      if (row.result === 'failed') failed += count;
      const day = daily.get(row.date) ?? { total: 0, failed: 0 };
      day.total += count;
      if (row.result === 'failed') day.failed += count;
      daily.set(row.date, day);
      resources.set(
        row.resourceType,
        (resources.get(row.resourceType) ?? 0) + count,
      );
    }

    return {
      total,
      failed,
      dailyTrend: [...daily.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, counts]) => ({ date, ...counts })),
      resourceDistribution: [...resources.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([resourceType, resourceTotal]) => ({
          resourceType,
          total: resourceTotal,
        })),
      recentRiskEvents: riskRows.map((row) => this.mapRawRow(row)),
    };
  }

  private queryOverviewAggregates(
    scope: AuditScope,
    createdFrom: Date,
    createdTo: Date,
  ) {
    const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : null;
    if (this.prisma.isSqlite()) {
      return this.prisma.$queryRaw<AuditOverviewAggregateRow[]>`
        select
          date,
          result,
          resource_type as resourceType,
          count(*) as total
        from (
          select
            substr(created_at, 1, 10) as date,
            case
              when lower(trim(case
                when json_type(metadata, '$.result') = 'text'
                  then json_extract(metadata, '$.result')
                when json_type(metadata, '$.status') = 'text'
                  then json_extract(metadata, '$.status')
                else ''
              end, char(9) || char(10) || char(11) || char(12) || char(13)
                || char(32) || char(160) || char(5760) || char(8192)
                || char(8193) || char(8194) || char(8195) || char(8196)
                || char(8197) || char(8198) || char(8199) || char(8200)
                || char(8201) || char(8202) || char(8232) || char(8233)
                || char(8239) || char(8287) || char(12288) || char(65279)))
                in ('failed', 'failure', 'error', 'denied', 'rejected', 'locked')
                or json_type(metadata, '$.success') in ('false')
                or action glob '*failed'
                or action glob '*failure'
                or action glob '*blocked'
                or action glob '*denied'
                or action glob '*rejected'
                or action glob '*locked'
                or action glob '*rate_limited'
              then 'failed'
              else 'success'
            end as result,
            case
              when action glob 'file.*' then 'file'
              when action glob 'share.*' then 'share'
              when action glob 'transfer.*' then 'transfer'
              else 'system'
            end as resource_type
          from audit_events
          where created_at >= ${createdFrom}
            and created_at <= ${createdTo}
            and (${scope.kind !== 'workspace'} or workspace_id = ${workspaceId})
            and (${scope.kind !== 'system'} or workspace_id is null)
        ) classified
        group by date, result, resource_type
      `;
    }

    return this.prisma.$queryRaw<AuditOverviewAggregateRow[]>`
      select
        date,
        result,
        resource_type as "resourceType",
        count(*)::bigint as total
      from (
        select
          to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as date,
          case
            when lower(btrim(case
              when jsonb_typeof(metadata->'result') = 'string'
                then metadata->>'result'
              when jsonb_typeof(metadata->'status') = 'string'
                then metadata->>'status'
              else ''
            end, chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
              || chr(32) || chr(160) || chr(5760) || chr(8192)
              || chr(8193) || chr(8194) || chr(8195) || chr(8196)
              || chr(8197) || chr(8198) || chr(8199) || chr(8200)
              || chr(8201) || chr(8202) || chr(8232) || chr(8233)
              || chr(8239) || chr(8287) || chr(12288) || chr(65279)))
              in ('failed', 'failure', 'error', 'denied', 'rejected', 'locked')
              or metadata->'success' = 'false'::jsonb
              or action ~ '(failed|failure|blocked|denied|rejected|locked|rate_limited)$'
            then 'failed'
            else 'success'
          end as result,
          case
            when action like 'file.%' then 'file'
            when action like 'share.%' then 'share'
            when action like 'transfer.%' then 'transfer'
            else 'system'
          end as resource_type
        from audit_events
        where created_at >= ${createdFrom}
          and created_at <= ${createdTo}
          and (${scope.kind !== 'workspace'} or workspace_id = ${workspaceId})
          and (${scope.kind !== 'system'} or workspace_id is null)
      ) classified
      group by date, result, resource_type
    `;
  }

  private queryRecentRiskEvents(
    scope: AuditScope,
    createdFrom: Date,
    createdTo: Date,
  ) {
    const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : null;
    if (this.prisma.isSqlite()) {
      return this.prisma.$queryRaw<RawAuditEventRow[]>`
        select
          id,
          action,
          actor,
          target,
          workspace_id as workspaceId,
          share_token as shareToken,
          node_id as nodeId,
          metadata,
          created_at as createdAt
        from audit_events
        where created_at >= ${createdFrom}
          and created_at <= ${createdTo}
          and (${scope.kind !== 'workspace'} or workspace_id = ${workspaceId})
          and (${scope.kind !== 'system'} or workspace_id is null)
          and (
            lower(trim(case
              when json_type(metadata, '$.result') = 'text'
                then json_extract(metadata, '$.result')
              when json_type(metadata, '$.status') = 'text'
                then json_extract(metadata, '$.status')
              else ''
            end, char(9) || char(10) || char(11) || char(12) || char(13)
              || char(32) || char(160) || char(5760) || char(8192)
              || char(8193) || char(8194) || char(8195) || char(8196)
              || char(8197) || char(8198) || char(8199) || char(8200)
              || char(8201) || char(8202) || char(8232) || char(8233)
              || char(8239) || char(8287) || char(12288) || char(65279)))
              in ('failed', 'failure', 'error', 'denied', 'rejected', 'locked')
            or json_type(metadata, '$.success') in ('false')
            or action glob '*failed'
            or action glob '*failure'
            or action glob '*blocked'
            or action glob '*denied'
            or action glob '*rejected'
            or action glob '*locked'
            or action glob '*rate_limited'
            or action glob '*permanently_deleted'
            or action glob '*trash_cleaned'
            or action glob '*quota_updated'
            or action glob '*policy_updated'
            or action glob '*share.revoked'
          )
        order by created_at desc, id desc
        limit 10
      `;
    }

    return this.prisma.$queryRaw<RawAuditEventRow[]>`
      select
        id,
        action,
        actor,
        target,
        workspace_id as "workspaceId",
        share_token as "shareToken",
        node_id as "nodeId",
        metadata,
        created_at as "createdAt"
      from audit_events
      where created_at >= ${createdFrom}
        and created_at <= ${createdTo}
        and (${scope.kind !== 'workspace'} or workspace_id = ${workspaceId})
        and (${scope.kind !== 'system'} or workspace_id is null)
        and (
          lower(btrim(case
            when jsonb_typeof(metadata->'result') = 'string'
              then metadata->>'result'
            when jsonb_typeof(metadata->'status') = 'string'
              then metadata->>'status'
            else ''
          end, chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
            || chr(32) || chr(160) || chr(5760) || chr(8192)
            || chr(8193) || chr(8194) || chr(8195) || chr(8196)
            || chr(8197) || chr(8198) || chr(8199) || chr(8200)
            || chr(8201) || chr(8202) || chr(8232) || chr(8233)
            || chr(8239) || chr(8287) || chr(12288) || chr(65279)))
            in ('failed', 'failure', 'error', 'denied', 'rejected', 'locked')
          or metadata->'success' = 'false'::jsonb
          or action ~ '(failed|failure|blocked|denied|rejected|locked|rate_limited)$'
          or action ~ '(permanently_deleted|trash_cleaned|quota_updated|policy_updated)$'
          or action like '%share.revoked'
        )
      order by created_at desc, id desc
      limit 10
    `;
  }

  private buildWhere(
    filters: AuditEventFilters,
    scope: AuditScope,
    actionFilter: Prisma.StringFilter | string | undefined,
    snapshotAt?: Date,
  ): Prisma.AuditEventWhereInput {
    const where: Prisma.AuditEventWhereInput = {};
    if (actionFilter !== undefined) where.action = actionFilter;
    if (scope.kind === 'workspace') where.workspaceId = scope.workspaceId;
    if (scope.kind === 'system') where.workspaceId = null;
    if (filters.shareToken) where.shareToken = filters.shareToken;
    if (filters.nodeId) where.nodeId = filters.nodeId;
    if (filters.actor) where.actor = filters.actor;

    const createdFrom = this.parseDate(filters.createdFrom, 'createdFrom');
    const createdTo = this.parseDate(filters.createdTo, 'createdTo');
    if (createdFrom && createdTo && createdFrom > createdTo) {
      throw new BadRequestException('createdFrom must not be after createdTo');
    }
    const effectiveCreatedTo =
      snapshotAt && (!createdTo || snapshotAt < createdTo)
        ? snapshotAt
        : createdTo;
    if (createdFrom || effectiveCreatedTo) {
      where.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(effectiveCreatedTo ? { lte: effectiveCreatedTo } : {}),
      };
    }
    return where;
  }

  private resolveScope(filters: AuditEventFilters): AuditScope {
    const workspaceId = filters.workspaceId?.trim();
    if (workspaceId && filters.scope && filters.scope !== 'workspace') {
      throw new BadRequestException(
        'workspaceId can only be combined with workspace scope',
      );
    }
    if (filters.scope === 'workspace' && !workspaceId) {
      throw new BadRequestException(
        'workspaceId is required for workspace scope',
      );
    }
    if (workspaceId) return { kind: 'workspace', workspaceId };
    if (filters.scope === 'system') return { kind: 'system' };
    return { kind: 'all' };
  }

  private parseDate(value: string | undefined, field: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return date;
  }

  private resolveOrderBy(
    filters: AuditEventFilters,
  ): Prisma.AuditEventOrderByWithRelationInput[] {
    const sortBy = ['createdAt', 'action', 'actor'].includes(
      filters.sortBy ?? '',
    )
      ? (filters.sortBy ?? 'createdAt')
      : 'createdAt';
    const direction = filters.sortDirection === 'asc' ? 'asc' : 'desc';
    const primary = {
      [sortBy]: direction,
    } as Prisma.AuditEventOrderByWithRelationInput;
    if (sortBy === 'createdAt') return [primary, { id: direction }];
    return [primary, { createdAt: 'desc' }, { id: 'desc' }];
  }

  private resolveKeysetWhere(
    cursor: AuditEvent,
    filters: AuditEventFilters,
  ): Prisma.AuditEventWhereInput {
    const sortBy = filters.sortBy ?? 'createdAt';
    const direction = filters.sortDirection === 'asc' ? 'asc' : 'desc';
    if (sortBy === 'createdAt') {
      const comparison = direction === 'asc' ? 'gt' : 'lt';
      return {
        OR: [
          { createdAt: { [comparison]: cursor.createdAt } },
          {
            createdAt: cursor.createdAt,
            id: { [comparison]: cursor.id },
          },
        ],
      };
    }

    const value = sortBy === 'action' ? cursor.action : cursor.actor;
    const comparison = direction === 'asc' ? 'gt' : 'lt';
    const primaryAfter = {
      [sortBy]: { [comparison]: value },
    } as Prisma.AuditEventWhereInput;
    const primaryEqual = { [sortBy]: value } as Prisma.AuditEventWhereInput;
    return {
      OR: [
        primaryAfter,
        { ...primaryEqual, createdAt: { lt: cursor.createdAt } },
        {
          ...primaryEqual,
          createdAt: cursor.createdAt,
          id: { lt: cursor.id },
        },
      ],
    };
  }

  private resolveActionFilter(
    action?: string,
    resourceType?: AuditEventFilters['resourceType'],
  ): Prisma.StringFilter | string | null | undefined {
    if (action) {
      return !resourceType || resolveAuditResourceType(action) === resourceType
        ? action
        : null;
    }
    if (
      resourceType === 'file' ||
      resourceType === 'share' ||
      resourceType === 'transfer'
    ) {
      return { startsWith: `${resourceType}.` };
    }
    return undefined;
  }

  private validateFilters(filters: AuditEventFilters) {
    for (const [field, value] of Object.entries({
      workspaceId: filters.workspaceId,
      shareToken: filters.shareToken,
      nodeId: filters.nodeId,
      action: filters.action,
      ipAddress: filters.ipAddress,
      query: filters.query,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
    })) {
      if (value !== undefined && typeof value !== 'string') {
        throw new BadRequestException(`${field} must be a string`);
      }
    }
    this.assertEnum('scope', filters.scope, ['all', 'system', 'workspace']);
    this.assertEnum('actor', filters.actor, [
      'workspace',
      'account',
      'visitor',
      'system',
    ]);
    this.assertEnum('result', filters.result, ['success', 'failed']);
    this.assertEnum('resourceType', filters.resourceType, [
      'file',
      'share',
      'transfer',
      'system',
    ]);
    this.assertEnum('sortBy', filters.sortBy, ['createdAt', 'action', 'actor']);
    this.assertEnum('sortDirection', filters.sortDirection, ['asc', 'desc']);
    if (
      filters.action &&
      (filters.action.length > maximumAuditActionLength ||
        !auditActionPattern.test(filters.action))
    ) {
      throw new BadRequestException('action has an unsupported value');
    }
    if (filters.limit !== undefined && !Number.isFinite(filters.limit)) {
      throw new BadRequestException('limit must be a finite number');
    }
    if (filters.offset !== undefined && !Number.isFinite(filters.offset)) {
      throw new BadRequestException('offset must be a finite number');
    }
  }

  private assertEnum(
    field: string,
    value: unknown,
    allowedValues: readonly string[],
  ) {
    if (
      value === undefined ||
      (typeof value === 'string' && allowedValues.includes(value))
    ) {
      return;
    }
    throw new BadRequestException(`${field} has an unsupported value`);
  }

  private matchesServiceFilters(
    event: AuditEventRecord,
    filters: AuditEventFilters,
  ) {
    if (filters.result && event.result !== filters.result) return false;
    if (filters.resourceType && event.resourceType !== filters.resourceType) {
      return false;
    }
    const ipAddress = filters.ipAddress?.trim().toLowerCase();
    if (ipAddress && !event.ipAddress?.toLowerCase().includes(ipAddress)) {
      return false;
    }
    const query = filters.query?.trim().toLowerCase();
    if (!query) return true;
    return this.collectSearchValues(event).some((value) =>
      value.toLowerCase().includes(query),
    );
  }

  private collectSearchValues(event: AuditEventRecord) {
    const values: string[] = [
      event.id,
      event.action,
      event.actor,
      event.target,
      event.createdAt,
      event.result,
      event.resourceType,
    ];
    for (const value of [
      event.workspaceId,
      event.shareToken,
      event.nodeId,
      event.actorDisplayName,
      event.actorEmail,
      event.actorUserId,
      event.ipAddress,
    ]) {
      if (value) values.push(value);
    }
    this.appendMetadataValues(event.metadata, values);
    return values;
  }

  private appendMetadataValues(value: unknown, values: string[]) {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach((item) => this.appendMetadataValues(item, values));
      } else {
        Object.entries(value as Record<string, unknown>).forEach(
          ([key, item]) => {
            values.push(key);
            this.appendMetadataValues(item, values);
          },
        );
      }
      return;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      values.push(String(value));
    }
  }

  private mapRow(row: AuditEvent): AuditEventRecord {
    const metadata = this.parseMetadata(row.metadata);
    return {
      id: row.id,
      action: row.action,
      actor: row.actor as AuditEventRecord['actor'],
      target: row.target,
      workspaceId: row.workspaceId,
      shareToken: row.shareToken,
      nodeId: row.nodeId,
      metadata,
      createdAt: row.createdAt.toISOString(),
      actorDisplayName: this.readMetadataString(metadata, [
        'actorDisplayName',
        'actorName',
        'displayName',
      ]),
      actorEmail: this.readMetadataString(metadata, ['actorEmail', 'email']),
      actorUserId: this.readMetadataString(metadata, ['actorUserId', 'userId']),
      ipAddress: this.readMetadataString(metadata, [
        'ipAddress',
        'ip',
        'requestIp',
      ]),
      resourceType: resolveAuditResourceType(row.action),
      result: resolveAuditResult(row.action, metadata),
    };
  }

  private mapRawRow(row: RawAuditEventRow): AuditEventRecord {
    const createdAt =
      row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    return this.mapRow({ ...row, createdAt });
  }

  private readMetadataString(
    metadata: Record<string, unknown>,
    keys: string[],
  ) {
    for (const key of keys) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  private parseMetadata(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }
    return {};
  }

  private emptyPage(
    scope: AuditScope,
    generatedAt: string,
    limit: number,
    offset: number,
  ): AuditEventPage {
    return {
      items: [],
      total: 0,
      limit,
      offset,
      facets: { actors: [], actions: [] },
      summary: { success: 0, failed: 0 },
      scope,
      generatedAt,
    };
  }
}
