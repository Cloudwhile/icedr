import { randomBytes } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createAuditEvent } from '../logs/audit-events';
import { DatabaseService } from '../../database/database.service';
import {
  CompleteUploadDto,
  DownloadIntentResponse,
  FileNodeListState,
  FileNodeKind,
  FileNodeResponse,
  PreviewIntentResponse,
} from './file-nodes.dto';

type FileNodeRow = {
  id: string;
  workspace_id: string;
  parent_node_id: string | null;
  name: string;
  kind: FileNodeKind;
  mime_type: string;
  size_bytes: number | null;
  object_key: string | null;
  owner_name: string;
  starred: boolean;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type StorageUsageRow = {
  used_bytes: string | null;
  file_count: string;
  folder_count: string;
};

type PreviewArtifactRow = {
  id: string;
  node_id: string;
  source_object_key: string | null;
  preview_object_key: string | null;
  preview_type: FileNodeKind | 'metadata';
  status: PreviewIntentResponse['status'];
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DownloadIntentRow = {
  id: string;
  node_id: string;
  filename: string;
  method: DownloadIntentResponse['method'];
  expires_at: Date | string;
  created_at: Date | string;
};

export type FileAuditAction =
  | 'file.upload_intent_created'
  | 'file.upload_completed'
  | 'file.starred_updated'
  | 'file.archived'
  | 'file.restored'
  | 'file.download_intent_created'
  | 'file.download_started'
  | 'file.preview_requested';

@Injectable()
export class FileNodesRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists file_nodes (
        id text primary key,
        workspace_id text not null,
        parent_node_id text,
        name text not null,
        kind text not null,
        mime_type text not null,
        size_bytes bigint,
        object_key text,
        owner_name text not null,
        starred boolean not null default false,
        archived_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await this.database.query(
      'alter table file_nodes add column if not exists starred boolean not null default false',
    );
    await this.database.query(
      'alter table file_nodes add column if not exists archived_at timestamptz',
    );

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

    await this.database.query(
      'alter table audit_events add column if not exists workspace_id text',
    );
    await this.database.query(
      'alter table audit_events add column if not exists node_id text',
    );

    await this.database.query(`
      create table if not exists preview_artifacts (
        id text primary key,
        node_id text not null,
        source_object_key text,
        preview_object_key text,
        preview_type text not null,
        status text not null,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await this.database.query(`
      create table if not exists file_download_intents (
        id text primary key,
        node_id text not null,
        filename text not null,
        method text not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      )
    `);
  }

  async list(
    workspaceId?: string,
    parentNodeId?: string | null,
    state: FileNodeListState = 'active',
  ) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (workspaceId) {
      values.push(workspaceId);
      clauses.push(`workspace_id = $${values.length}`);
    }
    if (parentNodeId !== undefined) {
      values.push(parentNodeId);
      clauses.push(`parent_node_id is not distinct from $${values.length}`);
    }
    if (state === 'active') {
      clauses.push('archived_at is null');
    } else if (state === 'archived') {
      clauses.push('archived_at is not null');
    }

    const result = await this.database.query<FileNodeRow>(
      `
        select *
        from file_nodes
        ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
        order by parent_node_id nulls first, name asc
      `,
      values,
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async findById(id: string) {
    const result = await this.database.query<FileNodeRow>(
      'select * from file_nodes where id = $1 limit 1',
      [id],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async updateState(
    id: string,
    state: { starred?: boolean; archived?: boolean },
  ) {
    const updates: string[] = [];
    const values: unknown[] = [id];
    if (state.starred !== undefined) {
      values.push(state.starred);
      updates.push(`starred = $${values.length}`);
    }
    if (state.archived !== undefined) {
      updates.push(
        state.archived ? 'archived_at = now()' : 'archived_at = null',
      );
    }
    if (updates.length === 0) return this.findById(id);
    updates.push('updated_at = now()');

    const result = await this.database.query<FileNodeRow>(
      `
        update file_nodes
        set ${updates.join(', ')}
        where id = $1
        returning *
      `,
      values,
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async createDownloadIntent(
    node: FileNodeResponse,
    method: DownloadIntentResponse['method'],
  ) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const id = `fdl_${randomBytes(12).toString('base64url')}`;
    const result = await this.database.query<DownloadIntentRow>(
      `
        insert into file_download_intents (
          id,
          node_id,
          filename,
          method,
          expires_at
        )
        values ($1, $2, $3, $4, $5)
        returning *
      `,
      [id, node.id, node.name, method, expiresAt],
    );
    return this.mapDownloadIntent(result.rows[0]);
  }

  async findDownloadIntent(downloadId: string) {
    const result = await this.database.query<DownloadIntentRow>(
      'select * from file_download_intents where id = $1 limit 1',
      [downloadId],
    );
    return result.rows[0] ? this.mapDownloadIntent(result.rows[0]) : null;
  }

  async createPreviewArtifact(
    node: FileNodeResponse,
    status: PreviewIntentResponse['status'],
    previewType: PreviewIntentResponse['previewType'],
    error: string | null = null,
  ) {
    const id = `preview_${randomBytes(12).toString('base64url')}`;
    const result = await this.database.query<PreviewArtifactRow>(
      `
        insert into preview_artifacts (
          id,
          node_id,
          source_object_key,
          preview_object_key,
          preview_type,
          status,
          error
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [id, node.id, node.objectKey, null, previewType, status, error],
    );
    return this.mapPreviewArtifact(result.rows[0]);
  }

  async findPreviewArtifact(previewId: string) {
    const result = await this.database.query<PreviewArtifactRow>(
      'select * from preview_artifacts where id = $1 limit 1',
      [previewId],
    );
    return result.rows[0] ? this.mapPreviewArtifact(result.rows[0]) : null;
  }

  async completeUpload(dto: CompleteUploadDto) {
    const now = new Date().toISOString();
    const node: FileNodeResponse = {
      id: `node_${randomBytes(12).toString('base64url')}`,
      workspaceId: dto.workspaceId,
      parentNodeId: dto.parentNodeId ?? null,
      name: dto.fileName,
      kind: this.getKind(dto.fileName, dto.mimeType),
      mimeType: dto.mimeType ?? 'application/octet-stream',
      sizeBytes: dto.sizeBytes,
      objectKey: dto.objectKey,
      owner: dto.owner ?? '',
      starred: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.database.query<FileNodeRow>(
      `
        insert into file_nodes (
          id,
          workspace_id,
          parent_node_id,
          name,
          kind,
          mime_type,
          size_bytes,
          object_key,
          owner_name,
          starred,
          archived_at,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, null, $10, $11)
        returning *
      `,
      [
        node.id,
        node.workspaceId,
        node.parentNodeId,
        node.name,
        node.kind,
        node.mimeType,
        node.sizeBytes,
        node.objectKey,
        node.owner,
        node.createdAt,
        node.updatedAt,
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  async recordAudit(action: FileAuditAction, target: string) {
    const node = action.startsWith('file.')
      ? await this.findById(target)
      : null;
    const event = createAuditEvent({
      action,
      actor: 'workspace',
      target,
      workspaceId: node?.workspaceId ?? 'workspace-default',
      nodeId: node?.id ?? (action.startsWith('file.') ? target : null),
      metadata: { source: 'file-nodes-service' },
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

  async countAuditEvents(action?: FileAuditAction) {
    const result = await this.database.query<{ count: string }>(
      action
        ? 'select count(*)::text from audit_events where action = $1'
        : 'select count(*)::text from audit_events',
      action ? [action] : [],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getStorageUsage(workspaceId: string) {
    const result = await this.database.query<StorageUsageRow>(
      `
        select
          coalesce(sum(case when size_bytes is not null then size_bytes else 0 end), 0)::text as used_bytes,
          count(*) filter (where size_bytes is not null)::text as file_count,
          count(*) filter (where size_bytes is null)::text as folder_count
        from file_nodes
        where workspace_id = $1 and archived_at is null
      `,
      [workspaceId],
    );
    const row = result.rows[0];
    return {
      usedBytes: Number(row?.used_bytes ?? 0),
      fileCount: Number(row?.file_count ?? 0),
      folderCount: Number(row?.folder_count ?? 0),
    };
  }

  private getKind(fileName: string, mimeType = ''): FileNodeKind {
    if (mimeType.startsWith('image/')) return 'image';
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (['xlsx', 'xls', 'csv'].includes(extension)) return 'sheet';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
      return 'image';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'archive';
    return 'doc';
  }

  private mapRow(row: FileNodeRow): FileNodeResponse {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      parentNodeId: row.parent_node_id,
      name: row.name,
      kind: row.kind,
      mimeType: row.mime_type,
      sizeBytes:
        row.size_bytes === null || row.size_bytes === undefined
          ? null
          : Number(row.size_bytes),
      objectKey: row.object_key,
      owner: row.owner_name,
      starred: row.starred,
      archivedAt: row.archived_at ? this.toIsoString(row.archived_at) : null,
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at),
    };
  }

  private mapDownloadIntent(row: DownloadIntentRow) {
    return {
      downloadId: row.id,
      nodeId: row.node_id,
      filename: row.filename,
      method: row.method,
      expiresAt: this.toIsoString(row.expires_at),
      createdAt: this.toIsoString(row.created_at),
    };
  }

  private mapPreviewArtifact(row: PreviewArtifactRow): PreviewIntentResponse {
    return {
      previewId: row.id,
      nodeId: row.node_id,
      status: row.status,
      previewType: row.preview_type,
      statusUrl: `/api/file-nodes/${encodeURIComponent(row.node_id)}/preview/status`,
      error: row.error,
    };
  }

  private toIsoString(value: Date | string) {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
