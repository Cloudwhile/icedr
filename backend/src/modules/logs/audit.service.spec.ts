import { BadRequestException } from '@nestjs/common';
import type { AuditEvent } from '../../generated/prisma/client';
import { resolveAuditResult } from './audit-events';
import { AuditService } from './audit.service';
import { PrismaService } from '../../database/prisma.service';

type AuditFindManyInput = {
  where?: {
    action?: string | { in?: string[]; startsWith?: string };
    actor?: string;
    createdAt?: { gte?: Date; lte?: Date };
    nodeId?: string;
    workspaceId?: string | null;
  };
  orderBy?: unknown[];
  skip?: number;
  take?: number;
};

describe('AuditService', () => {
  it('classifies authentication policy blocks as failed outcomes', () => {
    expect(resolveAuditResult('auth.method_policy_blocked', {})).toBe('failed');
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
        skip: undefined,
        take: undefined,
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

    const expectedWhere = {
      action: 'share.download_started',
      nodeId: 'roadmap',
    };
    expect(findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: undefined,
      take: undefined,
    });
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

    expect(findMany).toHaveBeenCalledWith({
      where: { action: 'file.preview_requested' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: undefined,
      take: undefined,
    });
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

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action } }),
    );
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
});
