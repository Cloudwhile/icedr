import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type AuditEvent } from '../../generated/prisma/client';
import {
  AuditEventPage,
  AuditEventFilters,
  AuditEventRecord,
  auditedActivityActions,
  auditedActivityActionSet,
  clampAuditLimit,
  clampAuditOffset,
  isAuthAuditAction,
} from './audit-events';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(filters: AuditEventFilters = {}): Promise<AuditEventPage> {
    const where: Prisma.AuditEventWhereInput = {};
    const actionFilter = this.resolveActionFilter(filters.action);
    const limit = clampAuditLimit(filters.limit);
    const offset = clampAuditOffset(filters.offset);
    if (!actionFilter) return { items: [], total: 0, limit, offset };

    where.action = actionFilter;
    if (filters.workspaceId) {
      where.OR = [
        { workspaceId: filters.workspaceId },
        { action: { in: auditedActivityActions.filter(isAuthAuditAction) } },
      ];
    }
    if (filters.shareToken) where.shareToken = filters.shareToken;
    if (filters.nodeId) where.nodeId = filters.nodeId;

    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      limit,
      offset,
    };
  }

  private resolveActionFilter(action?: string): Prisma.StringFilter | string {
    if (!action) return { in: [...auditedActivityActions] };
    return auditedActivityActionSet.has(action) ? action : '';
  }

  private mapRow(row: AuditEvent): AuditEventRecord {
    return {
      id: row.id,
      action: row.action,
      actor: row.actor as AuditEventRecord['actor'],
      target: row.target,
      workspaceId: row.workspaceId,
      shareToken: row.shareToken,
      nodeId: row.nodeId,
      metadata: this.parseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseMetadata(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      return JSON.parse(value) as Record<string, unknown>;
    }
    return {};
  }
}
