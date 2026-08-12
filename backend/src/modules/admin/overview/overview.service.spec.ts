import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../../logs/audit.service';
import { PrismaService } from '../../../database/prisma.service';
import { OverviewService } from './overview.service';

describe('OverviewService', () => {
  it('aggregates global storage and audit data for the requested window', async () => {
    const countWorkspaces = jest.fn(() => Promise.resolve(3));
    const aggregateNodes = jest
      .fn()
      .mockResolvedValueOnce({ _sum: { sizeBytes: 100n } })
      .mockResolvedValueOnce({ _sum: { sizeBytes: 20n } });
    const countNodes = jest
      .fn()
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const aggregateVersions = jest.fn(() =>
      Promise.resolve({ _sum: { sizeBytes: 30n } }),
    );
    const countVersions = jest.fn(() => Promise.resolve(5));
    const prisma = {
      workspace: { count: countWorkspaces },
      fileNode: { aggregate: aggregateNodes, count: countNodes },
      fileVersion: {
        aggregate: aggregateVersions,
        count: countVersions,
      },
    } as unknown as PrismaService;
    const getEventSnapshot = jest.fn(() =>
      Promise.resolve({
        generatedAt: '2026-08-12T02:00:00.000Z',
        scope: { kind: 'all' as const },
        facets: { actions: [], actors: [] },
        summary: { success: 1, failed: 1 },
        total: 2,
        items: [
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
          {
            id: 'success',
            action: 'file.download_started',
            actor: 'account' as const,
            target: 'roadmap',
            workspaceId: 'workspace-default',
            shareToken: null,
            nodeId: 'roadmap',
            metadata: {},
            createdAt: '2026-08-12T10:00:00.000Z',
            actorDisplayName: 'Bob',
            actorEmail: null,
            actorUserId: 'user-bob',
            ipAddress: null,
            resourceType: 'file' as const,
            result: 'success' as const,
          },
        ],
      }),
    );
    const service = new OverviewService(prisma, {
      getEventSnapshot,
    } as unknown as AuditService);

    const result = await service.getOverview({
      scope: 'all',
      from: '2026-08-11T00:00:00.000Z',
      to: '2026-08-12T23:59:59.999Z',
    });

    expect(result.scope).toEqual({ kind: 'all' });
    expect(result.window).toEqual({
      from: '2026-08-11T00:00:00.000Z',
      to: '2026-08-12T23:59:59.999Z',
    });
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
    expect(result.audit.total).toBe(2);
    expect(result.audit.failed).toBe(1);
    expect(result.audit.dailyTrend).toEqual([
      { date: '2026-08-11', total: 1, failed: 1 },
      { date: '2026-08-12', total: 1, failed: 0 },
    ]);
    expect(result.audit.resourceDistribution).toEqual([
      { resourceType: 'file', total: 1 },
      { resourceType: 'system', total: 1 },
    ]);
    expect(result.audit.recentRiskEvents).toHaveLength(1);
    expect(result.audit.recentRiskEvents[0]?.id).toBe('failed');
    expect(getEventSnapshot).toHaveBeenCalledWith({
      scope: 'all',
      workspaceId: undefined,
      createdFrom: '2026-08-11T00:00:00.000Z',
      createdTo: '2026-08-12T23:59:59.999Z',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
  });

  it('returns zero storage and workspaces for the strict system scope', async () => {
    const countWorkspaces = jest.fn();
    const aggregateNodes = jest.fn();
    const prisma = {
      workspace: { count: countWorkspaces },
      fileNode: { aggregate: aggregateNodes, count: jest.fn() },
      fileVersion: { aggregate: jest.fn(), count: jest.fn() },
    } as unknown as PrismaService;
    const getEventSnapshot = jest.fn(() =>
      Promise.resolve({
        generatedAt: '2026-08-12T02:00:00.000Z',
        scope: { kind: 'system' as const },
        facets: { actions: [], actors: [] },
        summary: { success: 0, failed: 0 },
        total: 0,
        items: [],
      }),
    );
    const service = new OverviewService(prisma, {
      getEventSnapshot,
    } as unknown as AuditService);

    const result = await service.getOverview({
      scope: 'system',
      from: '2026-08-12T00:00:00.000Z',
      to: '2026-08-12T23:59:59.999Z',
    });

    expect(result.scope).toEqual({ kind: 'system' });
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
    expect(countWorkspaces).not.toHaveBeenCalled();
    expect(aggregateNodes).not.toHaveBeenCalled();
    expect(getEventSnapshot).toHaveBeenCalledWith(
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
    const count = jest.fn();
    const getEventSnapshot = jest.fn();
    const service = new OverviewService(
      {
        workspace: { count },
        fileNode: { aggregate: jest.fn(), count: jest.fn() },
        fileVersion: { aggregate: jest.fn(), count: jest.fn() },
      } as unknown as PrismaService,
      { getEventSnapshot } as unknown as AuditService,
    );

    await expect(service.getOverview(query as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(count).not.toHaveBeenCalled();
    expect(getEventSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a workspace scope that no longer exists', async () => {
    const prisma = {
      workspace: { count: jest.fn(() => Promise.resolve(0)) },
      fileNode: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { sizeBytes: 0n } })),
        count: jest.fn(() => Promise.resolve(0)),
      },
      fileVersion: {
        aggregate: jest.fn(() => Promise.resolve({ _sum: { sizeBytes: 0n } })),
        count: jest.fn(() => Promise.resolve(0)),
      },
    } as unknown as PrismaService;
    const audit = {
      getEventSnapshot: jest.fn(() =>
        Promise.resolve({
          facets: { actions: [], actors: [] },
          generatedAt: '2026-08-12T00:00:00.000Z',
          items: [],
          scope: { kind: 'workspace', workspaceId: 'missing' },
          summary: { failed: 0, success: 0 },
          total: 0,
        }),
      ),
    } as unknown as AuditService;
    const service = new OverviewService(prisma, audit);

    await expect(
      service.getOverview({
        scope: 'workspace',
        workspaceId: 'missing',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
