import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = dirname(fileURLToPath(import.meta.url));

for (const fileName of ['.env.local', '.env']) {
  loadEnvFile(join(configDirectory, fileName));
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.DATABASE_HOST ?? '';
  const port = process.env.DATABASE_PORT ?? '5432';
  const dbName = process.env.DATABASE_DBNAME ?? '';
  const user = encodeURIComponent(process.env.DATABASE_USER ?? '');
  const password = encodeURIComponent(process.env.DATABASE_PASSWORD ?? '');

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
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
