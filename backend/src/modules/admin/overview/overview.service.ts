import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type {
  AuditEventRecord,
  AuditResourceType,
  AuditScope,
} from '../../logs/audit-events';
import { AuditService } from '../../logs/audit.service';
import type { OverviewQuery, OverviewResponse } from './overview.dto';

const emptyStorage = {
  activeBytes: 0,
  trashBytes: 0,
  versionBytes: 0,
  usedBytes: 0,
  fileCount: 0,
  trashFileCount: 0,
  folderCount: 0,
  versionCount: 0,
};
const maximumOverviewDays = 366;

@Injectable()
export class OverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getOverview(query: OverviewQuery = {}): Promise<OverviewResponse> {
    this.validateQuery(query);
    const scope = this.resolveScope(query);
    const window = this.resolveWindow(query);
    const auditScope = scope.kind === 'workspace' ? 'workspace' : scope.kind;
    const [workspaceCount, storage, auditSnapshot] = await Promise.all([
      this.countWorkspaces(scope),
      this.aggregateStorage(scope),
      this.auditService.getEventSnapshot({
        scope: auditScope,
        workspaceId: scope.kind === 'workspace' ? scope.workspaceId : undefined,
        createdFrom: window.from,
        createdTo: window.to,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      }),
    ]);
    if (scope.kind === 'workspace' && workspaceCount === 0) {
      throw new BadRequestException('Workspace was not found');
    }

    return {
      scope,
      window,
      generatedAt: new Date().toISOString(),
      workspaceCount,
      storage,
      audit: {
        total: auditSnapshot.total,
        failed: auditSnapshot.summary.failed,
        dailyTrend: this.buildDailyTrend(
          auditSnapshot.items,
          window.from,
          window.to,
        ),
        resourceDistribution: this.buildResourceDistribution(
          auditSnapshot.items,
        ),
        recentRiskEvents: auditSnapshot.items
          .filter((event) => this.isRiskEvent(event))
          .slice(0, 10),
      },
    };
  }

  private resolveScope(query: OverviewQuery): AuditScope {
    const workspaceId = query.workspaceId?.trim();
    if (workspaceId && query.scope && query.scope !== 'workspace') {
      throw new BadRequestException(
        'workspaceId can only be combined with workspace scope',
      );
    }
    if (query.scope === 'workspace' && !workspaceId) {
      throw new BadRequestException(
        'workspaceId is required for workspace scope',
      );
    }
    if (workspaceId) return { kind: 'workspace', workspaceId };
    if (query.scope === 'system') return { kind: 'system' };
    return { kind: 'all' };
  }

  private resolveWindow(query: OverviewQuery) {
    const to = this.parseDate(query.to, 'to') ?? new Date();
    const from =
      this.parseDate(query.from, 'from') ??
      new Date(
        Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - 6),
      );
    if (from > to) {
      throw new BadRequestException('from must not be after to');
    }
    const inclusiveDays =
      Math.floor(
        (this.utcDay(to).getTime() - this.utcDay(from).getTime()) / 86_400_000,
      ) + 1;
    if (inclusiveDays > maximumOverviewDays) {
      throw new BadRequestException(
        `Overview window must not exceed ${maximumOverviewDays} days`,
      );
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }

  private validateQuery(query: OverviewQuery) {
    if (
      query.scope !== undefined &&
      !['all', 'system', 'workspace'].includes(query.scope)
    ) {
      throw new BadRequestException('scope has an unsupported value');
    }
    for (const [field, value] of Object.entries({
      workspaceId: query.workspaceId,
      from: query.from,
      to: query.to,
    })) {
      if (value !== undefined && typeof value !== 'string') {
        throw new BadRequestException(`${field} must be a string`);
      }
    }
  }

  private parseDate(value: string | undefined, field: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return date;
  }

  private countWorkspaces(scope: AuditScope) {
    if (scope.kind === 'system') return Promise.resolve(0);
    return this.prisma.workspace.count({
      where: scope.kind === 'workspace' ? { id: scope.workspaceId } : undefined,
    });
  }

  private async aggregateStorage(scope: AuditScope) {
    if (scope.kind === 'system') return { ...emptyStorage };
    const workspaceWhere =
      scope.kind === 'workspace' ? { workspaceId: scope.workspaceId } : {};
    const activeFileWhere: Prisma.FileNodeWhereInput = {
      ...workspaceWhere,
      kind: 'file',
      archivedAt: null,
    };
    const trashFileWhere: Prisma.FileNodeWhereInput = {
      ...workspaceWhere,
      kind: 'file',
      archivedAt: { not: null },
    };
    const versionWhere: Prisma.FileVersionWhereInput =
      scope.kind === 'workspace'
        ? { node: { workspaceId: scope.workspaceId } }
        : {};
    const [
      activeStats,
      trashStats,
      fileCount,
      trashFileCount,
      folderCount,
      versionStats,
      versionCount,
    ] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: activeFileWhere,
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.aggregate({
        where: trashFileWhere,
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.count({ where: activeFileWhere }),
      this.prisma.fileNode.count({ where: trashFileWhere }),
      this.prisma.fileNode.count({
        where: { ...workspaceWhere, kind: 'folder', archivedAt: null },
      }),
      this.prisma.fileVersion.aggregate({
        where: versionWhere,
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileVersion.count({ where: versionWhere }),
    ]);
    const activeBytes = Number(activeStats._sum.sizeBytes ?? 0);
    const trashBytes = Number(trashStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    return {
      activeBytes,
      trashBytes,
      versionBytes,
      usedBytes: activeBytes + trashBytes + versionBytes,
      fileCount,
      trashFileCount,
      folderCount,
      versionCount,
    };
  }

  private buildDailyTrend(
    events: AuditEventRecord[],
    from: string,
    to: string,
  ) {
    const byDate = new Map<string, { total: number; failed: number }>();
    for (const event of events) {
      const date = event.createdAt.slice(0, 10);
      const bucket = byDate.get(date) ?? { total: 0, failed: 0 };
      bucket.total += 1;
      if (event.result === 'failed') bucket.failed += 1;
      byDate.set(date, bucket);
    }
    const points: Array<{ date: string; total: number; failed: number }> = [];
    let cursor = this.utcDay(new Date(from));
    const lastDay = this.utcDay(new Date(to));
    while (cursor <= lastDay) {
      const date = cursor.toISOString().slice(0, 10);
      const bucket = byDate.get(date) ?? { total: 0, failed: 0 };
      points.push({ date, ...bucket });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    return points;
  }

  private utcDay(date: Date) {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private buildResourceDistribution(events: AuditEventRecord[]) {
    const totals = new Map<AuditResourceType, number>();
    for (const event of events) {
      totals.set(event.resourceType, (totals.get(event.resourceType) ?? 0) + 1);
    }
    return [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resourceType, total]) => ({ resourceType, total }));
  }

  private isRiskEvent(event: AuditEventRecord) {
    if (event.result === 'failed') return true;
    return /(?:permanently_deleted|trash_cleaned|quota_updated|policy_updated|share\.revoked)$/.test(
      event.action,
    );
  }
}
