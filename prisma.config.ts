import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));

for (const fileName of ['.env.local', '.env']) {
  loadEnvFile(join(configDirectory, fileName));
}

const dataDirectory = process.env.ICEDR_DATA_DIR
  ? resolve(process.env.ICEDR_DATA_DIR)
  : join(configDirectory, 'data');
const persistedSourceFile = join(dataDirectory, 'database-source.json');

function getDatabaseUrl() {
  if (process.env.PRISMA_DATABASE_PROVIDER === 'sqlite') {
    return process.env.SQLITE_DATABASE_URL || getSqliteDatabaseUrl();
  }

  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const persisted = readPersistedDatabaseSource();
  if (persisted) return persisted;

  const host = process.env.DATABASE_HOST ?? '';
  const port = process.env.DATABASE_PORT ?? '5432';
  const dbName = process.env.DATABASE_DBNAME ?? '';
  const user = encodeURIComponent(process.env.DATABASE_USER ?? '');
  const password = encodeURIComponent(process.env.DATABASE_PASSWORD ?? '');

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

function getSqliteDatabaseUrl() {
  const configured = process.env.SQLITE_DATABASE_PATH?.trim();
  const databasePath = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(configDirectory, configured)
    : join(dataDirectory, 'icedr.sqlite');
  return `file:${databasePath.replace(/\\/g, '/')}`;
}

function readPersistedDatabaseSource() {
  if (!existsSync(persistedSourceFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(persistedSourceFile, 'utf8')) as
      | Record<string, unknown>
      | null;
    if (!parsed || parsed.provider !== 'postgresql') return null;
    const host = String(parsed.host ?? '');
    const port = String(parsed.port ?? '5432');
    const dbName = String(parsed.dbName ?? '');
    const user = encodeURIComponent(String(parsed.user ?? ''));
    const password = encodeURIComponent(String(parsed.password ?? ''));
    if (!host || !dbName || !user) return null;
    return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
  } catch {
    return null;
  }
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripEnvQuotes(trimmed.slice(separatorIndex + 1).trim());
  }
}

function stripEnvQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export default {
  schema: 'database/schema.prisma',
  migrations: {
    path: 'database/migrations',
  },
  datasource: {
    url: getDatabaseUrl(),
  },
};
