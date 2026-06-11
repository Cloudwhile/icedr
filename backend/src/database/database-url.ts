import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type DatabaseProvider = 'postgresql' | 'sqlite';

export type PostgresDatabaseSource = {
  provider: 'postgresql';
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
  source: 'env' | 'setup';
  verifiedAt: string | null;
};

export type SqliteDatabaseSource = {
  provider: 'sqlite';
  filePath: string;
  source: 'local';
  verifiedAt: string;
};

export type ActiveDatabaseSource =
  | PostgresDatabaseSource
  | SqliteDatabaseSource;

export type RemoteDatabaseInput = {
  host: string;
  port: number;
  dbName: string;
  user: string;
  password: string;
};

const workspaceRoot = resolve(__dirname, '..', '..', '..');
const dataRoot = process.env.ICEDR_DATA_DIR
  ? resolve(process.env.ICEDR_DATA_DIR)
  : join(workspaceRoot, 'data');
const persistedSourceFile = join(dataRoot, 'database-source.json');
const defaultSqliteFile = join(dataRoot, 'icedr.sqlite');

export function buildDatabaseUrl(config: ConfigService) {
  const source = resolveDatabaseSource(config);
  if (source.provider !== 'postgresql') {
    throw new Error('A PostgreSQL database has not been configured yet.');
  }
  return buildPostgresUrl(source);
}

export function resolveDatabaseSource(
  config: ConfigService,
): ActiveDatabaseSource {
  const envSource = readEnvPostgresSource(config);
  if (envSource) return envSource;

  const persistedSource = readPersistedDatabaseSource();
  if (persistedSource) return persistedSource;

  return {
    provider: 'sqlite',
    filePath: resolveSqliteFilePath(),
    source: 'local',
    verifiedAt: new Date().toISOString(),
  };
}

export function readEnvPostgresSource(
  config: ConfigService,
): PostgresDatabaseSource | null {
  if (!config.get<boolean>('database.configured')) return null;

  return {
    provider: 'postgresql',
    host: config.get<string>('database.host') ?? '',
    port: config.get<number>('database.port') ?? 5432,
    dbName: config.get<string>('database.dbName') ?? '',
    user: config.get<string>('database.user') ?? '',
    password: config.get<string>('database.password') ?? '',
    source: 'env',
    verifiedAt: null,
  };
}

export function toPostgresDatabaseSource(
  input: RemoteDatabaseInput,
): PostgresDatabaseSource {
  return {
    provider: 'postgresql',
    host: input.host.trim(),
    port: input.port,
    dbName: input.dbName.trim(),
    user: input.user.trim(),
    password: input.password,
    source: 'setup',
    verifiedAt: new Date().toISOString(),
  };
}

export function buildPostgresUrl(source: RemoteDatabaseInput) {
  const host = source.host.trim();
  const port = source.port || 5432;
  const dbName = source.dbName.trim();
  const user = encodeURIComponent(source.user.trim());
  const password = encodeURIComponent(source.password);
  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

export function persistDatabaseSource(source: PostgresDatabaseSource) {
  mkdirSync(dirname(persistedSourceFile), { recursive: true });
  writeFileSync(
    persistedSourceFile,
    `${JSON.stringify(
      {
        provider: source.provider,
        host: source.host,
        port: source.port,
        dbName: source.dbName,
        user: source.user,
        password: source.password,
        verifiedAt: source.verifiedAt,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export function readPersistedDatabaseSource(): PostgresDatabaseSource | null {
  if (!existsSync(persistedSourceFile)) return null;

  try {
    const parsed = JSON.parse(
      readFileSync(persistedSourceFile, 'utf8'),
    ) as Partial<PostgresDatabaseSource> | null;
    if (!parsed || parsed.provider !== 'postgresql') return null;
    if (!parsed.host || !parsed.dbName || !parsed.user) return null;
    return {
      provider: 'postgresql',
      host: String(parsed.host),
      port: Number(parsed.port || 5432),
      dbName: String(parsed.dbName),
      user: String(parsed.user),
      password: String(parsed.password ?? ''),
      source: 'setup',
      verifiedAt: parsed.verifiedAt ? String(parsed.verifiedAt) : null,
    };
  } catch {
    return null;
  }
}

export function resolveSqliteFilePath() {
  const configured = process.env.SQLITE_DATABASE_PATH?.trim();
  if (!configured) return defaultSqliteFile;
  return isAbsolute(configured)
    ? configured
    : resolve(workspaceRoot, configured);
}

export function getSqlitePrismaUrl() {
  return `file:${resolveSqliteFilePath().replace(/\\/g, '/')}`;
}
