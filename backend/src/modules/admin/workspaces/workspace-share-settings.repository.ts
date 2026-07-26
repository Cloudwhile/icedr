import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  Prisma,
  type WorkspaceShareSetting,
} from '../../../generated/prisma/client';
import {
  UpdateWorkspaceShareSettingsDto,
  WorkspaceShareSettings,
} from './share-settings.dto';

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
export class WorkspaceShareSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(workspaceId: string) {
    const row = await this.prisma.workspaceShareSetting.findUnique({
      where: { workspaceId },
    });
    if (row) return this.mapRow(row);

    return this.upsert(workspaceId, {});
  }

  async upsert(workspaceId: string, dto: UpdateWorkspaceShareSettingsDto) {
    const next = await this.prepareUpdate(workspaceId, dto);

    const row = await this.prisma.workspaceShareSetting.upsert({
      where: { workspaceId },
      create: this.toPrismaWrite(next),
      update: this.toPrismaWrite(next),
    });

    return this.mapRow(row);
  }

  async validateUpdate(
    workspaceId: string,
    dto: UpdateWorkspaceShareSettingsDto,
  ) {
    await this.prepareUpdate(workspaceId, dto);
  }

  private async prepareUpdate(
    workspaceId: string,
    dto: UpdateWorkspaceShareSettingsDto,
  ) {
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
    return next;
  }

  private async getForUpdate(workspaceId: string) {
    const row = await this.prisma.workspaceShareSetting.findUnique({
      where: { workspaceId },
    });
    return row ? this.mapRow(row) : this.createDefault(workspaceId);
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

  private toPrismaWrite(settings: WorkspaceShareSettings) {
    return {
      workspaceId: settings.workspaceId,
      anonymousAccess: settings.anonymousAccess,
      emailRule: settings.emailRule,
      allowedDomains: [...settings.allowedDomains],
      defaultExpiresDays: settings.defaultExpiresDays,
      maxExpiresDays: settings.maxExpiresDays,
      allowPermanent: settings.allowPermanent,
      auditSettings: this.toAuditJson(settings.audit),
      updatedAt: new Date(settings.updatedAt),
    };
  }

  private toAuditJson(
    settings: WorkspaceShareSettings['audit'],
  ): Prisma.InputJsonValue {
    return {
      alerts: settings.alerts,
      anomaly: settings.anomaly,
      downloads: settings.downloads,
      ip: settings.ip,
      userAgent: settings.userAgent,
    };
  }

  private mapRow(row: WorkspaceShareSetting): WorkspaceShareSettings {
    return {
      workspaceId: row.workspaceId,
      anonymousAccess:
        row.anonymousAccess as WorkspaceShareSettings['anonymousAccess'],
      emailRule: row.emailRule as WorkspaceShareSettings['emailRule'],
      allowedDomains: this.parseStringArray(row.allowedDomains),
      defaultExpiresDays: row.defaultExpiresDays,
      maxExpiresDays: row.maxExpiresDays,
      allowPermanent: row.allowPermanent,
      audit: this.parseAuditSettings(row.auditSettings),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private parseStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value !== 'string') return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private parseAuditSettings(value: unknown): WorkspaceShareSettings['audit'] {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as WorkspaceShareSettings['audit'];
    }
    if (typeof value === 'string') {
      return JSON.parse(value) as WorkspaceShareSettings['audit'];
    }
    return defaultShareSettings.audit;
  }
}
