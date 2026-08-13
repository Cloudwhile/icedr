import { BadRequestException } from '@nestjs/common';
import type { AuditEvent } from '../../generated/prisma/client';
import { resolveAuditResult } from './audit-events';
import { AuditService } from './audit.service';
import { PrismaService } from '../../database/prisma.service';

type AuditFindManyInput = {
  where?: AuditWhere;
  orderBy?: unknown[];
  take?: number;
};

type AuditWhere = {
  AND?: AuditWhere[];
  OR?: AuditWhere[];
  action?: string | { in?: string[]; startsWith?: string };
  actor?: string;
  createdAt?: Date | { gte?: Date; gt?: Date; lte?: Date; lt?: Date };
  id?: { gt?: string; lt?: string };
  nodeId?: string;
  workspaceId?: string | null;
};

function getAuditWhere(input: AuditFindManyInput | undefined) {
  if (!input?.where) throw new Error('Audit query was not captured');
  return input.where;
}

describe('AuditService', () => {
  it('classifies authentication policy blocks as failed outcomes', () => {
    expect(resolveAuditResult('auth.method_policy_blocked', {})).toBe('failed');
  });

  it('matches only complete normalized failure result and status values', () => {
    expect(resolveAuditResult('auth.login', { result: ' FAILED ' })).toBe(
      'failed',
    );
    expect(resolveAuditResult('auth.login', { status: 'denied' })).toBe(
      'failed',
    );
    expect(resolveAuditResult('auth.login', { result: 'not_failed' })).toBe(
      'success',
    );
    expect(
      resolveAuditResult('auth.login', { status: 'error_recovered' }),
    ).toBe('success');
    for (const whitespace of ['\t', '\n', '\u00a0', '\ufeff']) {
      expect(
        resolveAuditResult('auth.login', {
          result: `${whitespace}FAILED${whitespace}`,
        }),
      ).toBe('failed');
    }
  });

  it('filters normalized fields before pagination and returns filtered totals', async () => {
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 'audit_failed',
          action: 'auth.login_failed',
          actor: 'account',
          target: 'alice@example.com',
          workspaceId: null,
          shareToken: null,
          nodeId: null,
          metadata: {
            actorDisplayName: 'Alice',
            actorEmail: 'alice@example.com',
            actorUserId: 'user-alice',
            ip: '203.0.113.9',
            result: 'failed',
          },
          createdAt: new Date('2026-08-12T01:00:00.000Z'),
        },
        {
          id: 'audit_success',
          action: 'auth.login',
          actor: 'account',
          target: 'bob@example.com',
          workspaceId: null,
          shareToken: null,
          nodeId: null,
          metadata: {
            actorDisplayName: 'Bob',
            ip: '198.51.100.4',
            result: 'success',
          },
          createdAt: new Date('2026-08-12T00:00:00.000Z'),
        },
      ]),
    );
    const service = new AuditService({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    const events = await service.listEvents({
      query: 'alice',
      result: 'failed',
      limit: 1,
      offset: 0,
    });

    expect(events).toEqual(
      expect.objectContaining({
        facets: { actions: ['auth.login_failed'], actors: ['account'] },
        items: [
          expect.objectContaining({
            actorDisplayName: 'Alice',
            actorEmail: 'alice@example.com',
            actorUserId: 'user-alice',
            ipAddress: '203.0.113.9',
            resourceType: 'system',
            result: 'failed',
          }),
        ],
        limit: 1,
        offset: 0,
        scope: { kind: 'all' },
        summary: { failed: 1, success: 0 },
        total: 1,
      }),
    );
    expect(events.generatedAt).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 500,
      }),
    );
  });

  it('lists database audit events with filters', async () => {
    const findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 'audit_1',
          action: 'share.download_started',
          actor: 'visitor',
          target: 's_one',
          workspaceId: 'workspace-default',
          shareToken: 's_one',
          nodeId: 'roadmap',
          metadata: { source: 'spec' },
          createdAt: new Date(0),
        },
      ]),
    );
    const prisma = {
      auditEvent: {
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    const events = await service.listEvents({
      action: 'share.download_started',
      nodeId: 'roadmap',
    });

    const [findManyInput] = findMany.mock.calls[0] ?? [];
    expect(findManyInput).toEqual(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      }),
    );
    const where = getAuditWhere(findManyInput);
    expect(where).toEqual(
      expect.objectContaining({
        action: 'share.download_started',
        nodeId: 'roadmap',
      }),
    );
    expect(
      typeof where.createdAt === 'object' && !(where.createdAt instanceof Date)
        ? where.createdAt.lte
        : undefined,
    ).toBeInstanceOf(Date);
    expect(events).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            action: 'share.download_started',
            shareToken: 's_one',
            nodeId: 'roadmap',
            resourceType: 'share',
            result: 'success',
          }),
        ],
        limit: 100,
        offset: 0,
        total: 1,
        summary: { failed: 0, success: 1 },
      }),
    );
  });

  it('does not apply an action allowlist to default listings', async () => {
    const findMany = jest.fn<Promise<AuditEvent[]>, [AuditFindManyInput]>(() =>
      Promise.resolve([
        {
          id: 'future-event',
          action: 'future.legitimate_historical_event',
          actor: 'system',
          target: 'future-target',
          workspaceId: 'workspace-default',
          shareToken: null,
          nodeId: null,
          metadata: {},
          createdAt: new Date('2026-08-12T00:00:00.000Z'),
        },
      ]),
    );
    const prisma = {
      auditEvent: {
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    const events = await service.listEvents({
      workspaceId: 'workspace-default',
    });

    const [findManyInput] = findMany.mock.calls[0] ?? [];
    if (!findManyInput?.where) throw new Error('Audit query was not captured');
    expect(findManyInput.where.workspaceId).toBe('workspace-default');
    expect(findManyInput.where.action).toBeUndefined();
    expect(events.items).toEqual([
      expect.objectContaining({
        action: 'future.legitimate_historical_event',
        id: 'future-event',
      }),
    ]);
  });

  it('queries explicit user-facing activity filters', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const prisma = {
      auditEvent: {
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.listEvents({ action: 'file.preview_requested' }),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [],
        limit: 100,
        offset: 0,
        total: 0,
      }),
    );

    const [findManyInput] = findMany.mock.calls[0] ?? [];
    const where = getAuditWhere(findManyInput);
    expect(where.action).toBe('file.preview_requested');
    expect(
      typeof where.createdAt === 'object' && !(where.createdAt instanceof Date)
        ? where.createdAt.lte
        : undefined,
    ).toBeInstanceOf(Date);
    expect(findManyInput?.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(findManyInput?.take).toBe(500);
  });

  it.each([
    'file.download_intent_created',
    'file.batch_download_intents_created',
    'share.download_intent_created',
    'transfer.expired',
    'future.legitimate_historical_event',
  ])('queries a syntactically valid explicit action %s', async (action) => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const prisma = {
      auditEvent: {
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(service.listEvents({ action })).resolves.toEqual(
      expect.objectContaining({
        items: [],
        limit: 100,
        offset: 0,
        total: 0,
      }),
    );

    const [findManyInput] = findMany.mock.calls[0] ?? [];
    expect(getAuditWhere(findManyInput).action).toBe(action);
  });

  it('uses a strict system scope and database date/actor filters', async () => {
    const findMany = jest.fn<Promise<never[]>, [AuditFindManyInput]>(() =>
      Promise.resolve([]),
    );
    const service = new AuditService({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    await service.listEvents({
      scope: 'system',
      actor: 'system',
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-12T00:00:00.000Z',
    });

    const [input] = findMany.mock.calls[0] ?? [];
    expect(input?.where?.actor).toBe('system');
    expect(input?.where?.workspaceId).toBeNull();
    expect(input?.where?.createdAt).toEqual({
      gte: new Date('2026-08-01T00:00:00.000Z'),
      lte: new Date('2026-08-12T00:00:00.000Z'),
    });
  });

  it.each([
    [{ scope: 'unexpected' }, 'scope'],
    [{ scope: 'all', workspaceId: 'workspace-default' }, 'workspaceId'],
    [{ scope: 'system', workspaceId: 'workspace-default' }, 'workspaceId'],
    [{ scope: 'workspace' }, 'workspaceId'],
    [{ actor: 'administrator' }, 'actor'],
    [{ result: 'unknown' }, 'result'],
    [{ resourceType: 'database' }, 'resourceType'],
    [{ sortBy: 'target' }, 'sortBy'],
    [{ sortDirection: 'sideways' }, 'sortDirection'],
    [{ limit: Number.NaN }, 'limit'],
    [{ action: 'not namespaced' }, 'action'],
    [{ action: '.leading_dot' }, 'action'],
    [{ action: `file.${'x'.repeat(124)}` }, 'action'],
    [{ action: 'file..download_started' }, 'action'],
    [{ action: 'file.download_started OR 1=1' }, 'action'],
    [{ action: "file.download_started'--" }, 'action'],
  ])(
    'rejects unsafe query input %p instead of widening its result (%s)',
    async (filters) => {
      const findMany = jest.fn();
      const service = new AuditService({
        auditEvent: { findMany },
      } as unknown as PrismaService);

      await expect(service.listEvents(filters as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('pushes the resource type restriction into the database action filter', async () => {
    const findMany = jest.fn<Promise<never[]>, [AuditFindManyInput]>(() =>
      Promise.resolve([]),
    );
    const service = new AuditService({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    await service.listEvents({ resourceType: 'share' });

    const [input] = findMany.mock.calls[0] ?? [];
    const action = input?.where?.action;
    if (!action || typeof action === 'string') {
      throw new Error('Audit action filter was not captured');
    }
    expect(action).toEqual({ startsWith: 'share.' });
  });

  it('scans in bounded batches while preserving exact totals and pagination', async () => {
    const rows = Array.from({ length: 503 }, (_, index) => ({
      id: `audit-${index.toString().padStart(3, '0')}`,
      action: index % 2 === 0 ? 'auth.login' : 'auth.login_failed',
      actor: 'account',
      target: `target-${index}`,
      workspaceId: null,
      shareToken: null,
      nodeId: null,
      metadata: {},
      createdAt: new Date(503 - index),
    })) as AuditEvent[];
    const findMany = jest.fn((input: AuditFindManyInput) => {
      const cursor = input.where?.AND?.[1];
      const cursorDate = cursor?.OR?.[0]?.createdAt;
      const filtered =
        cursorDate && !(cursorDate instanceof Date) && cursorDate.lt
          ? rows.filter((row) => row.createdAt < cursorDate.lt!)
          : rows;
      return Promise.resolve(filtered.slice(0, input.take));
    });
    const service = new AuditService({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    const events = await service.listEvents({ offset: 499, limit: 3 });

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 500 }),
    );
    expect(findMany.mock.calls[1]?.[0].where?.AND?.[1]).toEqual({
      OR: [
        { createdAt: { lt: rows[499]?.createdAt } },
        {
          createdAt: rows[499]?.createdAt,
          id: { lt: rows[499]?.id },
        },
      ],
    });
    expect(events.items.map((event) => event.id)).toEqual([
      'audit-499',
      'audit-500',
      'audit-501',
    ]);
    expect(events.total).toBe(503);
    expect(events.summary).toEqual({ success: 252, failed: 251 });
    expect(events.facets.actions).toEqual(['auth.login', 'auth.login_failed']);
  });

  it('does not skip existing rows when another row is deleted between keyset batches', async () => {
    const oldRows = Array.from({ length: 501 }, (_, index) => ({
      id: `old-${index.toString().padStart(3, '0')}`,
      action: 'auth.login',
      actor: 'account',
      target: `target-${index}`,
      workspaceId: null,
      shareToken: null,
      nodeId: null,
      metadata: {},
      createdAt: new Date(Date.now() - index - 1_000),
    })) as AuditEvent[];
    let rows = oldRows;
    const findMany = jest.fn((input: AuditFindManyInput) => {
      const cursor = input.where?.AND?.[1]?.OR?.[0]?.createdAt;
      const eligible =
        cursor && !(cursor instanceof Date) && cursor.lt
          ? rows.filter((row) => row.createdAt < cursor.lt!)
          : rows;
      const result = eligible.slice(0, input.take);
      if (!cursor) {
        rows = oldRows.filter((row) => row.id !== 'old-100');
      }
      return Promise.resolve(result);
    });
    const service = new AuditService({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    const events = await service.listEvents({ offset: 499, limit: 2 });

    expect(events.items.map((event) => event.id)).toEqual([
      'old-499',
      'old-500',
    ]);
    expect(events.total).toBe(501);
  });

  it('does not duplicate rows when a late historical row is inserted ahead of the cursor', async () => {
    const oldRows = Array.from({ length: 501 }, (_, index) => ({
      id: `old-${index.toString().padStart(3, '0')}`,
      action: 'auth.login',
      actor: 'account',
      target: `target-${index}`,
      workspaceId: null,
      shareToken: null,
      nodeId: null,
      metadata: {},
      createdAt: new Date(Date.now() - index - 1_000),
    })) as AuditEvent[];
    let rows = oldRows;
    const findMany = jest.fn((input: AuditFindManyInput) => {
      const cursor = input.where?.AND?.[1]?.OR?.[0]?.createdAt;
      const eligible =
        cursor && !(cursor instanceof Date) && cursor.lt
          ? rows.filter((row) => row.createdAt < cursor.lt!)
          : rows;
      const result = eligible.slice(0, input.take);
      if (!cursor) {
        rows = [
          ...oldRows.slice(0, 101),
          {
            ...oldRows[100],
            id: 'late-historical',
            createdAt: new Date(oldRows[100].createdAt.getTime() - 1),
          },
          ...oldRows.slice(101),
        ];
      }
      return Promise.resolve(result);
    });
    const service = new AuditService({
      auditEvent: { findMany },
    } as unknown as PrismaService);

    const events = await service.listEvents({ offset: 499, limit: 3 });

    expect(events.items.map((event) => event.id)).toEqual([
      'old-499',
      'old-500',
    ]);
    expect(new Set(events.items.map((event) => event.id)).size).toBe(2);
    expect(events.total).toBe(501);
  });

  it.each([
    [
      { sortBy: 'action', sortDirection: 'asc' },
      [
        { action: { gt: 'auth.login' } },
        { action: 'auth.login', createdAt: { lt: new Date(1) } },
        {
          action: 'auth.login',
          createdAt: new Date(1),
          id: { lt: 'audit-499' },
        },
      ],
    ],
    [
      { sortBy: 'actor', sortDirection: 'desc' },
      [
        { actor: { lt: 'account' } },
        { actor: 'account', createdAt: { lt: new Date(1) } },
        {
          actor: 'account',
          createdAt: new Date(1),
          id: { lt: 'audit-499' },
        },
      ],
    ],
  ] as const)(
    'builds a complete keyset for %p',
    async (sorting, expectedOr) => {
      const firstBatch = Array.from({ length: 500 }, (_, index) => ({
        id: `audit-${index.toString().padStart(3, '0')}`,
        action: 'auth.login',
        actor: 'account',
        target: `target-${index}`,
        workspaceId: null,
        shareToken: null,
        nodeId: null,
        metadata: {},
        createdAt: new Date(500 - index),
      })) as AuditEvent[];
      const findMany = jest
        .fn<Promise<AuditEvent[]>, [AuditFindManyInput]>()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce([]);
      const service = new AuditService({
        auditEvent: { findMany },
      } as unknown as PrismaService);

      await service.listEvents(sorting);

      expect(findMany.mock.calls[1]?.[0].where?.AND?.[1]?.OR).toEqual(
        expectedOr,
      );
    },
  );

  it('keeps PostgreSQL overview queries parameterized and maps aggregate rows', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          date: '2026-08-12',
          result: 'failed',
          resourceType: 'system',
          total: 2n,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'postgres-risk',
          action: 'auth.login_failed',
          actor: 'account',
          target: 'alice',
          workspaceId: 'workspace-postgres',
          shareToken: null,
          nodeId: null,
          metadata: { actorDisplayName: 'Alice' },
          createdAt: new Date('2026-08-12T10:00:00.000Z'),
        },
      ]);
    const service = new AuditService({
      isSqlite: () => false,
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    const metrics = await service.getOverviewMetrics({
      scope: 'workspace',
      workspaceId: 'workspace-postgres',
      createdFrom: '2026-08-12T00:00:00.000Z',
      createdTo: '2026-08-12T23:59:59.999Z',
    });

    expect(metrics).toEqual({
      total: 2,
      failed: 2,
      dailyTrend: [{ date: '2026-08-12', total: 2, failed: 2 }],
      resourceDistribution: [{ resourceType: 'system', total: 2 }],
      recentRiskEvents: [
        expect.objectContaining({
          id: 'postgres-risk',
          workspaceId: 'workspace-postgres',
          actorDisplayName: 'Alice',
          createdAt: '2026-08-12T10:00:00.000Z',
        }),
      ],
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const [template, ...values] of queryRaw.mock.calls) {
      expect(Array.isArray(template)).toBe(true);
      const sql = (template as string[]).join('');
      expect(sql).not.toContain('workspace-postgres');
      expect(sql).toContain('chr(9)');
      expect(sql).toContain('chr(10)');
      expect(sql).toContain('chr(160)');
      expect(sql).toContain('chr(65279)');
      expect(values).toContain('workspace-postgres');
    }
  });
});
