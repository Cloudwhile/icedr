import { AuditService } from './audit.service';
import { PrismaService } from '../../database/prisma.service';

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
});
