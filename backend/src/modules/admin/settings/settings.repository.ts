import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JsonRecord } from './settings.dto';

export const settingsParentMeta = 'system';
export const bootstrapMeta = 'bootstrap';
export const databaseMeta = 'database';
export const siteMeta = 'site';
export const translationsMeta = 'translations';
export const oauthMeta = 'oauth';
export const passkeyMeta = 'passkey';
export const mailMeta = 'mail';

@Injectable()
export class SettingsRepository implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensure(settingsParentMeta, bootstrapMeta, {
      completed: false,
      completedAt: null,
    });
  }

  async ensure(parentMeta: string, meta: string, value: JsonRecord) {
    await this.prisma.setting.upsert({
      where: { parentMeta_meta: { parentMeta, meta } },
      update: {},
      create: {
        parentMeta,
        meta,
        value: this.toPrismaJson(value),
      },
    });
  }

  async get<T extends JsonRecord>(
    parentMeta: string,
    meta: string,
    fallback: T,
  ): Promise<T> {
    const row = await this.prisma.setting.findUnique({
      where: { parentMeta_meta: { parentMeta, meta } },
    });
    if (!row) return fallback;
    return this.parseValue(row.value, fallback);
  }

  async set<T extends JsonRecord>(
    parentMeta: string,
    meta: string,
    value: T,
  ): Promise<T> {
    const row = await this.prisma.setting.upsert({
      where: { parentMeta_meta: { parentMeta, meta } },
      create: {
        parentMeta,
        meta,
        value: this.toPrismaJson(value),
      },
      update: {
        value: this.toPrismaJson(value),
        updatedAt: new Date(),
      },
    });
    return this.parseValue(row.value, value);
  }

  private parseValue<T extends JsonRecord>(value: unknown, fallback: T) {
    if (this.isJsonRecord(value)) return value as T;
    if (typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private toPrismaJson(value: JsonRecord): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private isJsonRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }
}
