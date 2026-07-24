const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Client } = require('pg');

const migrationNames = [
  '20260718120000_transfer_task_lifecycle',
  '20260718121000_transfer_lifecycle_indexes',
  '20260718121100_file_versions_object_key_index',
  '20260718121200_preview_source_object_key_index',
  '20260718121300_preview_object_key_index',
  '20260718121400_transfer_tasks_object_key_index',
  '20260718121500_upload_sessions_object_key_index',
  '20260718121600_upload_sessions_transfer_id_index',
  '20260718121700_upload_completion_started_at_index',
];
const lifecycleTables = [
  'preview_artifacts',
  'upload_sessions',
  'transfer_tasks',
  'blob_reconcile_tasks',
];
const legacyStatuses = ['queued', 'ready', 'unsupported', 'cancelled'];
const lifecycleIndexes = [
  'file_nodes_object_key_idx',
  'file_versions_object_key_idx',
  'preview_artifacts_source_object_key_idx',
  'preview_artifacts_preview_object_key_idx',
  'transfer_tasks_object_key_idx',
  'upload_sessions_object_key_idx',
  'upload_sessions_transfer_id_idx',
  'upload_sessions_completion_started_at_idx',
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const prismaConfig = (
    await import(pathToFileURL(path.join(workspaceRoot, 'prisma.config.ts')).href)
  ).default;
  const client = new Client({ connectionString: prismaConfig.datasource.url });

  await client.connect();
  try {
    const report = {
      serverVersion: await queryServerVersion(client),
      migrations: await queryMigrations(client),
      legacyStatuses: await queryLegacyStatuses(client),
      uploadSessionNodeBackfill: await queryUploadSessionNodeBackfill(client),
      indexes: await queryIndexes(client),
    };
    const backupPath = readBackupPath(process.argv.slice(2));
    if (backupPath) {
      const backupReport = {
        ...report,
        legacyRows: await queryLegacyRows(client),
      };
      writeBackup(backupPath, backupReport);
      report.backupPath = backupPath;
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

function readBackupPath(args) {
  const backupIndex = args.indexOf('--backup');
  if (backupIndex < 0) return null;
  const configuredPath = args[backupIndex + 1];
  if (!configuredPath) {
    throw new Error('Expected a file path after --backup.');
  }
  return path.resolve(configuredPath);
}

function writeBackup(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function queryServerVersion(client) {
  const result = await client.query(
    'select current_setting($1) as version',
    ['server_version'],
  );
  return result.rows[0]?.version ?? null;
}

async function queryMigrations(client) {
  const result = await client.query(
    `
      select migration_name, started_at, finished_at, rolled_back_at, logs
      from _prisma_migrations
      where migration_name = any($1::text[])
      order by migration_name, started_at
    `,
    [migrationNames],
  );
  return result.rows;
}

async function queryLegacyStatuses(client) {
  const report = {};
  for (const tableName of lifecycleTables) {
    const result = await client.query(
      `
        select status, count(*)::int as count
        from "${tableName}"
        where status = any($1::text[])
        group by status
        order by status
      `,
      [legacyStatuses],
    );
    report[tableName] = result.rows;
  }
  return report;
}

async function queryLegacyRows(client) {
  const report = {};
  for (const tableName of lifecycleTables) {
    const result = await client.query(
      `
        select id, status
        from "${tableName}"
        where status = any($1::text[])
        order by id
      `,
      [legacyStatuses],
    );
    report[tableName] = result.rows;
  }
  return report;
}

async function queryUploadSessionNodeBackfill(client) {
  const nodeIdExists = await columnExists(client, 'upload_sessions', 'node_id');
  const nodeIdPredicate = nodeIdExists ? 'and session.node_id is null' : '';
  const result = await client.query(`
    select
      count(*) filter (where task.node_id is not null)::int as backfillable,
      count(*) filter (where task.id is null or task.node_id is null)::int as unresolved
    from upload_sessions as session
    left join transfer_tasks as task on task.id = session.transfer_id
    where session.status in ('completed', 'ready')
      ${nodeIdPredicate}
  `);
  return {
    nodeIdColumnExists: nodeIdExists,
    backfillable: result.rows[0]?.backfillable ?? 0,
    unresolved: result.rows[0]?.unresolved ?? 0,
  };
}

async function queryIndexes(client) {
  const result = await client.query(
    `
      select
        index_class.relname as index_name,
        index.indisvalid,
        index.indisready
      from pg_index as index
      join pg_class as index_class on index_class.oid = index.indexrelid
      where index_class.relname = any($1::text[])
      order by index_class.relname
    `,
    [lifecycleIndexes],
  );
  return result.rows;
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `
      select exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = $1
          and column_name = $2
      ) as exists
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}
