import { BadRequestException } from '@nestjs/common';
import { UpdateWorkspaceShareSettingsDto } from './share-settings.dto';
import {
  defaultShareSettings,
  WorkspaceShareSettingsRepository,
} from './workspace-share-settings.repository';
import { WorkspacesService } from './workspaces.service';

class WorkspaceShareSettingsRepositorySpecDouble {
  private settings = new Map<string, typeof defaultShareSettings>();

  get(workspaceId: string) {
    return Promise.resolve(
      this.settings.get(workspaceId) ?? {
        ...defaultShareSettings,
        workspaceId,
      },
    );
  }

  async upsert(workspaceId: string, dto: UpdateWorkspaceShareSettingsDto) {
    const current = await this.get(workspaceId);
    const next = {
      ...current,
      ...dto,
      allowedDomains: dto.allowedDomains
        ? dto.allowedDomains.map((domain) =>
            domain.trim().toLowerCase().replace(/^@/, ''),
          )
        : current.allowedDomains,
      audit: dto.audit ? { ...current.audit, ...dto.audit } : current.audit,
      updatedAt: new Date().toISOString(),
    };
    if (next.defaultExpiresDays > next.maxExpiresDays) {
      throw new BadRequestException(
        'Default expiry cannot exceed maximum expiry',
      );
    }
    this.settings.set(workspaceId, next);
    return next;
  }
}

describe('WorkspacesService', () => {
  let service: WorkspacesService;

  beforeEach(() => {
    service = new WorkspacesService(
      new WorkspaceShareSettingsRepositorySpecDouble() as unknown as WorkspaceShareSettingsRepository,
    );
  });

  it('returns default share settings and persists updates', async () => {
    const defaults = await service.getShareSettings('workspace-default');
    expect(defaults.anonymousAccess).toBe('email-required');

    const updated = await service.updateShareSettings('workspace-default', {
      anonymousAccess: 'blocked',
      emailRule: 'domains',
      allowedDomains: ['@company.com'],
      defaultExpiresDays: 3,
      maxExpiresDays: 14,
      allowPermanent: false,
      audit: {
        ip: true,
        userAgent: true,
        downloads: true,
        anomaly: true,
        alerts: true,
      },
    });

    expect(updated).toMatchObject({
      anonymousAccess: 'blocked',
      emailRule: 'domains',
      allowedDomains: ['company.com'],
      maxExpiresDays: 14,
    });
    await expect(
      service.getShareSettings('workspace-default'),
    ).resolves.toMatchObject(updated);
  });

  it('rejects invalid expiry settings', async () => {
    await expect(
      service.updateShareSettings('workspace-default', {
        defaultExpiresDays: 31,
        maxExpiresDays: 7,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
