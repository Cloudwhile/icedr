const { createHash } = require('node:crypto');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const detailsFile = path.resolve(workspaceRoot, readOption('details') || 'release_details.md');
const checksumsDir = path.resolve(workspaceRoot, readOption('checksums') || path.join('dist', 'release'));
const outputFile = path.resolve(workspaceRoot, readOption('output') || path.join('dist', 'release', 'RELEASE_NOTES.md'));

if (!existsSync(detailsFile)) {
  throw new Error(`Release notes source file does not exist: ${path.relative(workspaceRoot, detailsFile)}`);
}

const details = readFileSync(detailsFile, 'utf8').trim();
const manifest = readManifest();

mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(
  outputFile,
  renderReleaseNotes(details, manifest),
  'utf8',
);
console.log(`Wrote ${path.relative(workspaceRoot, outputFile)}`);

function renderReleaseNotes(details, manifest) {
  const sections = [details || '# Release Notes'];
  sections.push(renderReleaseAssets(manifest));
  sections.push(renderFileChecksumInstructions());
  return `${sections.join('\n\n')}\n`;
}

function renderFileChecksumInstructions() {
  return [
    '## File Checksums',
    '',
    '下载目标文件和 `SHA256SUMS.txt` 后，在同一目录运行：',
    '',
    '```bash',
    'sha256sum -c SHA256SUMS.txt --ignore-missing',
    '```',
    '',
    '如需兼容性校验，也可以下载 `MD5SUMS.txt` 后运行：',
    '',
    '```bash',
    'md5sum -c MD5SUMS.txt --ignore-missing',
    '```',
    '',
    '命令输出 `OK` 表示本地文件与 Release 中记录的 checksum 匹配。',
  ].join('\n');
}

function renderReleaseAssets(manifest) {
  const entries = buildReleaseAssetEntries(manifest);
  if (entries.length === 0) return '## Release Assets\n\nNo release assets are available.';

  const lines = [
    '## Release Assets',
    '',
    '| File | Size | MD5 | SHA256 |',
    '| --- | ---: | --- | --- |',
    ...entries.map((entry) =>
      `| ${[
        `[${entry.file}](${entry.url})`,
        formatBytes(entry.size),
        `\`${entry.md5 || '-'}\``,
        `\`${entry.sha256 || '-'}\``,
      ].join(' | ')} |`,
    ),
  ];
  return lines.join('\n');
}

function buildReleaseAssetEntries(manifest) {
  const binaryEntries = Array.isArray(manifest.files)
    ? manifest.files.map((entry) => ({
        file: readString(entry.file),
        md5: readString(entry.md5),
        sha256: readString(entry.sha256),
        size: readNumber(entry.size),
      }))
    : [];
  const checksumEntries = [
    buildGeneratedFileEntry('MD5SUMS.txt'),
    buildGeneratedFileEntry('SHA256SUMS.txt'),
    buildGeneratedFileEntry('release-manifest.json'),
  ];

  return [...binaryEntries, ...checksumEntries]
    .filter((entry) => entry.file)
    .map((entry) => ({
      ...entry,
      url: createReleaseAssetUrl(entry.file, manifest),
    }));
}

function buildGeneratedFileEntry(file) {
  const filePath = path.join(checksumsDir, file);
  const content = existsSync(filePath) ? readFileSync(filePath) : null;
  return {
    file,
    md5: content ? createHash('md5').update(content).digest('hex') : '',
    sha256: content ? createHash('sha256').update(content).digest('hex') : '',
    size: content ? statSync(filePath).size : 0,
  };
}

function createReleaseAssetUrl(file, manifest) {
  const repository =
    readString(process.env.GITHUB_REPOSITORY) ||
    readString(manifest.repository) ||
    'Cloudwhile/icedr';
  const tag =
    readString(process.env.GITHUB_REF_NAME) ||
    readString(manifest.releaseTag) ||
    'v0.0.1-alpha.1';

  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

function readManifest() {
  const filePath = path.join(checksumsDir, 'release-manifest.json');
  if (!existsSync(filePath)) {
    throw new Error(`Release manifest does not exist: ${path.relative(workspaceRoot, filePath)}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}
