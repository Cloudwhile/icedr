import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection } from 'net';
import { PrismaService } from '../../../database/prisma.service';
import { QueueService } from '../../downloads/queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import type {
  AdminHealthCheck,
  AdminHealthCheckId,
  AdminHealthResponse,
  AdminHealthStatus,
} from './health.dto';

const maximumCompletedReconcileAgeMs = 7 * 24 * 60 * 60 * 1000;

type CheckOutcome = {
  status: AdminHealthStatus;
  reason: string | null;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  async getHealth() {
    const databaseReachable = await this.checkDatabaseReachable();
    const storageConfigured = await this.storage.configured();
    const queueProfile = this.queue.getProfile();
    const ok = databaseReachable && storageConfigured;

    return {
      status: ok ? 'ok' : 'degraded',
      service: 'icedr-api',
      env: this.config.get<string>('app.env'),
      dependencies: {
        identity: Boolean(this.config.get<string>('identity.issuerUrl')),
        database: {
          configured: true,
          reachable: databaseReachable,
        },
        redis: {
          configured: queueProfile.configured,
        },
        storage: {
          configured: storageConfigured,
          endpoint: Boolean(this.config.get<string>('storage.endpoint')),
          bucket: Boolean(this.config.get<string>('storage.bucket')),
        },
      },
    };
  }

  async getAdminHealth(): Promise<AdminHealthResponse> {
    const checks = await Promise.all([
      this.runCheck('application', '/admin/status', () =>
        Promise.resolve({ status: 'ok', reason: null }),
      ),
      this.runCheck(
        'database',
        '/admin/system/platform',
        async () => {
          await this.prisma.$queryRaw`select 1`;
          return { status: 'ok', reason: null };
        },
        'Database connection failed',
      ),
      this.runCheck(
        'storage',
        '/admin/system/storage',
        () => this.checkStorage(),
        'Storage profile check failed',
      ),
      this.runCheck(
        'mail',
        '/admin/system/platform',
        () => this.checkMail(),
        'Mail configuration check failed',
      ),
      this.runCheck(
        'queue',
        '/admin/system/platform',
        () => this.checkQueue(),
        'Queue connection failed',
      ),
      this.runCheck(
        'reconcile',
        '/admin/system/lifecycle',
        () => this.checkReconcile(),
        'Reconciliation status check failed',
      ),
    ]);
    return {
      status: this.aggregateStatus(checks),
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabaseReachable() {
    try {
      await this.prisma.$queryRaw`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkStorage(): Promise<CheckOutcome> {
    const [configured, settings] = await Promise.all([
      this.storage.configured(),
      this.storage.getSettings(),
    ]);
    if (!configured) {
      return { status: 'error', reason: 'Storage is not configured' };
    }
    if (settings.storageProvider === 'object') {
      await this.storage.testSettings({});
      return { status: 'ok', reason: null };
    }
    if (
      settings.storageProvider === 'local' &&
      !settings.physicalCapacityKnown
    ) {
      return {
        status: 'warning',
        reason:
          settings.physicalCapacityReason ??
          'Local storage capacity could not be determined',
      };
    }
    return { status: 'ok', reason: null };
  }

  private async checkMail(): Promise<CheckOutcome> {
    const mail = this.settings.toMailResponse(
      await this.settings.getMailSettings(),
    );
    if (!mail.enabled) {
      return { status: 'unknown', reason: 'Mail delivery is disabled' };
    }
    if (!mail.configured) {
      return { status: 'warning', reason: 'Mail settings are incomplete' };
    }
    if (!mail.verifiedAt) {
      return {
        status: 'warning',
        reason: 'Mail settings have not been verified',
      };
    }
    await this.mail.verifyCurrentTransport();
    return { status: 'ok', reason: null };
  }

  private async checkQueue(): Promise<CheckOutcome> {
    const profile = this.queue.getProfile();
    if (!profile.configured) {
      return { status: 'unknown', reason: 'Queue is not configured' };
    }
    const host = this.config.get<string>('redis.host')?.trim();
    const port = Number(this.config.get<number>('redis.port'));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
      return { status: 'warning', reason: 'Queue endpoint is incomplete' };
    }
    await this.connectTcp(host, port);
    return { status: 'ok', reason: null };
  }

  private async checkReconcile(): Promise<CheckOutcome> {
    const task = await this.prisma.blobReconcileTask.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        status: true,
        failureCode: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    if (!task) {
      return {
        status: 'unknown',
        reason: 'No reconciliation task has been run',
      };
    }
    if (task.status === 'failed') {
      return {
        status: 'error',
        reason: task.failureCode
          ? `Last reconciliation failed (${task.failureCode})`
          : 'Last reconciliation failed',
      };
    }
    if (task.status === 'running') {
      return { status: 'warning', reason: 'Reconciliation is running' };
    }
    if (task.status === 'completed') {
      const completedAt = task.finishedAt ?? task.startedAt;
      if (
        !Number.isFinite(completedAt.getTime()) ||
        Date.now() - completedAt.getTime() > maximumCompletedReconcileAgeMs
      ) {
        return {
          status: 'warning',
          reason: 'Last reconciliation is older than seven days',
        };
      }
      return { status: 'ok', reason: null };
    }
    return {
      status: 'unknown',
      reason: 'Reconciliation returned an unknown status',
    };
  }

  private connectTcp(host: string, port: number) {
    return new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Queue connection timed out'));
      }, 1_500);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      });
    });
  }

  private async runCheck(
    id: AdminHealthCheckId,
    settingsPath: string | null,
    check: () => Promise<CheckOutcome>,
    failureReason = 'Health check failed',
  ): Promise<AdminHealthCheck> {
    const startedAt = Date.now();
    try {
      const outcome = await check();
      return {
        id,
        ...outcome,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        settingsPath,
      };
    } catch {
      return {
        id,
        status: 'error',
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        reason: failureReason,
        settingsPath,
      };
    }
  }

  private aggregateStatus(checks: AdminHealthCheck[]): AdminHealthStatus {
    if (checks.some((check) => check.status === 'error')) return 'error';
    if (checks.some((check) => check.status === 'warning')) return 'warning';
    if (checks.every((check) => check.status === 'unknown')) return 'unknown';
    if (checks.some((check) => check.status === 'unknown')) return 'warning';
    return 'ok';
  }
}
