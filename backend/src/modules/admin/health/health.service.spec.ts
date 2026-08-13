import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { QueueService } from '../../downloads/queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  function createService() {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          'app.env': 'test',
          'identity.issuerUrl': 'https://identity.example.test',
          'storage.bucket': 'icedr',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ value: 1 }])),
      blobReconcileTask: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: 'reconcile-failed',
            status: 'failed',
            failureCode: 'ORPHAN_SCAN_FAILED',
            startedAt: new Date('2026-08-12T00:00:00.000Z'),
            finishedAt: new Date('2026-08-12T00:01:00.000Z'),
          }),
        ),
      },
    } as unknown as PrismaService;
    const storage = {
      configured: jest.fn(() => Promise.resolve(true)),
      getSettings: jest.fn(() =>
        Promise.resolve({
          storageProvider: 'local',
          physicalCapacityKnown: true,
          physicalCapacityReason: null,
          physicalCapacityCheckedAt: '2026-08-12T00:00:00.000Z',
        }),
      ),
      testSettings: jest.fn(() => Promise.resolve({ ok: true })),
    } as unknown as StorageService;
    const queue = {
      getProfile: jest.fn(() => ({
        provider: 'Redis',
        configured: false,
        connectionConfigured: false,
        queues: [],
      })),
    } as unknown as QueueService;
    const settings = {
      getMailSettings: jest.fn(() =>
        Promise.resolve({ enabled: true, verifiedAt: '2026-08-11T00:00:00Z' }),
      ),
      toMailResponse: jest.fn(() => ({
        enabled: true,
        configured: true,
        verifiedAt: '2026-08-11T00:00:00Z',
      })),
    } as unknown as SettingsService;
    const mail = {
      verifyCurrentTransport: jest.fn(() => Promise.resolve()),
    } as unknown as MailService;
    return new HealthService(config, prisma, storage, queue, settings, mail);
  }

  it('reports independent admin checks and degrades the aggregate status', async () => {
    const health = await createService().getAdminHealth();

    expect(health.status).toBe('error');
    expect(health.checkedAt).toEqual(expect.any(String));
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'application', status: 'ok' }),
        expect.objectContaining({ id: 'database', status: 'ok' }),
        expect.objectContaining({ id: 'storage', status: 'ok' }),
        expect.objectContaining({ id: 'mail', status: 'ok' }),
        expect.objectContaining({ id: 'queue', status: 'unknown' }),
        expect.objectContaining({
          id: 'reconcile',
          status: 'error',
          settingsPath: '/admin/system/lifecycle',
        }),
      ]),
    );
    for (const check of health.checks) {
      expect(check.checkedAt).toEqual(expect.any(String));
      expect(check.durationMs).toEqual(expect.any(Number));
      expect(check).toHaveProperty('reason');
      expect(check).toHaveProperty('settingsPath');
    }
  });

  it.each([
    [new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), new Date(), 'finishedAt'],
    [
      null,
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      'startedAt fallback',
    ],
  ])(
    'warns when the last completed reconciliation is stale using %s (%s)',
    async (finishedAt, startedAt) => {
      const service = createService();
      const prisma = (
        service as unknown as {
          prisma: {
            blobReconcileTask: { findFirst: jest.Mock };
          };
        }
      ).prisma;
      prisma.blobReconcileTask.findFirst.mockResolvedValue({
        id: 'reconcile-completed',
        status: 'completed',
        failureCode: null,
        startedAt,
        finishedAt,
      });

      const health = await service.getAdminHealth();
      expect(health.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'reconcile',
            status: 'warning',
            reason: 'Last reconciliation is older than seven days',
          }),
        ]),
      );
    },
  );

  it('keeps a recently completed reconciliation healthy', async () => {
    const service = createService();
    const prisma = (
      service as unknown as {
        prisma: { blobReconcileTask: { findFirst: jest.Mock } };
      }
    ).prisma;
    prisma.blobReconcileTask.findFirst.mockResolvedValue({
      id: 'reconcile-completed',
      status: 'completed',
      failureCode: null,
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
    });

    const health = await service.getAdminHealth();
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'reconcile',
          status: 'ok',
          reason: null,
        }),
      ]),
    );
  });

  it('probes the current object storage backend and exposes only a safe failure reason', async () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ value: 1 }])),
      blobReconcileTask: {
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
    } as unknown as PrismaService;
    const testSettings = jest.fn(() =>
      Promise.reject(
        new Error('connect ECONNREFUSED secret-storage.internal.example:9000'),
      ),
    );
    const storage = {
      configured: jest.fn(() => Promise.resolve(true)),
      getSettings: jest.fn(() =>
        Promise.resolve({
          storageProvider: 'object',
          physicalCapacityKnown: false,
          physicalCapacityReason: 'object-storage-capacity-unavailable',
        }),
      ),
      testSettings,
    } as unknown as StorageService;
    const queue = {
      getProfile: jest.fn(() => ({ configured: false })),
    } as unknown as QueueService;
    const settings = {
      getMailSettings: jest.fn(() => Promise.resolve({ enabled: false })),
      toMailResponse: jest.fn(() => ({
        configured: false,
        enabled: false,
        verifiedAt: null,
      })),
    } as unknown as SettingsService;
    const mail = {
      verifyCurrentTransport: jest.fn(() => Promise.resolve()),
    } as unknown as MailService;
    const service = new HealthService(
      config,
      prisma,
      storage,
      queue,
      settings,
      mail,
    );

    const health = await service.getAdminHealth();
    const storageCheck = health.checks.find((check) => check.id === 'storage');

    expect(testSettings).toHaveBeenCalledWith({});
    expect(storageCheck).toEqual(
      expect.objectContaining({
        status: 'error',
        reason: 'Storage profile check failed',
      }),
    );
    expect(JSON.stringify(storageCheck)).not.toContain('secret-storage');
  });

  it('probes a configured and verified mail transport', async () => {
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ value: 1 }])),
      blobReconcileTask: { findFirst: jest.fn(() => Promise.resolve(null)) },
    } as unknown as PrismaService;
    const storage = {
      configured: jest.fn(() => Promise.resolve(true)),
      getSettings: jest.fn(() =>
        Promise.resolve({
          storageProvider: 'local',
          physicalCapacityKnown: true,
          physicalCapacityReason: null,
        }),
      ),
    } as unknown as StorageService;
    const queue = {
      getProfile: jest.fn(() => ({ configured: false })),
    } as unknown as QueueService;
    const settings = {
      getMailSettings: jest.fn(() => Promise.resolve({ enabled: true })),
      toMailResponse: jest.fn(() => ({
        configured: true,
        enabled: true,
        verifiedAt: '2026-08-12T00:00:00.000Z',
      })),
    } as unknown as SettingsService;
    const verifyCurrentTransport = jest.fn(() =>
      Promise.reject(new Error('smtp password=secret')),
    );
    const mail = { verifyCurrentTransport } as unknown as MailService;
    const service = new HealthService(
      config,
      prisma,
      storage,
      queue,
      settings,
      mail,
    );

    const health = await service.getAdminHealth();
    const mailCheck = health.checks.find((check) => check.id === 'mail');

    expect(verifyCurrentTransport).toHaveBeenCalledTimes(1);
    expect(mailCheck).toEqual(
      expect.objectContaining({
        status: 'error',
        reason: 'Mail configuration check failed',
      }),
    );
    expect(JSON.stringify(mailCheck)).not.toContain('password=secret');
  });
});
