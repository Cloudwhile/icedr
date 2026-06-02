const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
  const prismaPackage = require.resolve('prisma/package.json', {
    paths: [backendRoot],
  });
  const prismaCli = path.join(path.dirname(prismaPackage), 'build', 'index.js');
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      'generate',
      '--schema',
      '../database/schema.prisma',
      '--config',
      '../prisma.config.ts',
    ],
    {
      cwd: backendRoot,
      stdio: 'inherit',
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  releaseLock();
}
