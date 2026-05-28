import { AuditService } from './audit.service';
import { DatabaseService } from '../../database/database.service';

describe('AuditService', () => {
  it('lists database audit events with filters', async () => {
    const query = jest.fn(() =>
      Promise.resolve({
        rows: [
          {
            id: 'audit_1',
            action: 'share.download_started',
            actor: 'visitor',
            target: 's_one',
            workspace_id: 'workspace-default',
            share_token: 's_one',
            node_id: 'roadmap',
            metadata: { source: 'spec' },
            created_at: new Date(0),
          },
        ],
      }),
    );
    const database = {
      query,
    } as unknown as DatabaseService;
    const service = new AuditService(database);

    const events = await service.listEvents({
      action: 'share.download_started',
      nodeId: 'roadmap',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('from audit_events'),
      ['roadmap', 'share.download_started', 100],
    );
    expect(events).toEqual([
      expect.objectContaining({
        action: 'share.download_started',
        shareToken: 's_one',
        nodeId: 'roadmap',
      }),
    ]);
  });
});
