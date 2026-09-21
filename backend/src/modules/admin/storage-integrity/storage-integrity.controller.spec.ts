import { ForbiddenException } from '@nestjs/common';
import type { AdminGuardService } from '../../../common/security/admin-guard.service';
import type { StorageIntegrityTaskService } from '../../storage/storage-integrity-task.service';
import type { StorageIntegrityAcknowledgementService } from '../../storage/storage-integrity-acknowledgement.service';
import { StorageIntegrityController } from './storage-integrity.controller';

function setup() {
  const requirePermission = jest.fn(() =>
    Promise.resolve({ user: { id: 'admin-1' } }),
  );
  const createTask = jest.fn(() => Promise.resolve({ id: 'task-1' }));
  const listTasks = jest.fn(() => Promise.resolve({ items: [], total: 0 }));
  const listResults = jest.fn(() => Promise.resolve({ items: [], total: 0 }));
  const getTask = jest.fn(() => Promise.resolve({ id: 'task-1' }));
  const retryTask = jest.fn(() => Promise.resolve({ id: 'task-2' }));
  const getSummary = jest.fn(() => Promise.resolve({ counts: {} }));
  const listTargets = jest.fn(() => Promise.resolve({ items: [], total: 0 }));
  const listTargetVersions = jest.fn(() => Promise.resolve([]));
  const acknowledgeResult = jest.fn(() =>
    Promise.resolve({ id: 'result-1', acknowledgedBy: 'admin-1' }),
  );
  const tasks = {
    createTask,
    getSummary,
    getTask,
    listResults,
    listTargets,
    listTargetVersions,
    listTasks,
    retryTask,
  } as unknown as StorageIntegrityTaskService;
  return {
    controller: new StorageIntegrityController(
      tasks,
      {
        acknowledgeResult,
      } as unknown as StorageIntegrityAcknowledgementService,
      {
        requirePermission,
      } as unknown as AdminGuardService,
    ),
    acknowledgeResult,
    createTask,
    getSummary,
    listResults,
    listTasks,
    listTargets,
    requirePermission,
  };
}

describe('StorageIntegrityController', () => {
  it('requires storage manage and attributes acknowledgement to the session', async () => {
    const { acknowledgeResult, controller, requirePermission } = setup();

    await controller.acknowledgeResult('result-1', 'Bearer admin');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'storage',
      'manage',
    );
    expect(acknowledgeResult).toHaveBeenCalledWith('result-1', 'admin-1');
  });
  it('requires storage manage and attributes task creation to the session', async () => {
    const { controller, createTask, requirePermission } = setup();
    const dto = {
      batchSize: 50,
      concurrency: 2,
      maxAttempts: 3,
      mode: 'verify' as const,
      scope: 'all' as const,
    };

    await controller.createTask(dto, 'Bearer admin');

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'storage',
      'manage',
    );
    expect(createTask).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('protects the workspace-scoped target picker with storage manage permission', async () => {
    const { controller, listTargets, requirePermission } = setup();

    await controller.listTargets(
      {
        limit: 20,
        offset: 0,
        query: 'report',
        workspaceId: ' workspace-a ',
      },
      'Bearer admin',
    );

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'storage',
      'manage',
    );
    expect(listTargets).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: ' workspace-a ' }),
    );
  });

  it('does not expose task history when permission validation fails', async () => {
    const { controller, listTasks, requirePermission } = setup();
    requirePermission.mockRejectedValueOnce(new ForbiddenException());

    await expect(
      controller.listTasks(
        { limit: 50, offset: 0, scope: 'all' },
        'Bearer member',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it('maps the all result status to an unfiltered repository query', async () => {
    const { controller, listResults } = setup();

    await controller.listResults(
      'task-1',
      { limit: 100, offset: 20, status: 'all' },
      'Bearer admin',
    );

    expect(listResults).toHaveBeenCalledWith({
      limit: 100,
      offset: 20,
      status: undefined,
      taskId: 'task-1',
    });
  });

  it('passes an explicit workspace scope to summary and history', async () => {
    const { controller, getSummary, listTasks } = setup();

    await controller.getSummary(
      { scope: 'workspace', workspaceId: 'workspace-a' },
      'Bearer admin',
    );
    await controller.listTasks(
      {
        limit: 25,
        offset: 0,
        scope: 'workspace',
        workspaceId: 'workspace-a',
      },
      'Bearer admin',
    );

    expect(getSummary).toHaveBeenCalledWith('workspace', 'workspace-a');
    expect(listTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'workspace',
        workspaceId: 'workspace-a',
      }),
    );
  });
});
