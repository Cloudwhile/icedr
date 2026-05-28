import { randomBytes } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAuditEvent } from '../logs/audit-events';
import { DatabaseService } from '../../database/database.service';
import { CreateShareDto, ShareResponse } from './shares.dto';

type StoredShare = ShareResponse;

export type ShareStatus = 'active' | 'revoked' | 'expired';
export type ShareRiskLevel = 'normal' | 'attention' | 'high';
export type ShareManagementResponse = ShareResponse & {
  status: ShareStatus;
  visitCount: number;
  downloadCount: number;
  lastAccessAt: string | null;
  riskLevel: ShareRiskLevel;
};

type ShareRow = {
  token: string;
  workspace_id: string;
  title: string;
  mode: ShareResponse['mode'];
  owner_name: string;
  root_item_ids: string[] | string;
  allowed_item_ids: string[] | string;
  dynamic_root_id: string | null;
  allow_download: boolean;
  allow_preview: boolean;
  expires_days: number;
  remark: string | null;
  policy_snapshot: ShareResponse['policy'] | string;
  created_at: Date | string;
  revoked_at: Date | string | null;
};

export type ShareAuditAction =
  | 'share.created'
  | 'share.viewed'
  | 'share.revoked'
  | 'share.download_intent_created'
  | 'share.download_started'
  | 'share.preview_requested'
  | 'share.access_code_sent'
  | 'share.access_session_created';

@Injectable()
export class SharesRepository implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists share_links (
        token text primary key,
        workspace_id text not null default 'workspace-default',
        title text not null,
        mode text not null,
        owner_name text not null,
        root_item_ids jsonb not null,
        allowed_item_ids jsonb not null,
        dynamic_root_id text,
        allow_download boolean not null,
        allow_preview boolean not null,
        expires_days integer not null,
        remark text,
        policy_snapshot jsonb not null,
        created_at timestamptz not null default now(),
        revoked_at timestamptz
      )
    `);
    await this.database.query(
      "alter table share_links add column if not exists workspace_id text not null default 'workspace-default'",
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
  }

  async create(dto: CreateShareDto): Promise<StoredShare> {
    const share: StoredShare = {
      token: await this.createUniqueToken(),
      url: '',
      workspaceId: dto.workspaceId ?? 'workspace-default',
      title: dto.title,
      mode: dto.mode,
      owner: dto.owner,
      rootItemIds: [...dto.rootItemIds],
      allowedItemIds: [...dto.allowedItemIds],
      dynamicRootId: dto.dynamicRootId ?? null,
      allowDownload: dto.allowDownload,
      allowPreview: dto.allowPreview,
      expiresDays: dto.expiresDays,
      remark: dto.remark ?? '',
      policy: dto.policy,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    share.url = this.buildShareUrl(share.token);

    const result = await this.database.query<ShareRow>(
      `
        insert into share_links (
          token,
          workspace_id,
          title,
          mode,
          owner_name,
          root_item_ids,
          allowed_item_ids,
          dynamic_root_id,
          allow_download,
          allow_preview,
          expires_days,
          remark,
          policy_snapshot,
          created_at,
          revoked_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
        returning *
      `,
      [
        share.token,
        share.workspaceId,
        share.title,
        share.mode,
        share.owner,
        JSON.stringify(share.rootItemIds),
        JSON.stringify(share.allowedItemIds),
        share.dynamicRootId,
        share.allowDownload,
        share.allowPreview,
        share.expiresDays,
        share.remark,
        JSON.stringify(share.policy),
        share.createdAt,
        share.revokedAt,
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  async list(workspaceId?: string): Promise<ShareManagementResponse[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (workspaceId) {
      values.push(workspaceId);
      clauses.push(`workspace_id = $${values.length}`);
    }
    const result = await this.database.query<ShareRow>(
      `
        select *
        from share_links
        ${clauses.length > 0 ? `where ${clauses.join(' and ')}` : ''}
        order by created_at desc
      `,
      values,
    );
    const shares = result.rows.map((row) => this.mapRow(row));
    const stats = await Promise.all(
      shares.map((share) => this.getShareStats(share.token)),
    );
    return shares.map((share, index) =>
      this.toManagementShare(share, stats[index]),
    );
  }

  async findByToken(token: string): Promise<StoredShare | null> {
    const result = await this.database.query<ShareRow>(
      'select * from share_links where token = $1 limit 1',
      [token],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async revoke(token: string): Promise<StoredShare | null> {
    const revokedAt = new Date().toISOString();

    const result = await this.database.query<ShareRow>(
      `
        update share_links
        set revoked_at = coalesce(revoked_at, $2)
        where token = $1
        returning *
      `,
      [token, revokedAt],
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async recordAudit(
    action: ShareAuditAction,
    shareToken: string,
    metadata: Record<string, unknown> = {},
  ) {
    const event = createAuditEvent({
      action,
      actor: action === 'share.created' ? 'workspace' : 'visitor',
      target: shareToken,
      workspaceId:
        (await this.findByToken(shareToken))?.workspaceId ??
        'workspace-default',
      shareToken,
      nodeId: typeof metadata.nodeId === 'string' ? metadata.nodeId : undefined,
      metadata: { source: 'shares-service', ...metadata },
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

  async countAuditEvents(action?: ShareAuditAction) {
    const result = await this.database.query<{ count: string }>(
      action
        ? 'select count(*)::text from audit_events where action = $1'
        : 'select count(*)::text from audit_events',
      action ? [action] : [],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async createUniqueToken() {
    let token = this.createToken();
    while (await this.findByToken(token)) {
      token = this.createToken();
    }
    return token;
  }

  private createToken() {
    return `s_${randomBytes(18).toString('base64url')}`;
  }

  private buildShareUrl(token: string) {
    const baseUrl =
      this.config.get<string>('share.publicBaseUrl') ??
      'http://localhost:13000/share/s';
    return `${baseUrl.replace(/\/$/, '')}/${token}`;
  }

  private mapRow(row: ShareRow): StoredShare {
    return {
      token: row.token,
      url: this.buildShareUrl(row.token),
      workspaceId: row.workspace_id,
      title: row.title,
      mode: row.mode,
      owner: row.owner_name,
      rootItemIds: this.parseJsonArray(row.root_item_ids),
      allowedItemIds: this.parseJsonArray(row.allowed_item_ids),
      dynamicRootId: row.dynamic_root_id,
      allowDownload: row.allow_download,
      allowPreview: row.allow_preview,
      expiresDays: row.expires_days,
      remark: row.remark ?? '',
      policy: this.parsePolicy(row.policy_snapshot),
      createdAt: this.toIsoString(row.created_at),
      revokedAt: row.revoked_at ? this.toIsoString(row.revoked_at) : null,
    };
  }

  private async getShareStats(token: string) {
    const result = await this.database.query<{
      action: string;
      created_at: Date | string;
    }>(
      `
        select action, created_at
        from audit_events
        where share_token = $1
        order by created_at desc
      `,
      [token],
    );
    return result.rows.map((row) => ({
      action: row.action,
      createdAt: this.toIsoString(row.created_at),
    }));
  }

  private toManagementShare(
    share: StoredShare,
    events: Array<{ action: string; createdAt: string }>,
  ): ShareManagementResponse {
    const viewEvents = events.filter(
      (event) => event.action === 'share.viewed',
    );
    const downloadEvents = events.filter(
      (event) => event.action === 'share.download_started',
    );
    const lastAccessAt =
      events.find((event) =>
        [
          'share.viewed',
          'share.download_intent_created',
          'share.download_started',
          'share.preview_requested',
        ].includes(event.action),
      )?.createdAt ?? null;

    return {
      ...share,
      status: this.getShareStatus(share),
      visitCount: viewEvents.length,
      downloadCount: downloadEvents.length,
      lastAccessAt,
      riskLevel: this.getRiskLevel(downloadEvents.length, viewEvents.length),
    };
  }

  private getShareStatus(share: StoredShare): ShareStatus {
    if (share.revokedAt) return 'revoked';
    const expiresAt =
      new Date(share.createdAt).getTime() + share.expiresDays * 86400000;
    return expiresAt < Date.now() ? 'expired' : 'active';
  }

  private getRiskLevel(
    downloadCount: number,
    visitCount: number,
  ): ShareRiskLevel {
    if (downloadCount >= 50 || visitCount >= 200) return 'high';
    if (downloadCount >= 10 || visitCount >= 50) return 'attention';
    return 'normal';
  }

  private parseJsonArray(value: string[] | string) {
    if (Array.isArray(value)) return value;
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private parsePolicy(value: ShareResponse['policy'] | string) {
    return typeof value === 'string'
      ? (JSON.parse(value) as ShareResponse['policy'])
      : value;
  }

  private toIsoString(value: Date | string) {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
