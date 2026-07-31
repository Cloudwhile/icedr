import { createStorageTestContext } from './storage-settings-usage.spec-helper';

describe('StorageReconcileRunner', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('persists a running reconcile task before scanning and completes it', async () => {
    const {
      objectStorage,
      createReconcileTask,
      listFileObjectReferences,
      recoverStaleRunningTasks,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    const completedTask = { id: 'blobrec-1', status: 'completed' };
    createReconcileTask.mockResolvedValue({
      id: 'blobrec-1',
      status: 'running',
    });
    updateReconcileTask.mockResolvedValue(completedTask);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);

    const result = await service.reconcileObjects(
      { cleanup: false, workspaceId: ' workspace-default ' },
      'admin-a',
    );

    expect(createReconcileTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'admin-a',
        cleanup: false,
        staleUploadMinutes: 60,
        status: 'running',
        workspaceId: 'workspace-default',
      }),
    );
    expect(recoverStaleRunningTasks).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
    );
    expect(recoverStaleRunningTasks.mock.invocationCallOrder[0]).toBeLessThan(
      createReconcileTask.mock.invocationCallOrder[0],
    );
    expect(createReconcileTask.mock.invocationCallOrder[0]).toBeLessThan(
      listFileObjectReferences.mock.invocationCallOrder[0],
    );
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-1',
      expect.objectContaining({
        failureCode: null,
        finishedAt: expect.any(String) as unknown,
        status: 'completed',
        summary: {
          deletedObjects: 0,
          missingObjects: 0,
          orphanObjects: 0,
          referencedObjects: 0,
          staleUploads: 0,
          storageObjects: 0,
        },
      }),
    );
    expect(result).toBe(completedTask);
  });

  it('marks a running reconcile task as failed before rethrowing the same error', async () => {
    const {
      createReconcileTask,
      listFileObjectReferences,
      objectStorage,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    const failure = new Error('storage listing failed');
    createReconcileTask.mockResolvedValue({
      id: 'blobrec-2',
      status: 'running',
    });
    listFileObjectReferences.mockRejectedValueOnce(failure);
    updateReconcileTask.mockResolvedValue({
      id: 'blobrec-2',
      status: 'failed',
    });
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);

    await expect(service.reconcileObjects({}, 'admin-b')).rejects.toBe(failure);
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-2',
      expect.objectContaining({
        failureCode: 'STORAGE_RECONCILE_FAILED',
        finishedAt: expect.any(String) as unknown,
        status: 'failed',
      }),
    );
  });

  it('treats expired upload transfers as stale reconciliation candidates', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({
      id: 'blobrec-3',
      status: 'running',
    });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-3', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: null,
        objectKey: 'uploads/expired.bin',
        status: 'expired',
        transferId: 'transfer-expired',
        updatedAt: new Date().toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/expired.bin']);

    await service.reconcileObjects(
      { cleanup: false, workspaceId: 'workspace-default' },
      'admin-c',
    );

    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-3',
      expect.objectContaining({
        staleUploads: [
          {
            objectKey: 'uploads/expired.bin',
            reason: 'stale-upload',
            transferId: 'transfer-expired',
            workspaceId: 'workspace-default',
          },
        ],
      }),
    );
  });

  it('does not clean upload-session staging during a dry run', async () => {
    const {
      objectStorage,
      createReconcileTask,
      isUploadSessionCleanupProtected,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-dry-run' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-dry-run', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: new Date(0).toISOString(),
        objectKey: 'uploads/dry-run.bin',
        status: 'expired',
        transferId: 'transfer-dry-run',
        uploadSessionId: 'session-dry-run',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(),
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-dry-run',
        updatedAt: new Date(0).toISOString(),
        uploadSessionId: 'session-dry-run',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    const deleteUploadSessionParts = jest
      .spyOn(objectStorage, 'deleteUploadSessionParts')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: false, workspaceId: 'workspace-default' },
      'admin-dry-run',
    );

    expect(isUploadSessionCleanupProtected).not.toHaveBeenCalled();
    expect(deleteUploadSessionParts).not.toHaveBeenCalled();
  });

  it('keeps staging for an upload session protected by a fresh claim', async () => {
    const {
      objectStorage,
      createReconcileTask,
      isUploadSessionCleanupProtected,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-active-claim' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-active-claim', ...input }),
    );
    isUploadSessionCleanupProtected.mockResolvedValue(true);
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: new Date(0).toISOString(),
        objectKey: 'uploads/active-claim.bin',
        status: 'expired',
        transferId: 'transfer-active-claim',
        uploadSessionId: 'session-active-claim',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(),
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-active-claim',
        updatedAt: new Date(0).toISOString(),
        uploadSessionId: 'session-active-claim',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    const deleteUploadSessionParts = jest
      .spyOn(objectStorage, 'deleteUploadSessionParts')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-active-claim',
    );

    expect(isUploadSessionCleanupProtected).toHaveBeenCalledWith(
      expect.objectContaining({
        completionClaimStaleBefore: expect.any(Date) as unknown,
        now: expect.any(Date) as unknown,
        staleBefore: expect.any(Date) as unknown,
        transferId: 'transfer-active-claim',
        uploadSessionId: 'session-active-claim',
      }),
    );
    expect(deleteUploadSessionParts).not.toHaveBeenCalled();
  });

  it('best-effort cleans stale session staging without failing reconciliation', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-staging-cleanup' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-staging-cleanup', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: new Date(0).toISOString(),
        objectKey: 'uploads/stale-staging.bin',
        status: 'expired',
        transferId: 'transfer-stale-staging',
        uploadSessionId: 'session-stale-staging',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(),
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-stale-staging',
        updatedAt: new Date(0).toISOString(),
        uploadSessionId: 'session-stale-staging',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    const deleteUploadSessionParts = jest
      .spyOn(objectStorage, 'deleteUploadSessionParts')
      .mockRejectedValue(new Error('staging cleanup failed'));

    await expect(
      service.reconcileObjects(
        { cleanup: true, workspaceId: 'workspace-default' },
        'admin-staging-cleanup',
      ),
    ).resolves.toMatchObject({ status: 'completed' });

    expect(deleteUploadSessionParts).toHaveBeenCalledWith(
      'session-stale-staging',
    );
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-staging-cleanup',
      expect.objectContaining({ failureCode: null, status: 'completed' }),
    );
  });

  it('aborts stale unfinalized multipart uploads during reconciliation', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-multipart-cleanup' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-multipart-cleanup', ...input }),
    );
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(),
        multipartUploadId: 'multipart-stale',
        objectKey: 'uploads/stale-multipart.bin',
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-stale-multipart',
        updatedAt: new Date(0).toISOString(),
        uploadSessionId: 'session-stale-multipart',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    const abortMultipartUpload = jest
      .spyOn(objectStorage, 'abortMultipartUpload')
      .mockResolvedValue();
    const deleteUploadSessionParts = jest.spyOn(
      objectStorage,
      'deleteUploadSessionParts',
    );

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-multipart-cleanup',
    );

    expect(abortMultipartUpload).toHaveBeenCalledWith({
      objectKey: 'uploads/stale-multipart.bin',
      uploadId: 'multipart-stale',
    });
    expect(deleteUploadSessionParts).not.toHaveBeenCalled();
  });

  it('fails reconciliation when multipart cleanup cannot be confirmed', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({
      id: 'blobrec-multipart-cleanup-failed',
    });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-multipart-cleanup-failed', ...input }),
    );
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(),
        multipartUploadId: 'multipart-stale',
        objectKey: 'uploads/stale-multipart.bin',
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-stale-multipart',
        updatedAt: new Date(0).toISOString(),
        uploadSessionId: 'session-stale-multipart',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    jest
      .spyOn(objectStorage, 'abortMultipartUpload')
      .mockRejectedValue(new Error('multipart cleanup failed'));

    await expect(
      service.reconcileObjects(
        { cleanup: true, workspaceId: 'workspace-default' },
        'admin-multipart-cleanup',
      ),
    ).rejects.toThrow('multipart cleanup failed');
    expect(updateReconcileTask).toHaveBeenLastCalledWith(
      'blobrec-multipart-cleanup-failed',
      expect.objectContaining({
        failureCode: 'STORAGE_RECONCILE_FAILED',
        status: 'failed',
      }),
    );
  });

  it('cleans every stale session even when their transfer is missing', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-orphan-sessions' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-orphan-sessions', ...input }),
    );
    const oldCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: oldCreatedAt.toISOString(),
        expiresAt: new Date(0).toISOString(),
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-deleted',
        updatedAt: oldCreatedAt.toISOString(),
        uploadSessionId: 'session-expired',
      },
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: oldCreatedAt.toISOString(),
        expiresAt: null,
        status: 'running',
        storageFinalizedAt: null,
        transferId: 'transfer-deleted',
        updatedAt: oldCreatedAt.toISOString(),
        uploadSessionId: 'session-legacy-expired',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    const deleteUploadSessionParts = jest
      .spyOn(objectStorage, 'deleteUploadSessionParts')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-orphan-sessions',
    );

    expect(deleteUploadSessionParts).toHaveBeenCalledTimes(2);
    expect(deleteUploadSessionParts).toHaveBeenCalledWith('session-expired');
    expect(deleteUploadSessionParts).toHaveBeenCalledWith(
      'session-legacy-expired',
    );
  });

  it('keeps legacy session staging until the shared 24-hour deadline', async () => {
    const {
      objectStorage,
      createReconcileTask,
      isUploadSessionCleanupProtected,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-legacy-session' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-legacy-session', ...input }),
    );
    const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    (
      reconcileRepository.listUploadSessionCleanupReferences as jest.Mock
    ).mockResolvedValue([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: createdAt.toISOString(),
        expiresAt: null,
        status: 'running',
        storageFinalizedAt: null,
        transferId: 'transfer-legacy-session',
        updatedAt: createdAt.toISOString(),
        uploadSessionId: 'session-legacy-session',
      },
    ]);
    jest.spyOn(objectStorage, 'listObjectKeys').mockResolvedValue([]);
    const deleteUploadSessionParts = jest
      .spyOn(objectStorage, 'deleteUploadSessionParts')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-legacy-session',
    );

    expect(isUploadSessionCleanupProtected).not.toHaveBeenCalled();
    expect(deleteUploadSessionParts).not.toHaveBeenCalled();
  });

  it('protects paused transfers until their fixed expiry elapses', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-4' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-4', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        objectKey: 'uploads/paused.bin',
        status: 'paused',
        transferId: 'transfer-paused',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/paused.bin']);
    const deleteObject = jest
      .spyOn(objectStorage, 'deleteObject')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-d',
    );

    expect(deleteObject).not.toHaveBeenCalled();
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-4',
      expect.objectContaining({ staleUploads: [] }),
    );
  });

  it('never deletes an object key still protected by an active transfer', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-5' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-5', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: null,
        objectKey: 'uploads/shared.bin',
        status: 'failed',
        transferId: 'transfer-failed',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
      {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        objectKey: 'uploads/shared.bin',
        status: 'running',
        transferId: 'transfer-active',
        updatedAt: new Date().toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/shared.bin']);
    const deleteObject = jest
      .spyOn(objectStorage, 'deleteObject')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-e',
    );

    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('fails safe instead of deleting objects owned by unknown transfer states', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-unknown' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-unknown', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: null,
        objectKey: 'uploads/future-state.bin',
        status: 'future-state',
        transferId: 'transfer-future',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/future-state.bin']);
    const deleteObject = jest
      .spyOn(objectStorage, 'deleteObject')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-unknown',
    );

    expect(deleteObject).not.toHaveBeenCalled();
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-unknown',
      expect.objectContaining({ staleUploads: [] }),
    );
  });

  it('releases stale queued uploads that have no legacy expiry', async () => {
    const {
      objectStorage,
      createReconcileTask,
      reconcileRepository,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-legacy' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-legacy', ...input }),
    );
    (
      reconcileRepository.listUploadTransferObjectReferences as jest.Mock
    ).mockResolvedValue([
      {
        expiresAt: null,
        objectKey: 'uploads/legacy-queued.bin',
        status: 'queued',
        transferId: 'transfer-legacy',
        updatedAt: new Date(0).toISOString(),
        workspaceId: 'workspace-default',
      },
    ]);
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/legacy-queued.bin']);
    const deleteObject = jest
      .spyOn(objectStorage, 'deleteObject')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-legacy',
    );

    expect(deleteObject).toHaveBeenCalledWith('uploads/legacy-queued.bin');
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-legacy',
      expect.objectContaining({
        staleUploads: [
          expect.objectContaining({ transferId: 'transfer-legacy' }),
        ],
      }),
    );
  });

  it('skips deletion when the final database recheck finds a new reference', async () => {
    const {
      objectStorage,
      createReconcileTask,
      isObjectKeyProtected,
      service,
      updateReconcileTask,
    } = createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-race' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-race', ...input }),
    );
    isObjectKeyProtected.mockResolvedValue(true);
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/finalizing.bin']);
    const deleteObject = jest
      .spyOn(objectStorage, 'deleteObject')
      .mockResolvedValue();

    await service.reconcileObjects(
      { cleanup: true, workspaceId: 'workspace-default' },
      'admin-race',
    );

    expect(isObjectKeyProtected).toHaveBeenCalledWith(
      expect.objectContaining({
        completionClaimStaleBefore: expect.any(Date) as unknown,
        now: expect.any(Date) as unknown,
        objectKey: 'uploads/finalizing.bin',
        staleBefore: expect.any(Date) as unknown,
      }),
    );
    expect(deleteObject).not.toHaveBeenCalled();
    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-race',
      expect.objectContaining({
        deletedObjects: [],
        summary: expect.objectContaining({ deletedObjects: 0 }) as unknown,
      }),
    );
  });

  it('persists partial cleanup results when a later deletion fails', async () => {
    const { createReconcileTask, objectStorage, service, updateReconcileTask } =
      createStorageTestContext();
    createReconcileTask.mockResolvedValue({ id: 'blobrec-6' });
    updateReconcileTask.mockImplementation(
      (_id: string, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'blobrec-6', ...input }),
    );
    jest
      .spyOn(objectStorage, 'listObjectKeys')
      .mockResolvedValue(['uploads/orphan-a.bin', 'uploads/orphan-b.bin']);
    jest
      .spyOn(objectStorage, 'deleteObject')
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('delete failed'));

    await expect(
      service.reconcileObjects(
        { cleanup: true, workspaceId: 'workspace-default' },
        'admin-f',
      ),
    ).rejects.toThrow('delete failed');

    expect(updateReconcileTask).toHaveBeenCalledWith(
      'blobrec-6',
      expect.objectContaining({
        deletedObjects: ['uploads/orphan-a.bin'],
        failureCode: 'STORAGE_RECONCILE_FAILED',
        status: 'failed',
        summary: expect.objectContaining({ deletedObjects: 1 }) as unknown,
      }),
    );
  });
});
