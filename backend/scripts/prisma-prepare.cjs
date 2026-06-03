const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const backendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(backendRoot, '..');
const baselineMigration = '20260602170000_init_prisma';
const requiredBaselineTables = [
  'auth_settings',
  'users',
  'user_identities',
  'auth_sessions',
  'workspaces',
  'file_nodes',
  'settings',
];

const prismaPackage = require.resolve('prisma/package.json', {
  paths: [backendRoot],
});
const prismaCli = path.join(path.dirname(prismaPackage), 'build', 'index.js');

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  runPrismaOrExit('generate');

  const deployResult = runPrisma('migrate', 'deploy');
  if (deployResult.status === 0) return;

  const output = `${deployResult.stdout ?? ''}${deployResult.stderr ?? ''}`;
  if (!output.includes('P3005')) {
    process.exit(deployResult.status ?? 1);
  }

  await assertExistingIcedrBaseline();
  console.warn(
    `Existing ICEDR database detected without Prisma history; baselining ${baselineMigration}.`,
  );
  runPrismaOrExit('migrate', 'resolve', '--applied', baselineMigration);
  runPrismaOrExit('migrate', 'deploy');
}

function runPrismaOrExit(...args) {
  const result = runPrisma(...args);
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPrisma(...args) {
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      ...args,
      '--schema',
      '../database/schema.prisma',
      '--config',
      '../prisma.config.ts',
    ],
    {
      cwd: backendRoot,
      encoding: 'utf8',
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

async function assertExistingIcedrBaseline() {
  loadWorkspaceEnv();
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    const migrationsTableExists = await tableExists(client, '_prisma_migrations');
    if (migrationsTableExists) return;

    const existingTables = await listExistingTables(client, requiredBaselineTables);
    const missingTables = requiredBaselineTables.filter(
      (table) => !existingTables.has(table),
    );
    if (missingTables.length > 0) {
      throw new Error(
        `Refusing to baseline Prisma migrations because this database is missing ICEDR baseline tables: ${missingTables.join(', ')}`,
      );
    }
  } finally {
    await client.end();
  }
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = current_schema()
          and table_name = $1
      ) as exists
    `,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function listExistingTables(client, tableNames) {
  const result = await client.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_name = any($1::text[])
    `,
    [tableNames],
  );
  return new Set(result.rows.map((row) => row.table_name));
}

function loadWorkspaceEnv() {
  for (const fileName of ['.env.local', '.env']) {
    loadEnvFile(path.join(workspaceRoot, fileName));
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
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

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
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
