import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { JsonRecord } from './settings.dto';

export const settingsParentMeta = 'system';
export const bootstrapMeta = 'bootstrap';
export const databaseMeta = 'database';
export const siteMeta = 'site';
export const translationsMeta = 'translations';
export const oauthMeta = 'oauth';
export const passkeyMeta = 'passkey';
export const mailMeta = 'mail';

type SettingRow = {
  parent_meta: string;
  meta: string;
  value: JsonRecord | string;
  updated_at: Date | string;
};

@Injectable()
export class SettingsRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists settings (
        parent_meta text not null,
        meta text not null,
        value jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (parent_meta, meta)
      )
    `);

    await this.ensure(settingsParentMeta, bootstrapMeta, {
      completed: false,
      completedAt: null,
    });
  }

  async ensure(parentMeta: string, meta: string, value: JsonRecord) {
    await this.database.query(
      `
        insert into settings (parent_meta, meta, value, updated_at)
        values ($1, $2, $3::jsonb, now())
        on conflict (parent_meta, meta) do nothing
      `,
      [parentMeta, meta, JSON.stringify(value)],
    );
  }

  async get<T extends JsonRecord>(
    parentMeta: string,
    meta: string,
    fallback: T,
  ): Promise<T> {
    const result = await this.database.query<SettingRow>(
      'select * from settings where parent_meta = $1 and meta = $2 limit 1',
      [parentMeta, meta],
    );
    if (!result.rows[0]) return fallback;
    return this.parseValue(result.rows[0].value, fallback);
  }

  async set<T extends JsonRecord>(
    parentMeta: string,
    meta: string,
    value: T,
  ): Promise<T> {
    const result = await this.database.query<SettingRow>(
      `
        insert into settings (parent_meta, meta, value, updated_at)
        values ($1, $2, $3::jsonb, now())
        on conflict (parent_meta, meta) do update set
          value = excluded.value,
          updated_at = excluded.updated_at
        returning *
      `,
      [parentMeta, meta, JSON.stringify(value)],
    );
    return this.parseValue(result.rows[0].value, value);
  }

  private parseValue<T extends JsonRecord>(
    value: JsonRecord | string,
    fallback: T,
  ) {
    if (typeof value !== 'string') return value as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
