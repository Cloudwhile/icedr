import { randomBytes } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createAuditEvent } from '../../logs/audit-events';
import { DatabaseService } from '../../../database/database.service';
import {
  TransferResponse,
  TransferStatus,
  TransferType,
} from './transfers.dto';

type TransferRow = {
  id: string;
  workspace_id: string;
  node_id: string | null;
  object_key: string | null;
  name: string;
  transfer_type: TransferType;
  progress: number;
  status: TransferStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

export type TransferAuditAction =
  | 'transfer.created'
  | 'transfer.completed'
  | 'transfer.failed';

@Injectable()
export class TransfersRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists transfer_tasks (
        id text primary key,
        workspace_id text not null,
        node_id text,
        object_key text,
        name text not null,
        transfer_type text not null,
        progress integer not null,
        status text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await this.database.query(`
      create table if not exists audit_events (
        id text primary key,
        action text not null,
        actor text not null,
        target text not null,
        workspace_id text,
        share_token text,
        node_id text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `);
  }

  async create(input: {
    workspaceId: string;
    nodeId?: string | null;
    objectKey?: string | null;
    name: string;
    type: TransferType;
    progress?: number;
    status?: TransferStatus;
  }) {
    const id = `transfer_${randomBytes(12).toString('base64url')}`;
    const result = await this.database.query<TransferRow>(
      `
        insert into transfer_tasks (
          id,
          workspace_id,
          node_id,
          object_key,
          name,
          transfer_type,
          progress,
          status
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *
      `,
      [
        id,
        input.workspaceId,
        input.nodeId ?? null,
        input.objectKey ?? null,
        input.name,
        input.type,
        input.progress ?? 0,
        input.status ?? 'running',
      ],
    );
    const transfer = this.mapRow(result.rows[0]);
    await this.recordAudit('transfer.created', transfer);
    return transfer;
  }

  async update(
    id: string,
    input: { status?: TransferStatus; progress?: number; nodeId?: string },
  ) {
    const updates: string[] = [];
    const values: unknown[] = [id];
    if (input.status) {
      values.push(input.status);
      updates.push(`status = $${values.length}`);
    }
    if (input.progress !== undefined) {
      values.push(input.progress);
      updates.push(`progress = $${values.length}`);
    }
    if (input.nodeId !== undefined) {
      values.push(input.nodeId);
      updates.push(`node_id = $${values.length}`);
    }
    if (updates.length === 0) return this.findById(id);
    updates.push('updated_at = now()');

    const result = await this.database.query<TransferRow>(
      `
        update transfer_tasks
        set ${updates.join(', ')}
        where id = $1
        returning *
      `,
      values,
    );
    const transfer = result.rows[0] ? this.mapRow(result.rows[0]) : null;
    if (transfer && input.status === 'completed') {
      await this.recordAudit('transfer.completed', transfer);
    } else if (transfer && input.status === 'failed') {
      await this.recordAudit('transfer.failed', transfer);
    }
    return transfer;
  }

  async findById(id: string) {
    const result = await this.database.query<TransferRow>(
      'select * from transfer_tasks where id = $1 limit 1',
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async list(workspaceId?: string, limit = 100) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (workspaceId) {
      values.push(workspaceId);
      clauses.push(`workspace_id = $${values.length}`);
    }
    values.push(Math.min(Math.max(Math.trunc(limit), 1), 500));
    const result = await this.database.query<TransferRow>(
      `
        select *
        from transfer_tasks
        ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
        order by created_at desc
        limit $${values.length}
      `,
      values,
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  private async recordAudit(
    action: TransferAuditAction,
    transfer: TransferResponse,
  ) {
    const event = createAuditEvent({
      action,
      actor: 'workspace',
      target: transfer.id,
      workspaceId: transfer.workspaceId,
      nodeId: transfer.nodeId,
      metadata: {
        source: 'transfers-service',
        transferType: transfer.type,
        objectKey: transfer.objectKey,
        status: transfer.status,
      },
    });

    await this.database.query(
      `
        insert into audit_events (
          id,
          action,
          actor,
          target,
          workspace_id,
          share_token,
          node_id,
          metadata,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `,
      [
        event.id,
        event.action,
        event.actor,
        event.target,
        event.workspaceId,
        event.shareToken,
        event.nodeId,
        JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
  }

  private mapRow(row: TransferRow): TransferResponse {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      nodeId: row.node_id,
      objectKey: row.object_key,
      name: row.name,
      type: row.transfer_type,
      progress: row.progress,
      status: row.status,
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
    };
  }

  private toIsoString(value: Date | string) {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
