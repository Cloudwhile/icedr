const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { chmod, copyFile } = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const backendEntry = path.join(workspaceRoot, 'backend', 'dist', 'main.js');
const workDir = path.join(workspaceRoot, 'build', 'binary');
const outputDir = path.join(workspaceRoot, 'dist', 'binaries');
const rootPackage = require(path.join(workspaceRoot, 'package.json'));
const { resolveBinaryMetadata } = require('./binary-metadata.cjs');
const displayVersion = resolveBinaryVersion();
const version = normalizeNamePart(displayVersion);
const targetPlatform = normalizeTargetPlatform(
  readOption('platform') || process.env.ICEDR_BINARY_PLATFORM || detectNativePlatform(),
);
const binaryMetadata = resolveBinaryMetadata();
const seaFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  validateBinaryVersion(displayVersion);
  assertSupportedTargetPlatform(targetPlatform);
  assertNativeBuildPlatform(targetPlatform);
  if (process.argv.includes('--print-name')) {
    console.log(createBinaryName());
    return;
  }

  const skipBuild = process.argv.includes('--skip-build') || process.env.ICEDR_BINARY_SKIP_BUILD === '1';
  if (!skipBuild) {
    run(resolvePackageRunner('pnpm'), ['--filter', 'backend', 'build'], {
      cwd: workspaceRoot,
    });
  }

  ensureBuildArtifacts();
  recreateDir(workDir);
  mkdirSync(outputDir, { recursive: true });

  const entrySource = path.join(workDir, 'sea-entry-source.cjs');
  const bundleFile = path.join(workDir, 'sea-entry.cjs');
  const seaConfigFile = path.join(workDir, 'sea-config.json');
  const seaBlobFile = path.join(workDir, 'sea-prep.blob');
  const binaryName = createBinaryName();
  const binaryPath = path.join(outputDir, binaryName);

  writeFileSync(entrySource, createEntrySource(), 'utf8');
  bundleBackend(entrySource, bundleFile);

  writeFileSync(
    seaConfigFile,
    `${JSON.stringify(
      {
        main: bundleFile,
        output: seaBlobFile,
        disableExperimentalSEAWarning: true,
        useCodeCache: true,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  run(process.execPath, ['--experimental-sea-config', seaConfigFile], {
    cwd: workspaceRoot,
  });

  if (existsSync(binaryPath)) {
    rmSync(binaryPath, { force: true });
  }
  await copyFile(process.execPath, binaryPath);
  await makeExecutable(binaryPath);
  await applyBinaryMetadata(binaryPath, binaryName);

  if (process.platform === 'darwin') {
    runOptional('codesign', ['--remove-signature', binaryPath]);
  }

  const postjectArgs = [
    binaryPath,
    'NODE_SEA_BLOB',
    seaBlobFile,
    '--sentinel-fuse',
    seaFuse,
  ];
  if (process.platform === 'darwin') {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  runTool('postject', 'postject@1.0.0-alpha.6', postjectArgs, {
    cwd: workspaceRoot,
  });

  if (process.platform === 'darwin') {
    run('codesign', ['--sign', '-', binaryPath], { cwd: workspaceRoot });
  }
  await makeExecutable(binaryPath);

  const content = readFileSync(binaryPath);
  const md5 = createHash('md5').update(content).digest('hex');
  const sha256 = createHash('sha256').update(content).digest('hex');
  writeFileSync(`${binaryPath}.md5`, `${md5}  ${path.basename(binaryPath)}\n`, 'utf8');
  writeFileSync(`${binaryPath}.sha256`, `${sha256}  ${path.basename(binaryPath)}\n`, 'utf8');
  console.log(`Created ${path.relative(workspaceRoot, binaryPath)}`);
  console.log(`MD5 ${md5}`);
  console.log(`SHA256 ${sha256}`);
}

function ensureBuildArtifacts() {
  const missing = [];
  if (!existsSync(backendEntry)) missing.push(path.relative(workspaceRoot, backendEntry));
  if (missing.length > 0) {
    throw new Error(`Missing build artifacts: ${missing.join(', ')}. Run pnpm --filter backend build first.`);
  }
}

function createEntrySource() {
  const relativeEntry = toRequirePath(path.relative(workDir, backendEntry));
  return [
    `'use strict';`,
    `process.env.APP_VERSION = process.env.APP_VERSION || ${JSON.stringify(displayVersion)};`,
    `process.env.ICEDR_BINARY = process.env.ICEDR_BINARY || '1';`,
    `require(${JSON.stringify(relativeEntry)});`,
    '',
  ].join('\n');
}

function bundleBackend(entrySource, bundleFile) {
  runTool(
    'esbuild',
    'esbuild@0.27.7',
    [
      entrySource,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node24',
      '--main-fields=main,module',
      '--log-level=warning',
      '--external:@nestjs/microservices',
      '--external:@nestjs/microservices/*',
      '--external:@nestjs/websockets',
      '--external:@nestjs/websockets/*',
      '--external:class-transformer/storage',
      `--outfile=${bundleFile}`,
    ],
    { cwd: workspaceRoot },
  );
}

function createBinaryName() {
  const extension = targetPlatform.startsWith('windows-') ? '.exe' : '';
  return `icedr_${version}_${targetPlatform}${extension}`;
}

async function applyBinaryMetadata(binaryPath, binaryName) {
  if (!targetPlatform.startsWith('windows-')) return;

  const { rcedit } = await import('rcedit');
  const icon = await resolveWindowsIcon();
  const versionStrings = {
    Comments: binaryMetadata.comments,
    CompanyName: binaryMetadata.companyName,
    FileDescription: binaryMetadata.fileDescription,
    FileVersion: displayVersion,
    InternalName: binaryMetadata.internalName,
    LegalCopyright: binaryMetadata.copyright,
    OriginalFilename: binaryName,
    ProductName: binaryMetadata.productName,
    ProductVersion: displayVersion,
  };

  await rcedit(binaryPath, {
    ...(icon ? { icon } : {}),
    'file-version': toWindowsVersion(displayVersion),
    'product-version': toWindowsVersion(displayVersion),
    'version-string': Object.fromEntries(
      Object.entries(versionStrings).filter(([, value]) => Boolean(value)),
    ),
  });
}

async function resolveWindowsIcon() {
  if (!binaryMetadata.icon) return null;

  const iconSource = path.resolve(workspaceRoot, binaryMetadata.icon);
  if (!existsSync(iconSource)) {
    throw new Error(`Binary icon does not exist: ${binaryMetadata.icon}`);
  }

  const extension = path.extname(iconSource).toLowerCase();
  if (extension === '.ico') return iconSource;
  if (extension !== '.png') {
    throw new Error(`Binary icon must be a .ico or .png file: ${binaryMetadata.icon}`);
  }

  const { default: pngToIco } = await import('png-to-ico');
  const iconBuffer = await pngToIco(iconSource);
  const iconPath = path.join(workDir, 'icedr-binary.ico');
  writeFileSync(iconPath, iconBuffer);
  return iconPath;
}

function toWindowsVersion(value) {
  const [core] = value.split(/[+-]/);
  const parts = core.split('.').map((part) => Number(part));
  while (parts.length < 4) parts.push(0);
  return parts
    .slice(0, 4)
    .map((part) =>
      Number.isInteger(part) && part >= 0 && part <= 65535 ? part : 0,
    )
    .join('.');
}

function normalizeNamePart(value) {
  return String(value).trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}

function resolveBinaryVersion() {
  const explicitVersion = process.env.ICEDR_BINARY_VERSION?.trim();
  if (explicitVersion) return explicitVersion.replace(/^v(?=\d)/i, '');

  const githubRefName = process.env.GITHUB_REF_NAME?.trim();
  if (/^v\d/i.test(githubRefName || '')) {
    return githubRefName.replace(/^v/i, '');
  }

  return rootPackage.version || '0.0.0';
}

function validateBinaryVersion(value) {
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    return;
  }
  throw new Error(
    `Invalid ICEDR version "${value}". Use semver, for example 1.2.3, 1.2.3-alpha.1, or 1.2.3-beta.1.`,
  );
}

function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function detectNativePlatform() {
  const platformNames = {
    win32: 'windows',
    linux: 'linux',
    darwin: 'macos',
  };
  const archNames = {
    arm: 'armv7',
    arm64: 'arm64',
    ia32: 'x86',
    x64: 'x86_64',
  };
  return `${platformNames[process.platform] || process.platform}-${archNames[process.arch] || process.arch}`;
}

function normalizeTargetPlatform(value) {
  const normalized = String(value).trim().toLowerCase().replace(/_/g, '-');
  const aliases = new Map([
    ['darwin-arm64', 'macos-arm64'],
    ['darwin-x64', 'macos-x86_64'],
    ['linux-aarch64', 'linux-arm64'],
    ['linux-arm64', 'linux-arm64'],
    ['linux-x64', 'linux-x86_64'],
    ['linux-x86-64', 'linux-x86_64'],
    ['linux-x86_64', 'linux-x86_64'],
    ['macos-arm64', 'macos-arm64'],
    ['macos-x64', 'macos-x86_64'],
    ['macos-x86-64', 'macos-x86_64'],
    ['macos-x86_64', 'macos-x86_64'],
    ['windows-arm64', 'windows-arm64'],
    ['windows-x64', 'windows-x86_64'],
    ['windows-x86-64', 'windows-x86_64'],
    ['windows-x86_64', 'windows-x86_64'],
    ['win32-arm64', 'windows-arm64'],
    ['win32-x64', 'windows-x86_64'],
  ]);
  return aliases.get(normalized) || normalized;
}

function assertSupportedTargetPlatform(platform) {
  const supportedPlatforms = new Set([
    'linux-arm64',
    'linux-x86_64',
    'macos-arm64',
    'macos-x86_64',
    'windows-arm64',
    'windows-x86_64',
  ]);
  if (supportedPlatforms.has(platform)) return;
  throw new Error(`Target platform is not available: ${platform}.`);
}

function assertNativeBuildPlatform(platform) {
  const nativePlatform = detectNativePlatform();
  if (platform === nativePlatform) return;
  throw new Error(
    `Target platform ${platform} does not match this Node runtime (${nativePlatform}). Use a matching runner.`,
  );
}

function runTool(toolName, packageName, args, options) {
  const localTool = resolveLocalTool(toolName);
  if (localTool) {
    run(localTool.command, [...localTool.args, ...args], options);
    return;
  }

  run(resolvePackageRunner('npx'), ['-y', packageName, ...args], options);
}

function resolveLocalTool(name) {
  const localBin = findLocalBin(name);
  if (localBin) return { command: localBin, args: [] };

  const packageBin = findPackageBin(name);
  if (!packageBin) return undefined;

  if (process.platform === 'win32' && /\.(?:cjs|mjs|js)$/i.test(packageBin)) {
    return { command: process.execPath, args: [packageBin] };
  }
  return { command: packageBin, args: [] };
}

function findPackageBin(name) {
  try {
    const packageJsonPath = require.resolve(`${name}/package.json`, {
      paths: [workspaceRoot],
    });
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const bin =
      typeof packageJson.bin === 'string'
        ? packageJson.bin
        : packageJson.bin?.[name] || Object.values(packageJson.bin || {})[0];

    return typeof bin === 'string'
      ? path.join(path.dirname(packageJsonPath), bin)
      : undefined;
  } catch {
    return undefined;
  }
}

function findLocalBin(name) {
  const executable = process.platform === 'win32' ? `${name}.cmd` : name;
  const candidates = [
    path.join(workspaceRoot, 'node_modules', '.bin', executable),
    path.join(workspaceRoot, 'frontend', 'node_modules', '.bin', executable),
    path.join(workspaceRoot, 'backend', 'node_modules', '.bin', executable),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolvePackageRunner(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || workspaceRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function runOptional(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.warn(`${command} ${args.join(' ')} failed; continuing.`);
  }
}

async function makeExecutable(filePath) {
  if (process.platform !== 'win32') {
    await chmod(filePath, 0o755);
  }
}

function recreateDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

function toRequirePath(value) {
  const normalized = value.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}
