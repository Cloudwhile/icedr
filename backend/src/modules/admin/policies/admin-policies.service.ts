import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuthService } from '../../auth/core/auth.service';
import { StorageService } from '../../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import {
  UpdateAdminAuthPolicyDto,
  UpdateAdminStoragePolicyDto,
} from './admin-policies.dto';

const storageSettingsKey = 'global';

@Injectable()
export class AdminPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly settingsService: SettingsService,
    private readonly storageService: StorageService,
  ) {}

  async updateStoragePolicy(
    dto: UpdateAdminStoragePolicyDto,
    actorUserId: string,
  ) {
    const workspaceId = dto.workspaceId.trim();
    if (!workspaceId) {
      throw new BadRequestException('Workspace id is required');
    }
    if (
      dto.quotaBytes === undefined &&
      dto.defaultUserQuotaBytes === undefined
    ) {
      throw new BadRequestException('At least one quota value is required');
    }
    this.assertSafeQuota(dto.quotaBytes, 'Storage policy quota');
    this.assertSafeQuota(dto.defaultUserQuotaBytes, 'Default user quota');
    if (dto.quotaBytes !== undefined) {
      await this.storageService.validateSettings({
        quotaBytes: dto.quotaBytes,
      });
    }

    await this.prisma.$transaction(
      async (transaction) => {
        const [storageSettings, workspace] = await Promise.all([
          transaction.storageSetting.findUnique({
            where: { settingKey: storageSettingsKey },
            select: { quotaBytes: true },
          }),
          transaction.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, defaultUserQuotaBytes: true },
          }),
        ]);
        if (!storageSettings) {
          throw new BadRequestException('Storage settings were not found');
        }
        if (!workspace) {
          throw new BadRequestException('Workspace was not found');
        }
        const quotaBytes = this.resolveQuota(
          dto.quotaBytes,
          storageSettings.quotaBytes,
        );
        const defaultUserQuotaBytes = this.resolveQuota(
          dto.defaultUserQuotaBytes,
          workspace.defaultUserQuotaBytes,
        );
        if (
          quotaBytes !== null &&
          quotaBytes > 0n &&
          defaultUserQuotaBytes !== null &&
          defaultUserQuotaBytes > quotaBytes
        ) {
          throw new BadRequestException(
            'Default user quota exceeds the storage policy quota',
          );
        }

        if (dto.quotaBytes !== undefined) {
          await transaction.storageSetting.update({
            where: { settingKey: storageSettingsKey },
            data: { quotaBytes, updatedAt: new Date() },
          });
        }
        if (dto.defaultUserQuotaBytes !== undefined) {
          await transaction.workspace.update({
            where: { id: workspaceId },
            data: { defaultUserQuotaBytes, updatedAt: new Date() },
          });
        }
        await transaction.auditEvent.create({
          data: {
            id: this.createAuditId(),
            action: 'file.quota_updated',
            actor: 'account',
            target: workspaceId,
            workspaceId,
            metadata: {
              actorUserId,
              defaultUserQuotaBytes: dto.defaultUserQuotaBytes ?? null,
              quotaBytes: dto.quotaBytes ?? null,
              result: 'success',
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const [settings, usage] = await Promise.all([
      this.storageService.getSettings(),
      this.storageService.getUsage(workspaceId),
    ]);
    return { settings, usage };
  }

  async updateAuthPolicy(dto: UpdateAdminAuthPolicyDto, actorUserId: string) {
    const passkey = dto.passkey
      ? await this.settingsService.validatePasskeySettings(dto.passkey)
      : await this.settingsService.getPasskeySettings();
    const auth = await this.authService.validateSettings(dto.auth, { passkey });

    await this.prisma.$transaction(
      async (transaction) => {
        if (dto.passkey) {
          await transaction.setting.upsert({
            where: {
              parentMeta_meta: { parentMeta: 'system', meta: 'passkey' },
            },
            create: {
              parentMeta: 'system',
              meta: 'passkey',
              value: passkey,
            },
            update: {
              value: passkey,
              updatedAt: new Date(),
            },
          });
        }
        await transaction.authSetting.upsert({
          where: { settingKey: 'global' },
          create: {
            settingKey: 'global',
            localEnabled: auth.localEnabled,
            oauthEnabled: auth.oauthEnabled,
            passkeyEnabled: auth.passkeyEnabled,
            minimumAuthenticationMethods: auth.minimumAuthenticationMethods,
          },
          update: {
            localEnabled: auth.localEnabled,
            oauthEnabled: auth.oauthEnabled,
            passkeyEnabled: auth.passkeyEnabled,
            minimumAuthenticationMethods: auth.minimumAuthenticationMethods,
            updatedAt: new Date(),
          },
        });
        await transaction.auditEvent.create({
          data: {
            id: this.createAuditId(),
            action: 'system.auth_policy_updated',
            actor: 'account',
            target: 'auth-policy',
            metadata: {
              actorUserId,
              localEnabled: auth.localEnabled,
              oauthEnabled: auth.oauthEnabled,
              passkeyEnabled: auth.passkeyEnabled,
              minimumAuthenticationMethods: auth.minimumAuthenticationMethods,
              result: 'success',
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const [savedAuth, savedPasskey] = await Promise.all([
      this.authService.getSettings(),
      this.settingsService.getPasskeySettings(),
    ]);
    return { auth: savedAuth, passkey: savedPasskey };
  }

  private createAuditId() {
    return `audit_${randomBytes(12).toString('base64url')}`;
  }

  private assertSafeQuota(value: number | null | undefined, field: string) {
    if (value === null || value === undefined) return;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestException(
        `${field} must be a non-negative safe integer`,
      );
    }
  }

  private resolveQuota(
    value: number | null | undefined,
    current: bigint | null,
  ) {
    return value === undefined
      ? current
      : value === null
        ? null
        : BigInt(value);
  }
}
