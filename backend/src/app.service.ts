import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import {
  arch,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
  type,
  uptime as osUptime,
} from 'os';
import { join } from 'path';

type AppReleaseChannel = 'stable' | 'prerelease';

export type SystemOverviewResponse = {
  apiName: string;
  appPrereleaseLabel: string | null;
  appReleaseChannel: AppReleaseChannel;
  appVersion: string;
  appVersionTag: string;
  architecture: string;
  loadAverage: number[];
  memoryFreeBytes: number;
  memoryTotalBytes: number;
  memoryUsagePercent: number;
  nodeVersion: string;
  operatingSystem: string;
  osPlatform: string;
  osRelease: string;
  osUptimeSeconds: number;
  processUptimeSeconds: number;
  runtime: string;
  serviceStartedAt: string;
  updatedAt: string;
};

export type SystemUpdateStatusResponse = {
  checkedAt: string;
  currentReleaseChannel: AppReleaseChannel;
  currentTag: string;
  currentVersion: string;
  error: string | null;
  latestReleaseChannel: AppReleaseChannel | null;
  latestTag: string | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  source: string | null;
  updateAvailable: boolean;
};

type ParsedAppVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  prereleaseLabel: string | null;
  releaseChannel: AppReleaseChannel;
  tag: string;
  version: string;
};

type ReleaseCandidate = {
  releaseChannel: AppReleaseChannel;
  releaseUrl: string | null;
  tag: string;
  version: string;
};

const officialReleasesUrl =
  'https://api.github.com/repos/Cloudwhile/icedr/releases';
const updateCheckTimeoutMs = 5000;
const semverPattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

@Injectable()
export class AppService {
  private readonly startedAt = new Date();
  private readonly versionInfo = createAppVersionInfo(readPackageVersion());

  getServiceIndex() {
    return {
      name: 'ICEDR API',
      architecture: 'NestJS Monolith',
      phase: 'Phase 1',
      modules: [
        'auth',
        'identity',
        'workspaces',
        'file-nodes',
        'shares',
        'audit',
        'storage',
        'queue',
        'worker',
      ],
      docs: '/api/docs',
      health: '/api/health',
    };
  }

  getSystemOverview(): SystemOverviewResponse {
    const memoryTotalBytes = totalmem();
    const memoryFreeBytes = freemem();
    const memoryUsagePercent =
      memoryTotalBytes > 0
        ? Math.round(
            ((memoryTotalBytes - memoryFreeBytes) / memoryTotalBytes) * 1000,
          ) / 10
        : 0;

    return {
      apiName: 'ICEDR API',
      appPrereleaseLabel: this.versionInfo.prereleaseLabel,
      appReleaseChannel: this.versionInfo.releaseChannel,
      appVersion: this.versionInfo.version,
      appVersionTag: this.versionInfo.tag,
      architecture: arch(),
      loadAverage: loadavg(),
      memoryFreeBytes,
      memoryTotalBytes,
      memoryUsagePercent,
      nodeVersion: process.version,
      operatingSystem: type(),
      osPlatform: platform(),
      osRelease: release(),
      osUptimeSeconds: Math.floor(osUptime()),
      processUptimeSeconds: Math.floor(process.uptime()),
      runtime: 'NestJS',
      serviceStartedAt: this.startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getSystemUpdateStatus(): Promise<SystemUpdateStatusResponse> {
    const checkedAt = new Date().toISOString();
    const source =
      readString(process.env.ICEDR_UPDATE_CHECK_URL) || officialReleasesUrl;

    try {
      const releases = await fetchReleaseCandidates(source);
      const includePrereleases =
        readBoolean(process.env.ICEDR_UPDATE_INCLUDE_PRERELEASES) ??
        this.versionInfo.releaseChannel === 'prerelease';
      const latest =
        releases
          .filter(
            (release) =>
              includePrereleases || release.releaseChannel !== 'prerelease',
          )
          .sort((left, right) =>
            compareAppVersions(right.version, left.version),
          )[0] ?? null;

      return {
        checkedAt,
        currentReleaseChannel: this.versionInfo.releaseChannel,
        currentTag: this.versionInfo.tag,
        currentVersion: this.versionInfo.version,
        error: null,
        latestReleaseChannel: latest?.releaseChannel ?? null,
        latestTag: latest?.tag ?? null,
        latestVersion: latest?.version ?? null,
        releaseUrl: latest?.releaseUrl ?? null,
        source,
        updateAvailable: latest
          ? compareAppVersions(latest.version, this.versionInfo.version) > 0
          : false,
      };
    } catch (error) {
      return {
        checkedAt,
        currentReleaseChannel: this.versionInfo.releaseChannel,
        currentTag: this.versionInfo.tag,
        currentVersion: this.versionInfo.version,
        error: error instanceof Error ? error.message : 'Update check failed',
        latestReleaseChannel: null,
        latestTag: null,
        latestVersion: null,
        releaseUrl: null,
        source,
        updateAvailable: false,
      };
    }
  }
}

export function normalizeAppVersion(value: string) {
  const parsed = parseAppVersion(value);
  return parsed?.version ?? value.trim();
}

export function isAppVersionPrerelease(value: string) {
  return parseAppVersion(value)?.releaseChannel === 'prerelease';
}

export function compareAppVersions(left: string, right: string) {
  const leftVersion = parseAppVersion(left);
  const rightVersion = parseAppVersion(right);
  if (!leftVersion || !rightVersion) {
    return left.trim().localeCompare(right.trim(), 'en');
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }

  const leftPrerelease = leftVersion.prerelease;
  const rightPrerelease = rightVersion.prerelease;
  if (leftPrerelease.length === 0 && rightPrerelease.length === 0) return 0;
  if (leftPrerelease.length === 0) return 1;
  if (rightPrerelease.length === 0) return -1;

  const maxLength = Math.max(leftPrerelease.length, rightPrerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftPrerelease[index];
    const rightPart = rightPrerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = parseNumericIdentifier(leftPart);
    const rightNumber = parseNumericIdentifier(rightPart);
    if (leftNumber !== null && rightNumber !== null) {
      return leftNumber > rightNumber ? 1 : -1;
    }
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

function readPackageVersion() {
  const explicitVersion = readString(process.env.APP_VERSION);
  if (explicitVersion) return normalizeAppVersion(explicitVersion);

  const candidates = [
    join(process.cwd(), 'package.json'),
    join(process.cwd(), '..', 'package.json'),
    join(__dirname, '..', 'package.json'),
    join(__dirname, '..', '..', 'package.json'),
    join(__dirname, '..', '..', '..', 'package.json'),
  ];
  let fallbackVersion = normalizeAppVersion(
    readString(process.env.npm_package_version),
  );

  for (const candidate of candidates) {
    const packageVersion = readPackageVersionFile(candidate);
    if (!packageVersion.version) continue;
    if (packageVersion.name === 'icedr') {
      return normalizeAppVersion(packageVersion.version);
    }
    fallbackVersion ||= normalizeAppVersion(packageVersion.version);
  }

  return fallbackVersion;
}

function readPackageVersionFile(path: string) {
  try {
    const packageJson = JSON.parse(readFileSync(path, 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    return {
      name: readString(packageJson.name),
      version: readString(packageJson.version),
    };
  } catch {
    return { name: '', version: '' };
  }
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function createAppVersionInfo(value: string): ParsedAppVersion {
  const parsed = parseAppVersion(value);
  if (parsed) return parsed;

  const version = value.trim() || '0.0.0';
  return {
    major: 0,
    minor: 0,
    patch: 0,
    prerelease: [],
    prereleaseLabel: null,
    releaseChannel: 'stable',
    tag: version.startsWith('v') ? version : `v${version}`,
    version,
  };
}

function parseAppVersion(value: string): ParsedAppVersion | null {
  const match = semverPattern.exec(value.trim());
  if (!match) return null;

  const [, major, minor, patch, prerelease, build] = match;
  const coreVersion = `${major}.${minor}.${patch}`;
  const prereleaseSuffix = prerelease ? `-${prerelease}` : '';
  const buildSuffix = build ? `+${build}` : '';
  const version = `${coreVersion}${prereleaseSuffix}${buildSuffix}`;
  const prereleaseParts = prerelease ? prerelease.split('.') : [];

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseParts,
    prereleaseLabel: prereleaseParts[0] ?? null,
    releaseChannel: prereleaseParts.length > 0 ? 'prerelease' : 'stable',
    tag: `v${version}`,
    version,
  };
}

function parseNumericIdentifier(value: string) {
  return /^(0|[1-9]\d*)$/.test(value) ? Number(value) : null;
}

function readBoolean(value: unknown) {
  const text = readString(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return null;
}

async function fetchReleaseCandidates(source: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), updateCheckTimeoutMs);
  try {
    const response = await fetch(source, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Update source returned HTTP ${response.status}`);
    }
    return parseReleaseCandidates((await response.json()) as unknown);
  } finally {
    clearTimeout(timeout);
  }
}

function parseReleaseCandidates(value: unknown): ReleaseCandidate[] {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.releases)
      ? value.releases
      : [value];

  return items.flatMap((item) => {
    const release = parseReleaseCandidate(item);
    return release ? [release] : [];
  });
}

function parseReleaseCandidate(value: unknown): ReleaseCandidate | null {
  if (!isRecord(value)) return null;
  if (value.draft === true) return null;

  const versionSource =
    readString(value.version) ||
    readString(value.tag_name) ||
    readString(value.tagName) ||
    readString(value.tag);
  const parsed = parseAppVersion(versionSource);
  if (!parsed) return null;

  return {
    releaseChannel: parsed.releaseChannel,
    releaseUrl:
      readString(value.html_url) ||
      readString(value.htmlUrl) ||
      readString(value.url) ||
      null,
    tag: parsed.tag,
    version: parsed.version,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
