const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { writeSqliteSchema } = require('./create-sqlite-schema.cjs');

const backendRoot = path.resolve(__dirname, '..');
const lockDir = path.join(backendRoot, '.prisma-generate.lock');
const staleMs = 2 * 60 * 1000;

function sleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function acquireLock() {
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
      return;
    } catch (error) {
      if (error && error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      sleep(250);
    }
  }
}

function releaseLock() {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

acquireLock();
try {
  writeSqliteSchema();
  const prismaPackage = require.resolve('prisma/package.json', {
    paths: [backendRoot],
  });
  const prismaCli = path.join(path.dirname(prismaPackage), 'build', 'index.js');
  const postgresResult = runGenerate(prismaCli, '../database/schema.prisma');
  if ((postgresResult.status ?? 1) !== 0) {
    process.exitCode = postgresResult.status ?? 1;
    return;
  }
  const sqliteResult = runGenerate(prismaCli, '../database/schema.sqlite.prisma');
  process.exitCode = sqliteResult.status ?? 1;
} finally {
  releaseLock();
}

function runGenerate(prismaCli, schema) {
  return spawnSync(
    process.execPath,
    [
      prismaCli,
      'generate',
      '--schema',
      schema,
      '--config',
      '../prisma.config.ts',
    ],
    {
      cwd: backendRoot,
      stdio: 'inherit',
    },
  );
}
