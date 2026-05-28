import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StorageSettings } from './storage-settings.dto';

const storageSettingsKey = 'global';

export const defaultStorageSettings: StorageSettings = {
  distributedStorageEnabled: true,
  endpoint: '',
  region: 'us-east-1',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
  updatedAt: new Date(0).toISOString(),
};

type StorageSettingsRow = {
  setting_key: string;
  distributed_storage_enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_access_key: string;
  force_path_style: boolean;
  updated_at: Date | string;
};

@Injectable()
export class StorageSettingsRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.database.query(`
      create table if not exists storage_settings (
        setting_key text primary key,
        distributed_storage_enabled boolean not null,
        endpoint text not null default '',
        region text not null default 'us-east-1',
        bucket text not null default '',
        access_key_id text not null default '',
        secret_access_key text not null default '',
        force_path_style boolean not null default true,
        updated_at timestamptz not null default now()
      )
    `);

    await this.database.query(`
      alter table storage_settings
        add column if not exists endpoint text not null default '',
        add column if not exists region text not null default 'us-east-1',
        add column if not exists bucket text not null default '',
        add column if not exists access_key_id text not null default '',
        add column if not exists secret_access_key text not null default '',
        add column if not exists force_path_style boolean not null default true
    `);

    await this.database.query(
      `
        insert into storage_settings (
          setting_key,
          distributed_storage_enabled,
          endpoint,
          region,
          bucket,
          access_key_id,
          secret_access_key,
          force_path_style,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, now())
        on conflict (setting_key) do nothing
      `,
      [
        storageSettingsKey,
        defaultStorageSettings.distributedStorageEnabled,
        defaultStorageSettings.endpoint,
        defaultStorageSettings.region,
        defaultStorageSettings.bucket,
        defaultStorageSettings.accessKeyId,
        defaultStorageSettings.secretAccessKey,
        defaultStorageSettings.forcePathStyle,
      ],
    );
  }

  async get(): Promise<StorageSettings> {
    const result = await this.database.query<StorageSettingsRow>(
      'select * from storage_settings where setting_key = $1 limit 1',
      [storageSettingsKey],
    );
    if (result.rows[0]) return this.mapRow(result.rows[0]);
    return this.update(defaultStorageSettings);
  }

  async update(settings: StorageSettings): Promise<StorageSettings> {
    const result = await this.database.query<StorageSettingsRow>(
      `
        insert into storage_settings (
          setting_key,
          distributed_storage_enabled,
          endpoint,
          region,
          bucket,
          access_key_id,
          secret_access_key,
          force_path_style,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, now())
        on conflict (setting_key) do update set
          distributed_storage_enabled = excluded.distributed_storage_enabled,
          endpoint = excluded.endpoint,
          region = excluded.region,
          bucket = excluded.bucket,
          access_key_id = excluded.access_key_id,
          secret_access_key = excluded.secret_access_key,
          force_path_style = excluded.force_path_style,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        storageSettingsKey,
        settings.distributedStorageEnabled,
        settings.endpoint,
        settings.region,
        settings.bucket,
        settings.accessKeyId,
        settings.secretAccessKey,
        settings.forcePathStyle,
      ],
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: StorageSettingsRow): StorageSettings {
    return {
      distributedStorageEnabled: row.distributed_storage_enabled,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      accessKeyId: row.access_key_id,
      secretAccessKey: row.secret_access_key,
      forcePathStyle: row.force_path_style,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
    };
  }
}
