const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const detailsFile = path.resolve(workspaceRoot, readOption('details') || 'release_details.md');
const checksumsDir = path.resolve(workspaceRoot, readOption('checksums') || path.join('dist', 'release'));
const outputFile = path.resolve(workspaceRoot, readOption('output') || path.join('dist', 'release', 'RELEASE_NOTES.md'));

if (!existsSync(detailsFile)) {
  throw new Error(`Release notes source file does not exist: ${path.relative(workspaceRoot, detailsFile)}`);
}

const details = readFileSync(detailsFile, 'utf8').trim();
const md5 = readChecksumFile('MD5SUMS.txt');
const sha256 = readChecksumFile('SHA256SUMS.txt');

mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(outputFile, renderReleaseNotes(details, md5, sha256), 'utf8');
console.log(`Wrote ${path.relative(workspaceRoot, outputFile)}`);

function renderReleaseNotes(details, md5, sha256) {
  const sections = [details || '# Release Notes'];
  sections.push('## File Checksums');
  sections.push('### MD5');
  sections.push(['```text', md5.trim(), '```'].join('\n'));
  sections.push('### SHA256');
  sections.push(['```text', sha256.trim(), '```'].join('\n'));
  return `${sections.join('\n\n')}\n`;
}

function readChecksumFile(fileName) {
  const filePath = path.join(checksumsDir, fileName);
  if (!existsSync(filePath)) {
    throw new Error(`Checksum file does not exist: ${path.relative(workspaceRoot, filePath)}`);
  }
  return readFileSync(filePath, 'utf8');
}

function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}
