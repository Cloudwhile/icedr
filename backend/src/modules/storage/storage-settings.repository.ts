import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { StorageSetting } from '../../generated/prisma/client';
import { StorageSettings } from './storage-settings.dto';

const storageSettingsKey = 'global';

export const defaultStorageSettings: StorageSettings = {
  distributedStorageEnabled: true,
  quotaBytes: null,
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
  updatedAt: new Date(0).toISOString(),
};

@Injectable()
export class StorageSettingsRepository implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefault();
  }

  async get(): Promise<StorageSettings> {
    const row = await this.prisma.storageSetting.findUnique({
      where: { settingKey: storageSettingsKey },
    });
    if (row) return this.mapRow(row);
    return this.update(defaultStorageSettings);
  }

  async initializeQuota(quotaBytes: number | null) {
    const current = await this.get();
    if (current.quotaBytes !== null) return current;
    return this.update({ ...current, quotaBytes });
  }

  async update(settings: StorageSettings): Promise<StorageSettings> {
    const row = await this.prisma.storageSetting.upsert({
      where: { settingKey: storageSettingsKey },
      create: this.toPrismaCreate(settings),
      update: {
        distributedStorageEnabled: settings.distributedStorageEnabled,
        quotaBytes:
          settings.quotaBytes === null ? null : BigInt(settings.quotaBytes),
        endpoint: settings.endpoint,
        region: settings.region,
        bucket: settings.bucket,
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
        forcePathStyle: settings.forcePathStyle,
        updatedAt: new Date(),
      },
    });
    return this.mapRow(row);
  }

  private async ensureDefault() {
    await this.prisma.storageSetting.upsert({
      where: { settingKey: storageSettingsKey },
      update: {},
      create: this.toPrismaCreate(defaultStorageSettings),
    });
  }

  private toPrismaCreate(settings: StorageSettings) {
    return {
      settingKey: storageSettingsKey,
      distributedStorageEnabled: settings.distributedStorageEnabled,
      quotaBytes:
        settings.quotaBytes === null ? null : BigInt(settings.quotaBytes),
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      forcePathStyle: settings.forcePathStyle,
    };
  }

  private mapRow(row: StorageSetting): StorageSettings {
    return {
      distributedStorageEnabled: row.distributedStorageEnabled,
      quotaBytes:
        row.quotaBytes !== null && row.quotaBytes !== undefined
          ? Number(row.quotaBytes)
          : null,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.accessKeyId,
      secretAccessKey: row.secretAccessKey,
      forcePathStyle: row.forcePathStyle,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
