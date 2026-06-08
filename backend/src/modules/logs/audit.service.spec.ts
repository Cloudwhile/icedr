import { AuditService } from './audit.service';
import { PrismaService } from '../../database/prisma.service';

type AuditFindManyInput = {
  where?: {
    action?: string | { in: string[] };
    nodeId?: string;
    OR?: unknown[];
    workspaceId?: string;
  };
  orderBy?: { createdAt: 'desc' };
  take?: number;
};

describe('AuditService', () => {
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

    expect(findMany).toHaveBeenCalledWith({
      where: {
        action: 'share.download_started',
        nodeId: 'roadmap',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    expect(events).toEqual([
      expect.objectContaining({
        action: 'share.download_started',
        shareToken: 's_one',
        nodeId: 'roadmap',
      }),
    ]);
  });

  it('limits default listing to user-facing activities', async () => {
    const findMany = jest.fn<Promise<never[]>, [AuditFindManyInput]>(() =>
      Promise.resolve([]),
    );
    const prisma = {
      auditEvent: {
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
          in: [
            'auth.login',
            'auth.registered',
            'auth.password_reset_completed',
          ],
        },
      },
    ]);
    const actionFilter = action.in;
    expect(actionFilter).toEqual(
      expect.arrayContaining([
        'auth.login',
        'file.download_started',
        'file.upload_completed',
        'share.download_started',
      ]),
    );
    expect(actionFilter).not.toContain('file.download_intent_created');
    expect(actionFilter).not.toContain('file.preview_requested');
    expect(actionFilter).not.toContain('share.download_intent_created');
  });

  it('returns no rows for internal activity filters', async () => {
    const findMany = jest.fn();
    const prisma = {
      auditEvent: {
        findMany,
      },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.listEvents({ action: 'file.download_intent_created' }),
    ).resolves.toEqual([]);

    expect(findMany).not.toHaveBeenCalled();
  });
});
