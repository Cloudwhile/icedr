const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Client } = require('pg');

const indexMigrations = [
  {
    migrationName: '20260718121000_transfer_lifecycle_indexes',
    indexName: 'file_nodes_object_key_idx',
  },
  {
    migrationName: '20260718121100_file_versions_object_key_index',
    indexName: 'file_versions_object_key_idx',
  },
  {
    migrationName: '20260718121200_preview_source_object_key_index',
    indexName: 'preview_artifacts_source_object_key_idx',
  },
  {
    migrationName: '20260718121300_preview_object_key_index',
    indexName: 'preview_artifacts_preview_object_key_idx',
  },
  {
    migrationName: '20260718121400_transfer_tasks_object_key_index',
    indexName: 'transfer_tasks_object_key_idx',
  },
  {
    migrationName: '20260718121500_upload_sessions_object_key_index',
    indexName: 'upload_sessions_object_key_idx',
  },
  {
    migrationName: '20260718121600_upload_sessions_transfer_id_index',
    indexName: 'upload_sessions_transfer_id_idx',
  },
  {
    migrationName: '20260718121700_upload_completion_started_at_index',
    indexName: 'upload_sessions_completion_started_at_idx',
  },
  {
    migrationName: '20260730120000_upload_session_resume_identity_index',
    indexName: 'upload_sessions_resume_identity_active_idx',
  },
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
  const apply = process.argv.slice(2).includes('--apply');

  await client.connect();
  try {
    const schemaName = await queryCurrentSchema(client);
    const migrations = await queryMigrations(client);
    const indexes = await queryIndexes(client, schemaName);
    const recovery = indexMigrations.flatMap((entry) => {
      const migration = migrations.get(entry.migrationName);
      const index = indexes.get(entry.indexName);
      if (migration?.finished) return [];
      if (!index) return [];
      return [{ ...entry, index, unresolved: Boolean(migration?.unresolved) }];
    });
    const finishedInvalid = indexMigrations.flatMap((entry) => {
      const migration = migrations.get(entry.migrationName);
      const index = indexes.get(entry.indexName);
      return migration?.finished && index && (!index.indisvalid || !index.indisready)
        ? [{ ...entry, index }]
        : [];
    });

    const dropped = [];
    if (apply) {
      for (const entry of recovery) {
        await client.query(
          `DROP INDEX CONCURRENTLY IF EXISTS ${quoteIdentifier(schemaName)}.${quoteIdentifier(entry.indexName)}`,
        );
        dropped.push(entry.indexName);
      }
    }

    process.stdout.write(`${JSON.stringify({
      apply,
      dropped,
      finishedInvalid,
      recovery,
      schemaName,
    }, null, 2)}\n`);

    if (finishedInvalid.length > 0) {
      throw new Error(
        'A finished migration has an invalid index; repair it with a new migration.',
      );
    }
  } finally {
    await client.end();
  }
}

async function queryCurrentSchema(client) {
  const result = await client.query('select current_schema() as schema_name');
  const schemaName = result.rows[0]?.schema_name;
  if (!schemaName) throw new Error('Unable to resolve the current database schema.');
  return schemaName;
}

async function queryMigrations(client) {
  const result = await client.query(
    `
      select migration_name, finished_at, rolled_back_at
      from _prisma_migrations
      where migration_name = any($1::text[])
      order by started_at desc
    `,
    [indexMigrations.map((entry) => entry.migrationName)],
  );
  const migrations = new Map();
  for (const row of result.rows) {
    if (migrations.has(row.migration_name)) continue;
    migrations.set(row.migration_name, {
      finished: Boolean(row.finished_at) && !row.rolled_back_at,
      unresolved: !row.finished_at && !row.rolled_back_at,
    });
  }
  return migrations;
}

async function queryIndexes(client, schemaName) {
  const result = await client.query(
    `
      select index_class.relname as index_name, index.indisvalid, index.indisready
      from pg_index as index
      join pg_class as index_class on index_class.oid = index.indexrelid
      join pg_namespace as namespace on namespace.oid = index_class.relnamespace
      where namespace.nspname = $1
        and index_class.relname = any($2::text[])
    `,
    [schemaName, indexMigrations.map((entry) => entry.indexName)],
  );
  return new Map(result.rows.map((row) => [row.index_name, row]));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
