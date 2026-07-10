import { AuditService } from './audit.service';
import { PrismaService } from '../../database/prisma.service';
import { auditedActivityActions } from './audit-events';

type AuditFindManyInput = {
  where?: {
    action?: string | { in: string[] };
    nodeId?: string;
    OR?: unknown[];
    workspaceId?: string;
  };
  orderBy?: { createdAt: 'desc' };
  skip?: number;
  take?: number;
};

describe('AuditService', () => {
  it('lists database audit events with filters', async () => {
    const count = jest.fn(() => Promise.resolve(1));
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
        count,
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
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 100,
    });
    expect(events).toEqual({
      items: [
        expect.objectContaining({
          action: 'share.download_started',
          shareToken: 's_one',
          nodeId: 'roadmap',
        }),
      ],
      limit: 100,
      offset: 0,
      total: 1,
    });
  });

  it('limits default listing to user-facing activities', async () => {
    const count = jest.fn(() => Promise.resolve(0));
    const findMany = jest.fn<Promise<never[]>, [AuditFindManyInput]>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      auditEvent: {
        count,
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.listEvents({ workspaceId: 'workspace-default' });

    const [findManyInput] = findMany.mock.calls[0] ?? [];
    if (!findManyInput?.where) throw new Error('Audit query was not captured');
    const action = findManyInput.where.action;
    if (!action || typeof action === 'string') {
      throw new Error('Audit action filter was not captured');
    }
    expect(findManyInput.where.OR).toEqual([
      { workspaceId: 'workspace-default' },
      {
        action: {
          in: auditedActivityActions.filter((action) =>
            action.startsWith('auth.'),
          ),
        },
      },
    ]);
    const actionFilter = action.in;
    expect(actionFilter).toEqual(
      expect.arrayContaining([
        'auth.login',
        'auth.login_failed',
        'auth.method_policy_blocked',
        'auth.passkey_added',
        'auth.passkey_removed',
        'auth.passkey_renamed',
        'auth.reauthentication_failed',
        'auth.reauthentication_succeeded',
        'auth.recovery_code_used',
        'auth.recovery_codes_generated',
        'file.download_started',
        'file.preview_requested',
        'file.quota_updated',
        'file.renamed',
        'file.search_performed',
        'file.upload_completed',
        'share.access_code_failed',
        'share.access_code_locked',
        'share.access_code_sent',
        'share.access_session_created',
        'share.download_started',
        'share.preview_requested',
        'share.rate_limited',
        'share.viewed',
        'transfer.created',
        'transfer.paused',
      ]),
    );
  });

  it('queries explicit user-facing activity filters', async () => {
    const count = jest.fn(() => Promise.resolve(0));
    const findMany = jest.fn(() => Promise.resolve([]));
    const prisma = {
      auditEvent: {
        count,
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.listEvents({ action: 'file.preview_requested' }),
    ).resolves.toEqual({
      items: [],
      limit: 100,
      offset: 0,
      total: 0,
    });

    expect(count).toHaveBeenCalledWith({
      where: { action: 'file.preview_requested' },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { action: 'file.preview_requested' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 100,
    });
  });

  it('returns no rows for internal activity filters', async () => {
    const count = jest.fn();
    const findMany = jest.fn();
    const prisma = {
      auditEvent: {
        count,
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.listEvents({ action: 'file.download_intent_created' }),
    ).resolves.toEqual({
      items: [],
      limit: 100,
      offset: 0,
      total: 0,
    });

    expect(count).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
