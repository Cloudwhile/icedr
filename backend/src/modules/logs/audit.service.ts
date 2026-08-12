import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type AuditEvent } from '../../generated/prisma/client';
import {
  AuditEventFilters,
  AuditEventPage,
  AuditEventRecord,
  AuditEventSnapshot,
  AuditScope,
  clampAuditLimit,
  clampAuditOffset,
  resolveAuditResourceType,
  resolveAuditResult,
} from './audit-events';

const auditActionPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const maximumAuditActionLength = 128;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(filters: AuditEventFilters = {}): Promise<AuditEventPage> {
    const limit = clampAuditLimit(filters.limit);
    const offset = clampAuditOffset(filters.offset);
    const snapshot = await this.getEventSnapshot(filters);

    return {
      ...snapshot,
      items: snapshot.items.slice(offset, offset + limit),
      limit,
      offset,
    };
  }

  async getEventSnapshot(
    filters: AuditEventFilters = {},
  ): Promise<AuditEventSnapshot> {
    this.validateFilters(filters);
    const scope = this.resolveScope(filters);
    const generatedAt = new Date().toISOString();
    const actionFilter = this.resolveActionFilter(
      filters.action,
      filters.resourceType,
    );
    if (actionFilter === null) return this.emptySnapshot(scope, generatedAt);

    const where = this.buildWhere(filters, scope, actionFilter);
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: this.resolveOrderBy(filters),
      skip: undefined,
      take: undefined,
    });
    const items = rows
      .map((row) => this.mapRow(row))
      .filter((event) => this.matchesServiceFilters(event, filters));

    return {
      items,
      total: items.length,
      facets: {
        actors: [...new Set(items.map((item) => item.actor))].sort(),
        actions: [...new Set(items.map((item) => item.action))].sort(),
      },
      summary: {
        success: items.filter((item) => item.result === 'success').length,
        failed: items.filter((item) => item.result === 'failed').length,
      },
      scope,
      generatedAt,
    };
  }

  private buildWhere(
    filters: AuditEventFilters,
    scope: AuditScope,
    actionFilter: Prisma.StringFilter | string | undefined,
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
    if (createdFrom || createdTo) {
      where.createdAt = {
        ...(createdFrom ? { gte: createdFrom } : {}),
        ...(createdTo ? { lte: createdTo } : {}),
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

  private emptySnapshot(
    scope: AuditScope,
    generatedAt: string,
  ): AuditEventSnapshot {
    return {
      items: [],
      total: 0,
      facets: { actors: [], actions: [] },
      summary: { success: 0, failed: 0 },
      scope,
      generatedAt,
    };
  }
}
