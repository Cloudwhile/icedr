import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JsonRecord } from './settings.dto';
import { retryPrismaSerializableTransaction } from '../../../common/database/serializable-transaction-retry';

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
    validate?: (
      tx: Prisma.TransactionClient,
      previousValue: Prisma.JsonValue | null,
    ) => Promise<void>,
  ): Promise<T> {
    const save = async (db: Pick<Prisma.TransactionClient, 'setting'>) =>
      db.setting.upsert({
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
    if (!validate)
      return this.parseValue((await save(this.prisma)).value, value);
    return retryPrismaSerializableTransaction(() =>
      this.prisma.$transaction(
        async (tx) => {
          const previous = await tx.setting.findUnique({
            where: { parentMeta_meta: { parentMeta, meta } },
          });
          const row = await save(tx);
          await validate(tx, previous?.value ?? null);
          return this.parseValue(row.value, value);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
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
