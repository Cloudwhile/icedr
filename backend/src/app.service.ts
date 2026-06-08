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

export type SystemOverviewResponse = {
  apiName: string;
  appVersion: string;
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

@Injectable()
export class AppService {
  private readonly startedAt = new Date();
  private readonly appVersion = readPackageVersion();

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
      appVersion: this.appVersion,
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
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof packageJson.version === 'string' ? packageJson.version : '';
  } catch {
    return '';
  }
}
