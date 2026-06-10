const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const inputDir = path.resolve(workspaceRoot, readOption('input') || 'release-assets');
const outputDir = path.resolve(workspaceRoot, readOption('output') || path.join('dist', 'release'));

if (!existsSync(inputDir)) {
  throw new Error(`Release asset directory does not exist: ${inputDir}`);
}

mkdirSync(outputDir, { recursive: true });

const files = walk(inputDir)
  .filter((filePath) => /^icedr_/.test(path.basename(filePath)))
  .filter((filePath) => !/\.(md5|sha256)$/i.test(filePath))
  .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

if (files.length === 0) {
  throw new Error(`No ICEDR binaries found under ${inputDir}`);
}

const entries = files.map((filePath) => {
  const content = readFileSync(filePath);
  return {
    file: path.basename(filePath),
    md5: createHash('md5').update(content).digest('hex'),
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.byteLength,
  };
});

writeFileSync(
  path.join(outputDir, 'MD5SUMS.txt'),
  entries.map((entry) => `${entry.md5}  ${entry.file}`).join('\n') + '\n',
  'utf8',
);
writeFileSync(
  path.join(outputDir, 'SHA256SUMS.txt'),
  entries.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n') + '\n',
  'utf8',
);
writeFileSync(
  path.join(outputDir, 'release-manifest.json'),
  `${JSON.stringify(
    {
      commit: process.env.GITHUB_SHA || '',
      generatedAt: new Date().toISOString(),
      releaseTag: process.env.GITHUB_REF_NAME || '',
      runId: process.env.GITHUB_RUN_ID || '',
      files: entries,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(`Wrote checksums for ${entries.length} release binaries.`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}
