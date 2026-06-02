import { ConfigService } from '@nestjs/config';

export function buildDatabaseUrl(config: ConfigService) {
  if (!config.get<boolean>('database.configured')) {
    throw new Error(
      'DATABASE_HOST, DATABASE_PORT, DATABASE_DBNAME, DATABASE_USER, and DATABASE_PASSWORD are required.',
    );
  }

  const host = config.get<string>('database.host') ?? '';
  const port = config.get<number>('database.port') ?? 5432;
  const dbName = config.get<string>('database.dbName') ?? '';
  const user = encodeURIComponent(config.get<string>('database.user') ?? '');
  const password = encodeURIComponent(
    config.get<string>('database.password') ?? '',
  );
  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}
