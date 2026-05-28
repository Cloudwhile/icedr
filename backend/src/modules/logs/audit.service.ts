import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  AuditEventFilters,
  AuditEventRecord,
  clampAuditLimit,
} from './audit-events';

type AuditEventRow = {
  id: string;
  action: string;
  actor: AuditEventRecord['actor'];
  target: string;
  workspace_id: string | null;
  share_token: string | null;
  node_id: string | null;
  metadata: Record<string, unknown> | string;
  created_at: Date | string;
};

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async listEvents(filters: AuditEventFilters = {}) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filters.workspaceId) {
      values.push(filters.workspaceId);
      clauses.push(`workspace_id = $${values.length}`);
    }
    if (filters.shareToken) {
      values.push(filters.shareToken);
      clauses.push(`share_token = $${values.length}`);
    }
    if (filters.nodeId) {
      values.push(filters.nodeId);
      clauses.push(`node_id = $${values.length}`);
    }
    if (filters.action) {
      values.push(filters.action);
      clauses.push(`action = $${values.length}`);
    }
    values.push(clampAuditLimit(filters.limit));

    const result = await this.database.query<AuditEventRow>(
      `
        select id, action, actor, target, workspace_id, share_token, node_id, metadata, created_at
        from audit_events
        ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
        order by created_at desc
        limit $${values.length}
      `,
      values,
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: AuditEventRow): AuditEventRecord {
    return {
      id: row.id,
      action: row.action,
      actor: row.actor,
      target: row.target,
      workspaceId: row.workspace_id,
      shareToken: row.share_token,
      nodeId: row.node_id,
      metadata:
        typeof row.metadata === 'string'
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : row.metadata,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
    };
  }
}
