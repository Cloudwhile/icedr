import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../../logs/audit.service';
import { PrismaService } from '../../../database/prisma.service';
import { OverviewService } from './overview.service';

describe('OverviewService', () => {
  function createPrisma() {
    return {
      workspace: {
        count: jest.fn(() => Promise.resolve(3)),
        findUnique: jest.fn(() => Promise.resolve({ id: 'workspace-default' })),
      },
      fileNode: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { sizeBytes: 100n } })
          .mockResolvedValueOnce({ _sum: { sizeBytes: 20n } }),
        count: jest
          .fn()
          .mockResolvedValueOnce(4)
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1),
      },
      fileVersion: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { sizeBytes: 30n } })),
        count: jest.fn(() => Promise.resolve(5)),
      },
    };
  }

  function createAuditMetrics() {
    return {
      total: 2,
      failed: 1,
      dailyTrend: [
        { date: '2026-08-11', total: 1, failed: 1 },
        { date: '2026-08-12', total: 1, failed: 0 },
      ],
      resourceDistribution: [
        { resourceType: 'file' as const, total: 1 },
        { resourceType: 'system' as const, total: 1 },
      ],
      recentRiskEvents: [
        {
          id: 'failed',
          action: 'auth.login_failed',
          actor: 'account' as const,
          target: 'alice',
          workspaceId: null,
          shareToken: null,
          nodeId: null,
          metadata: {},
          createdAt: '2026-08-11T10:00:00.000Z',
          actorDisplayName: 'Alice',
          actorEmail: null,
          actorUserId: 'user-alice',
          ipAddress: '203.0.113.9',
          resourceType: 'system' as const,
          result: 'failed' as const,
        },
      ],
    };
  }

  it('aggregates global storage and database audit metrics for the requested window', async () => {
    const prisma = createPrisma();
    const getOverviewMetrics = jest.fn(() =>
      Promise.resolve(createAuditMetrics()),
    );
    const service = new OverviewService(
      prisma as unknown as PrismaService,
      { getOverviewMetrics } as unknown as AuditService,
    );

    const result = await service.getOverview({
      scope: 'all',
      from: '2026-08-11T00:00:00.000Z',
      to: '2026-08-12T23:59:59.999Z',
    });

    expect(result.scope).toEqual({ kind: 'all' });
    expect(result.workspaceCount).toBe(3);
    expect(result.storage).toEqual({
      activeBytes: 100,
      trashBytes: 20,
      versionBytes: 30,
      usedBytes: 150,
      fileCount: 4,
      trashFileCount: 2,
      folderCount: 1,
      versionCount: 5,
    });
    expect(result.audit).toEqual(createAuditMetrics());
    expect(getOverviewMetrics).toHaveBeenCalledWith({
      scope: 'all',
      workspaceId: undefined,
      createdFrom: '2026-08-11T00:00:00.000Z',
      createdTo: '2026-08-12T23:59:59.999Z',
    });
  });

  it('fills dates absent from the database aggregation with zeroes', async () => {
    const prisma = createPrisma();
    const getOverviewMetrics = jest.fn(() =>
      Promise.resolve({
        ...createAuditMetrics(),
        total: 1,
        failed: 0,
        dailyTrend: [{ date: '2026-08-12', total: 1, failed: 0 }],
      }),
    );
    const service = new OverviewService(
      prisma as unknown as PrismaService,
      { getOverviewMetrics } as unknown as AuditService,
    );

    const result = await service.getOverview({
      from: '2026-08-11T00:00:00.000Z',
      to: '2026-08-12T23:59:59.999Z',
    });

    expect(result.audit.dailyTrend).toEqual([
      { date: '2026-08-11', total: 0, failed: 0 },
      { date: '2026-08-12', total: 1, failed: 0 },
    ]);
  });

  it('returns zero storage and workspaces for the strict system scope', async () => {
    const prisma = createPrisma();
    const getOverviewMetrics = jest.fn(() =>
      Promise.resolve({
        total: 0,
        failed: 0,
        dailyTrend: [],
        resourceDistribution: [],
        recentRiskEvents: [],
      }),
    );
    const service = new OverviewService(
      prisma as unknown as PrismaService,
      { getOverviewMetrics } as unknown as AuditService,
    );

    const result = await service.getOverview({
      scope: 'system',
      from: '2026-08-12T00:00:00.000Z',
      to: '2026-08-12T23:59:59.999Z',
    });

    expect(result.workspaceCount).toBe(0);
    expect(result.storage).toEqual({
      activeBytes: 0,
      trashBytes: 0,
      versionBytes: 0,
      usedBytes: 0,
      fileCount: 0,
      trashFileCount: 0,
      folderCount: 0,
      versionCount: 0,
    });
    expect(prisma.workspace.count).not.toHaveBeenCalled();
    expect(prisma.fileNode.aggregate).not.toHaveBeenCalled();
    expect(getOverviewMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'system', workspaceId: undefined }),
    );
  });

  it.each([
    [{ scope: 'unexpected' }, 'unknown scope'],
    [{ scope: 'all', workspaceId: 'workspace-default' }, 'mixed all scope'],
    [
      { scope: 'system', workspaceId: 'workspace-default' },
      'mixed system scope',
    ],
    [{ scope: 'workspace' }, 'missing workspace'],
    [
      {
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-08-12T00:00:00.000Z',
      },
      'oversized window',
    ],
  ])('rejects %s before querying overview data (%s)', async (query) => {
    const prisma = createPrisma();
    const getOverviewMetrics = jest.fn();
    const service = new OverviewService(
      prisma as unknown as PrismaService,
      { getOverviewMetrics } as unknown as AuditService,
    );

    await expect(service.getOverview(query as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.workspace.count).not.toHaveBeenCalled();
    expect(getOverviewMetrics).not.toHaveBeenCalled();
  });

  it('validates workspace existence before starting storage or audit aggregation', async () => {
    const prisma = createPrisma();
    prisma.workspace.findUnique.mockResolvedValue(null);
    const getOverviewMetrics = jest.fn();
    const service = new OverviewService(
      prisma as unknown as PrismaService,
      { getOverviewMetrics } as unknown as AuditService,
    );

    await expect(
      service.getOverview({ scope: 'workspace', workspaceId: 'missing' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
      select: { id: true },
    });
    expect(prisma.fileNode.aggregate).not.toHaveBeenCalled();
    expect(prisma.fileVersion.aggregate).not.toHaveBeenCalled();
    expect(getOverviewMetrics).not.toHaveBeenCalled();
  });
});
