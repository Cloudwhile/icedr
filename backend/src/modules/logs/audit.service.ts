import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type AuditEvent } from '../../generated/prisma/client';
import {
  AuditEventFilters,
  AuditEventRecord,
  auditedActivityActions,
  auditedActivityActionSet,
  clampAuditLimit,
  isAuthAuditAction,
} from './audit-events';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(filters: AuditEventFilters = {}) {
    const where: Prisma.AuditEventWhereInput = {};
    const actionFilter = this.resolveActionFilter(filters.action);
    if (!actionFilter) return [];

    where.action = actionFilter;
    if (filters.workspaceId) {
      where.OR = [
        { workspaceId: filters.workspaceId },
        { action: { in: auditedActivityActions.filter(isAuthAuditAction) } },
      ];
    }
    if (filters.shareToken) where.shareToken = filters.shareToken;
    if (filters.nodeId) where.nodeId = filters.nodeId;

    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: clampAuditLimit(filters.limit),
    });

    return rows.map((row) => this.mapRow(row));
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
