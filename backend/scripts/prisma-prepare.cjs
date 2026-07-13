const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { Client } = require('pg');
const { writeSqliteSchema } = require('./create-sqlite-schema.cjs');

const backendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(backendRoot, '..');
const baselineMigration = '20260602170000_init_prisma';
const databaseConnectionTimeoutMillis = 5000;
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
  writeSqliteSchema();

  loadWorkspaceEnv();
  if (shouldUseSqliteSource()) {
    const sqliteFilePath = resolveSqliteFilePath();
    fs.mkdirSync(path.dirname(sqliteFilePath), { recursive: true });
    prepareSqliteFileNodeNameKeys(sqliteFilePath);
    runPrismaOrExit('db', 'push', {
      schema: '../database/schema.sqlite.prisma',
      env: {
        ...process.env,
        PRISMA_DATABASE_PROVIDER: 'sqlite',
      },
    });
    return;
  }

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

function shouldUseSqliteSource() {
  return readDatabaseProvider() === 'sqlite' || !hasPostgresSource();
}

function readDatabaseProvider() {
  return process.env.PRISMA_DATABASE_PROVIDER?.trim().toLowerCase() || '';
}

function runPrismaOrExit(...args) {
  const options =
    typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])
      ? args.pop()
      : {};
  const result = runPrisma(...args, options);
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runPrisma(...args) {
  const options =
    typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])
      ? args.pop()
      : {};
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      ...args,
      '--schema',
      options.schema || '../database/schema.prisma',
      '--config',
      '../prisma.config.ts',
    ],
    {
      cwd: backendRoot,
      encoding: 'utf8',
      env: options.env || process.env,
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function hasPostgresSource() {
  if (process.env.DATABASE_URL) return true;
  if (
    process.env.DATABASE_HOST &&
    process.env.DATABASE_PORT &&
    process.env.DATABASE_DBNAME &&
    process.env.DATABASE_USER &&
    process.env.DATABASE_PASSWORD
  ) {
    return true;
  }
  return Boolean(readPersistedDatabaseSource());
}

function readPersistedDatabaseSource() {
  const filePath = path.join(resolveDataRoot(), 'database-source.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed?.provider === 'postgresql' ? parsed : null;
  } catch {
    return null;
  }
}

function resolveDataRoot() {
  return process.env.ICEDR_DATA_DIR
    ? path.resolve(process.env.ICEDR_DATA_DIR)
    : path.join(workspaceRoot, 'data');
}

function resolveSqliteFilePath() {
  const configured = process.env.SQLITE_DATABASE_PATH?.trim();
  if (!configured) return path.join(resolveDataRoot(), 'icedr.sqlite');
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(workspaceRoot, configured);
}

function prepareSqliteFileNodeNameKeys(filePath) {
  const nativeBinding = process.env.BETTER_SQLITE3_NATIVE_BINDING?.trim();
  const database = new Database(
    filePath,
    nativeBinding ? { nativeBinding } : undefined,
  );
  try {
    const fileNodesTable = database
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get('file_nodes');
    if (!fileNodesTable) return;

    const columns = new Set(
      database
        .prepare('PRAGMA table_info("file_nodes")')
        .all()
        .map((column) => column.name),
    );
    const ensureColumn = (name, definition) => {
      if (columns.has(name)) return;
      database.exec(
        `ALTER TABLE "file_nodes" ADD COLUMN "${name}" ${definition}`,
      );
      columns.add(name);
    };

    const prepareKeys = database.transaction(() => {
      ensureColumn('space_scope', "TEXT NOT NULL DEFAULT 'workspace'");
      ensureColumn('directory_key', "TEXT NOT NULL DEFAULT ''");
      ensureColumn('owner_scope_key', "TEXT NOT NULL DEFAULT ''");
      ensureColumn('name_key', "TEXT NOT NULL DEFAULT ''");
      database
        .prepare(
          'UPDATE "file_nodes" SET "directory_key" = COALESCE("parent_node_id", \'\') WHERE "directory_key" = \'\'',
        )
        .run();
      if (columns.has('space_scope') && columns.has('owner_user_id')) {
        database
          .prepare(
            'UPDATE "file_nodes" SET "owner_scope_key" = CASE WHEN "space_scope" = \'personal\' THEN COALESCE("owner_user_id", \'\') ELSE \'\' END WHERE "owner_scope_key" = \'\'',
          )
          .run();
      }
      const nameKeyExpression = columns.has('archived_at')
        ? 'CASE WHEN "archived_at" IS NULL THEN \'legacy:\' || "id" ELSE \'archived:\' || "id" END'
        : '\'legacy:\' || "id"';
      database
        .prepare(
          `UPDATE "file_nodes" SET "name_key" = ${nameKeyExpression} WHERE "name_key" = ''`,
        )
        .run();
      database.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS "file_nodes_scope_directory_name_key" ON "file_nodes"("workspace_id", "space_scope", "owner_scope_key", "directory_key", "name_key")',
      );
    });
    prepareKeys();
  } finally {
    database.close();
  }
}

async function assertExistingIcedrBaseline() {
  loadWorkspaceEnv();
  const client = new Client({
    connectionString: getDatabaseUrl(),
    connectionTimeoutMillis: databaseConnectionTimeoutMillis,
  });
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
  const missing = [];
  if (!host) missing.push('DATABASE_HOST');
  if (!dbName) missing.push('DATABASE_DBNAME');
  if (missing.length > 0) {
    throw new Error(
      `DATABASE_URL is not set and required database environment variables are missing: ${missing.join(', ')}`,
    );
  }
  const user = encodeURIComponent(process.env.DATABASE_USER ?? '');
  const password = encodeURIComponent(process.env.DATABASE_PASSWORD ?? '');

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}
