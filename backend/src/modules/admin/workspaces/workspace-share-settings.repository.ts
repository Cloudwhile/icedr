import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import {
  UpdateWorkspaceShareSettingsDto,
  WorkspaceShareSettings,
} from './share-settings.dto';

type WorkspaceShareSettingsRow = {
  workspace_id: string;
  anonymous_access: WorkspaceShareSettings['anonymousAccess'];
  email_rule: WorkspaceShareSettings['emailRule'];
  allowed_domains: string[] | string;
  default_expires_days: number;
  max_expires_days: number;
  allow_permanent: boolean;
  audit_settings: WorkspaceShareSettings['audit'] | string;
  updated_at: Date | string;
};

export const defaultShareSettings: WorkspaceShareSettings = {
  workspaceId: 'workspace-default',
  anonymousAccess: 'email-required',
  emailRule: 'any',
  allowedDomains: [],
  defaultExpiresDays: 7,
  maxExpiresDays: 30,
  allowPermanent: false,
  audit: {
    ip: true,
    userAgent: true,
    downloads: true,
    anomaly: false,
    alerts: false,
  },
  updatedAt: new Date(0).toISOString(),
};

@Injectable()
export class WorkspaceShareSettingsRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists workspace_share_settings (
        workspace_id text primary key,
        anonymous_access text not null,
        email_rule text not null,
        allowed_domains jsonb not null,
        default_expires_days integer not null,
        max_expires_days integer not null,
        allow_permanent boolean not null,
        audit_settings jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
  }

  async get(workspaceId: string) {
    const result = await this.database.query<WorkspaceShareSettingsRow>(
      'select * from workspace_share_settings where workspace_id = $1 limit 1',
      [workspaceId],
    );
    if (result.rows[0]) return this.mapRow(result.rows[0]);

    return this.upsert(workspaceId, {});
  }

  async upsert(workspaceId: string, dto: UpdateWorkspaceShareSettingsDto) {
    const current = await this.getForUpdate(workspaceId);
    const next = this.validate({
      ...current,
      ...dto,
      allowedDomains: dto.allowedDomains
        ? this.normalizeDomains(dto.allowedDomains)
        : current.allowedDomains,
      audit: dto.audit ? { ...current.audit, ...dto.audit } : current.audit,
      updatedAt: new Date().toISOString(),
    });

    const result = await this.database.query<WorkspaceShareSettingsRow>(
      `
        insert into workspace_share_settings (
          workspace_id,
          anonymous_access,
          email_rule,
          allowed_domains,
          default_expires_days,
          max_expires_days,
          allow_permanent,
          audit_settings,
          updated_at
        )
        values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9)
        on conflict (workspace_id) do update set
          anonymous_access = excluded.anonymous_access,
          email_rule = excluded.email_rule,
          allowed_domains = excluded.allowed_domains,
          default_expires_days = excluded.default_expires_days,
          max_expires_days = excluded.max_expires_days,
          allow_permanent = excluded.allow_permanent,
          audit_settings = excluded.audit_settings,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        next.workspaceId,
        next.anonymousAccess,
        next.emailRule,
        JSON.stringify(next.allowedDomains),
        next.defaultExpiresDays,
        next.maxExpiresDays,
        next.allowPermanent,
        JSON.stringify(next.audit),
        next.updatedAt,
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  private async getForUpdate(workspaceId: string) {
    const result = await this.database.query<WorkspaceShareSettingsRow>(
      'select * from workspace_share_settings where workspace_id = $1 limit 1',
      [workspaceId],
    );
    return result.rows[0]
      ? this.mapRow(result.rows[0])
      : this.createDefault(workspaceId);
  }

  private createDefault(workspaceId: string): WorkspaceShareSettings {
    return {
      ...defaultShareSettings,
      workspaceId,
      updatedAt: new Date().toISOString(),
    };
  }

  private validate(settings: WorkspaceShareSettings) {
    if (settings.defaultExpiresDays > settings.maxExpiresDays) {
      throw new BadRequestException(
        'Default expiry cannot exceed maximum expiry',
      );
    }
    if (
      settings.emailRule === 'domains' &&
      settings.allowedDomains.length === 0
    ) {
      throw new BadRequestException(
        'At least one allowed email domain is required',
      );
    }
    return settings;
  }

  private normalizeDomains(domains: string[]) {
    return [
      ...new Set(
        domains
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean)
          .map((domain) => (domain.startsWith('@') ? domain.slice(1) : domain)),
      ),
    ];
  }

  private mapRow(row: WorkspaceShareSettingsRow): WorkspaceShareSettings {
    return {
      workspaceId: row.workspace_id,
      anonymousAccess: row.anonymous_access,
      emailRule: row.email_rule,
      allowedDomains: this.parseStringArray(row.allowed_domains),
      defaultExpiresDays: row.default_expires_days,
      maxExpiresDays: row.max_expires_days,
      allowPermanent: row.allow_permanent,
      audit:
        typeof row.audit_settings === 'string'
          ? (JSON.parse(row.audit_settings) as WorkspaceShareSettings['audit'])
          : row.audit_settings,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
    };
  }

  private parseStringArray(value: string[] | string) {
    if (Array.isArray(value)) return value;
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
