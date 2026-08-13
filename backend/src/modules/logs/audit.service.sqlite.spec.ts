import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma-sqlite/client';
import { AuditService } from './audit.service';

describe('AuditService SQLite overview aggregation', () => {
  let client: PrismaClient;
  let databasePath: string;
  let service: AuditService;

  beforeEach(async () => {
    databasePath = join(
      tmpdir(),
      `icedr-audit-overview-${randomUUID()}.sqlite`,
    );
    client = new PrismaClient({
      adapter: new PrismaBetterSqlite3(
        { url: databasePath },
        { timestampFormat: 'iso8601' },
      ),
    });
    await client.$connect();
    await createAuditEventSchema(client);
    service = new AuditService({
      auditEvent: client.auditEvent,
      isSqlite: () => true,
      $queryRaw: client.$queryRaw.bind(client),
    } as unknown as PrismaService);
  });

  afterEach(async () => {
    await client.$disconnect();
    for (const suffix of ['', '-shm', '-wal']) {
      const path = `${databasePath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  });

  it('executes date/result/resource aggregation and returns only ten newest risks', async () => {
    const riskRows = Array.from({ length: 11 }, (_, index) => ({
      id: `risk-${index.toString().padStart(2, '0')}`,
      action: 'transfer.failed',
      actor: 'system',
      target: `transfer-${index}`,
      workspaceId: 'workspace-a',
      shareToken: index === 10 ? 'share-risk-10' : null,
      nodeId: index === 10 ? 'node-risk-10' : null,
      metadata: index === 10 ? { actorDisplayName: 'Latest operator' } : {},
      createdAt: new Date(
        `2026-08-13T00:${index.toString().padStart(2, '0')}:00.000Z`,
      ),
    }));
    await client.auditEvent.createMany({
      data: [
        {
          id: 'similar-result',
          action: 'auth.login',
          actor: 'account',
          target: 'result-user',
          workspaceId: 'workspace-a',
          metadata: { result: 'not_failed' },
          createdAt: new Date('2026-08-11T01:00:00.000Z'),
        },
        {
          id: 'similar-status',
          action: 'auth.login',
          actor: 'account',
          target: 'status-user',
          workspaceId: 'workspace-a',
          metadata: { status: 'error_recovered' },
          createdAt: new Date('2026-08-11T02:00:00.000Z'),
        },
        {
          id: 'result-precedence',
          action: 'auth.login',
          actor: 'account',
          target: 'precedence-user',
          workspaceId: 'workspace-a',
          metadata: { result: 'success', status: 'failed' },
          createdAt: new Date('2026-08-11T03:00:00.000Z'),
        },
        {
          id: 'boolean-failure',
          action: 'file.download_started',
          actor: 'account',
          target: 'file-a',
          workspaceId: 'workspace-a',
          metadata: { success: false },
          createdAt: new Date('2026-08-12T01:00:00.000Z'),
        },
        {
          id: 'normalized-failure',
          action: 'share.viewed',
          actor: 'visitor',
          target: 'share-a',
          workspaceId: 'workspace-a',
          metadata: { result: ' FAILED ' },
          createdAt: new Date('2026-08-12T02:00:00.000Z'),
        },
        {
          id: 'tab-newline-failure',
          action: 'auth.login',
          actor: 'account',
          target: 'tab-newline-user',
          workspaceId: 'workspace-a',
          metadata: { result: '\tFAILED\n' },
          createdAt: new Date('2026-08-12T02:10:00.000Z'),
        },
        {
          id: 'nbsp-failure',
          action: 'auth.login',
          actor: 'account',
          target: 'nbsp-user',
          workspaceId: 'workspace-a',
          metadata: { status: '\u00a0denied\u00a0' },
          createdAt: new Date('2026-08-12T02:20:00.000Z'),
        },
        {
          id: 'nested-share-revocation',
          action: 'admin.share.revoked',
          actor: 'system',
          target: 'share-nested',
          workspaceId: 'workspace-a',
          metadata: {},
          createdAt: new Date('2026-08-12T03:00:00.000Z'),
        },
        ...riskRows,
        {
          id: 'other-workspace',
          action: 'auth.login_failed',
          actor: 'account',
          target: 'other-user',
          workspaceId: 'workspace-b',
          metadata: {},
          createdAt: new Date('2026-08-13T23:00:00.000Z'),
        },
        {
          id: 'outside-window',
          action: 'auth.login_failed',
          actor: 'account',
          target: 'old-user',
          workspaceId: 'workspace-a',
          metadata: {},
          createdAt: new Date('2026-08-10T23:59:59.999Z'),
        },
        {
          id: 'system-risk',
          action: 'system.auth_policy_updated',
          actor: 'system',
          target: 'auth-policy',
          workspaceId: null,
          metadata: {},
          createdAt: new Date('2026-08-12T12:00:00.000Z'),
        },
      ],
    });

    const metrics = await service.getOverviewMetrics({
      scope: 'workspace',
      workspaceId: 'workspace-a',
      createdFrom: '2026-08-11T00:00:00.000Z',
      createdTo: '2026-08-13T23:59:59.999Z',
    });

    expect(metrics.total).toBe(19);
    expect(metrics.failed).toBe(15);
    expect(metrics.dailyTrend).toEqual([
      { date: '2026-08-11', total: 3, failed: 0 },
      { date: '2026-08-12', total: 5, failed: 4 },
      { date: '2026-08-13', total: 11, failed: 11 },
    ]);
    expect(metrics.resourceDistribution).toEqual([
      { resourceType: 'file', total: 1 },
      { resourceType: 'share', total: 1 },
      { resourceType: 'system', total: 6 },
      { resourceType: 'transfer', total: 11 },
    ]);
    expect(metrics.recentRiskEvents).toHaveLength(10);
    expect(metrics.recentRiskEvents.map((event) => event.id)).toEqual(
      Array.from(
        { length: 10 },
        (_, index) => `risk-${(10 - index).toString().padStart(2, '0')}`,
      ),
    );
    expect(metrics.recentRiskEvents[0]).toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-a',
        shareToken: 'share-risk-10',
        nodeId: 'node-risk-10',
        actorDisplayName: 'Latest operator',
        createdAt: '2026-08-13T00:10:00.000Z',
      }),
    );
  });

  it('keeps the strict system scope in the executable SQLite query', async () => {
    await client.auditEvent.createMany({
      data: [
        {
          id: 'system-event',
          action: 'system.auth_policy_updated',
          actor: 'system',
          target: 'auth-policy',
          workspaceId: null,
          metadata: {},
          createdAt: new Date('2026-08-12T12:00:00.000Z'),
        },
        {
          id: 'workspace-event',
          action: 'auth.login_failed',
          actor: 'account',
          target: 'workspace-user',
          workspaceId: 'workspace-a',
          metadata: {},
          createdAt: new Date('2026-08-12T13:00:00.000Z'),
        },
      ],
    });

    const metrics = await service.getOverviewMetrics({
      scope: 'system',
      createdFrom: '2026-08-12T00:00:00.000Z',
      createdTo: '2026-08-12T23:59:59.999Z',
    });

    expect(metrics.total).toBe(1);
    expect(metrics.failed).toBe(0);
    expect(metrics.recentRiskEvents.map((event) => event.id)).toEqual([
      'system-event',
    ]);
  });

  it('executes compound createdAt/id keyset pagination against SQLite', async () => {
    const createdAt = new Date('2026-08-12T12:00:00.000Z');
    await client.auditEvent.createMany({
      data: Array.from({ length: 502 }, (_, index) => ({
        id: `keyset-${index.toString().padStart(3, '0')}`,
        action: 'auth.login',
        actor: 'account',
        target: `user-${index}`,
        metadata: {},
        createdAt,
      })),
    });

    const page = await service.listEvents({ offset: 499, limit: 3 });

    expect(page.total).toBe(502);
    expect(page.items.map((event) => event.id)).toEqual([
      'keyset-002',
      'keyset-001',
      'keyset-000',
    ]);
  });
});

async function createAuditEventSchema(client: PrismaClient) {
  await client.$executeRawUnsafe(
    'CREATE TABLE "audit_events" ("id" TEXT NOT NULL PRIMARY KEY, "action" TEXT NOT NULL, "actor" TEXT NOT NULL, "target" TEXT NOT NULL, "workspace_id" TEXT, "share_token" TEXT, "node_id" TEXT, "metadata" JSONB NOT NULL DEFAULT \'{}\', "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
}
