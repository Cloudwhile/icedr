import { PrismaService } from '../../database/prisma.service';
import type { BlobReconcileTaskResponse } from './storage-reconcile.dto';
import { StorageReconcileRepository } from './storage-reconcile.repository';

describe('StorageReconcileRepository', () => {
  const startedAt = new Date('2026-07-18T01:00:00.000Z');
  const finishedAt = new Date('2026-07-18T01:01:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  function taskRow(overrides: Record<string, unknown> = {}) {
    return {
      actorUserId: 'admin-a',
      cleanup: false,
      deletedObjects: [],
      failureCode: null,
      finishedAt: startedAt,
      id: 'blobrec-1',
      missingObjects: [],
      orphanObjects: [],
      staleUploadMinutes: 60,
      staleUploads: [],
      startedAt,
      status: 'running',
      summary: {},
      workspaceId: 'workspace-default',
      ...overrides,
    };
  }

  function createRepository() {
    const create = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve(taskRow(args.data)),
    );
    const update = jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve(taskRow(args.data)),
    );
    const updateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const prisma = {
      blobReconcileTask: {
        create,
        findMany: jest.fn(() => Promise.resolve([])),
        update,
        updateMany,
      },
    } as unknown as PrismaService;

    return {
      create,
      repository: new StorageReconcileRepository(prisma),
      update,
      updateMany,
    };
  }

  it('loads raw preview states so the policy can fail safe on unknown values', async () => {
    const now = new Date('2026-07-18T02:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const previewArtifactFindMany = jest.fn(() =>
      Promise.resolve([
        {
          expiresAt: null,
          nodeId: 'node-unknown',
          previewObjectKey: 'previews/unknown.bin',
          status: 'future-state',
          updatedAt: new Date(0),
        },
      ]),
    );
    const prisma = {
      fileNode: {
        findMany: jest.fn(() =>
          Promise.resolve([
            { id: 'node-unknown', workspaceId: 'workspace-default' },
          ]),
        ),
      },
      fileVersion: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      previewArtifact: {
        findMany: previewArtifactFindMany,
      },
    } as unknown as PrismaService;
    const repository = new StorageReconcileRepository(prisma);

    await expect(
      repository.listFileObjectReferences('workspace-default'),
    ).resolves.toContainEqual({
      nodeId: 'node-unknown',
      objectKey: 'previews/unknown.bin',
      workspaceId: 'workspace-default',
    });

    expect(previewArtifactFindMany).toHaveBeenCalledWith({
      where: {
        previewObjectKey: { not: null },
      },
      select: {
        expiresAt: true,
        nodeId: true,
        previewObjectKey: true,
        status: true,
        updatedAt: true,
      },
    });
  });

  it('protects retained file version objects in the requested workspace', async () => {
    const fileVersionFindMany = jest.fn(() =>
      Promise.resolve([
        {
          nodeId: 'node-1',
          objectKey: 'workspaces/workspace-default/versions/version-1.blob',
          node: { workspaceId: 'workspace-default' },
        },
      ]),
    );
    const prisma = {
      fileNode: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      fileVersion: {
        findMany: fileVersionFindMany,
      },
      previewArtifact: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
    } as unknown as PrismaService;
    const repository = new StorageReconcileRepository(prisma);

    await expect(
      repository.listFileObjectReferences('workspace-default'),
    ).resolves.toContainEqual({
      nodeId: 'node-1',
      objectKey: 'workspaces/workspace-default/versions/version-1.blob',
      workspaceId: 'workspace-default',
    });
    expect(fileVersionFindMany).toHaveBeenCalledWith({
      where: { node: { workspaceId: 'workspace-default' } },
      select: {
        nodeId: true,
        objectKey: true,
        node: { select: { workspaceId: true } },
      },
    });
  });

  it('lists every upload session independently of transfer retention', async () => {
    const uploadSessionFindMany = jest.fn(() =>
      Promise.resolve([
        {
          completionStartedAt: null,
          completionToken: null,
          createdAt: new Date('2026-07-18T01:00:00.000Z'),
          expiresAt: new Date('2026-07-19T01:00:00.000Z'),
          id: 'upload-session-a',
          multipartUploadId: 'multipart-a',
          objectKey: 'uploads/a.bin',
          status: 'running',
          storageFinalizedAt: null,
          transferId: 'transfer-deleted',
          updatedAt: new Date('2026-07-18T02:00:00.000Z'),
        },
        {
          completionStartedAt: null,
          completionToken: null,
          createdAt: new Date('2026-07-17T01:00:00.000Z'),
          expiresAt: null,
          id: 'upload-session-b',
          multipartUploadId: null,
          objectKey: 'uploads/b.bin',
          status: 'failed',
          storageFinalizedAt: null,
          transferId: 'transfer-deleted',
          updatedAt: new Date('2026-07-17T02:00:00.000Z'),
        },
      ]),
    );
    const repository = new StorageReconcileRepository({
      uploadSession: { findMany: uploadSessionFindMany },
    } as never);

    await expect(
      repository.listUploadSessionCleanupReferences('workspace-default'),
    ).resolves.toEqual([
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: '2026-07-18T01:00:00.000Z',
        expiresAt: '2026-07-19T01:00:00.000Z',
        multipartUploadId: 'multipart-a',
        objectKey: 'uploads/a.bin',
        status: 'running',
        storageFinalizedAt: null,
        transferId: 'transfer-deleted',
        updatedAt: '2026-07-18T02:00:00.000Z',
        uploadSessionId: 'upload-session-a',
      },
      {
        completionStartedAt: null,
        completionToken: null,
        createdAt: '2026-07-17T01:00:00.000Z',
        expiresAt: null,
        multipartUploadId: null,
        objectKey: 'uploads/b.bin',
        status: 'failed',
        storageFinalizedAt: null,
        transferId: 'transfer-deleted',
        updatedAt: '2026-07-17T02:00:00.000Z',
        uploadSessionId: 'upload-session-b',
      },
    ]);
    expect(uploadSessionFindMany).toHaveBeenCalledWith({
      select: {
        completionStartedAt: true,
        completionToken: true,
        createdAt: true,
        expiresAt: true,
        id: true,
        multipartUploadId: true,
        objectKey: true,
        status: true,
        storageFinalizedAt: true,
        transferId: true,
        updatedAt: true,
      },
      where: { workspaceId: 'workspace-default' },
    });
  });

  it('protects active completion staging and releases expired staging', async () => {
    const now = new Date('2026-07-18T02:00:00.000Z');
    const inactiveTransfer = {
      expiresAt: new Date('2026-07-18T01:00:00.000Z'),
      status: 'expired',
      updatedAt: new Date('2026-07-18T01:00:00.000Z'),
    };
    const transferFindUnique = jest
      .fn()
      .mockResolvedValueOnce(inactiveTransfer)
      .mockResolvedValueOnce(inactiveTransfer)
      .mockResolvedValueOnce(null);
    const uploadSessionFindUnique = jest
      .fn()
      .mockResolvedValueOnce({
        completionStartedAt: new Date('2026-07-18T01:59:00.000Z'),
        completionToken: 'completion-active',
        expiresAt: new Date('2026-07-18T03:00:00.000Z'),
        status: 'running',
        storageFinalizedAt: null,
        transferId: 'transfer-cleanup',
        updatedAt: new Date('2026-07-18T01:59:00.000Z'),
      })
      .mockResolvedValueOnce({
        completionStartedAt: new Date('2026-07-18T01:00:00.000Z'),
        completionToken: 'completion-stale',
        expiresAt: new Date('2026-07-18T01:30:00.000Z'),
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-cleanup',
        updatedAt: new Date('2026-07-18T01:30:00.000Z'),
      })
      .mockResolvedValueOnce({
        completionStartedAt: null,
        completionToken: null,
        createdAt: new Date('2026-07-17T00:00:00.000Z'),
        expiresAt: new Date('2026-07-18T01:30:00.000Z'),
        status: 'expired',
        storageFinalizedAt: null,
        transferId: 'transfer-cleanup',
        updatedAt: new Date('2026-07-18T01:30:00.000Z'),
      });
    const repository = new StorageReconcileRepository({
      transferTask: { findUnique: transferFindUnique },
      uploadSession: { findUnique: uploadSessionFindUnique },
    } as never);
    const input = {
      completionClaimStaleBefore: new Date('2026-07-18T01:45:00.000Z'),
      now,
      staleBefore: new Date('2026-07-18T01:00:00.000Z'),
      transferId: 'transfer-cleanup',
      uploadSessionId: 'session-cleanup',
    };

    await expect(
      repository.isUploadSessionCleanupProtected(input),
    ).resolves.toBe(true);
    await expect(
      repository.isUploadSessionCleanupProtected(input),
    ).resolves.toBe(false);
    await expect(
      repository.isUploadSessionCleanupProtected(input),
    ).resolves.toBe(false);
  });

  it('creates a running task owned by the actor and exposes a unified lifecycle', async () => {
    const { create, repository } = createRepository();

    const result = await repository.createTask({
      actorUserId: 'admin-a',
      cleanup: false,
      staleUploadMinutes: 60,
      startedAt: startedAt.toISOString(),
      status: 'running',
      workspaceId: 'workspace-default',
    } as never);

    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'admin-a',
        cleanup: false,
        deletedObjects: [],
        failureCode: null,
        finishedAt: startedAt,
        id: expect.stringMatching(/^blobrec_/) as unknown,
        missingObjects: [],
        orphanObjects: [],
        staleUploadMinutes: 60,
        staleUploads: [],
        startedAt,
        status: 'running',
        summary: {
          deletedObjects: 0,
          missingObjects: 0,
          orphanObjects: 0,
          referencedObjects: 0,
          staleUploads: 0,
          storageObjects: 0,
        },
        workspaceId: 'workspace-default',
      },
    });
    expect(result).toMatchObject({
      actorUserId: 'admin-a',
      finishedAt: null,
      lifecycle: {
        createdAt: startedAt.toISOString(),
        errorCode: null,
        errorMessage: null,
        expiresAt: null,
        retryable: false,
        status: 'running',
        updatedAt: startedAt.toISOString(),
      },
      startedAt: startedAt.toISOString(),
      status: 'running',
    });
  });

  it('recovers stale running tasks as failed', async () => {
    const { repository, updateMany } = createRepository();
    const staleBefore = new Date('2026-07-17T01:00:00.000Z');

    await expect(
      repository.recoverStaleRunningTasks(staleBefore, finishedAt),
    ).resolves.toBe(0);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        startedAt: { lte: staleBefore },
        status: 'running',
      },
      data: {
        failureCode: 'STORAGE_RECONCILE_FAILED',
        finishedAt,
        status: 'failed',
      },
    });
  });

  it('repairs stale running tasks before returning task history', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T02:00:00.000Z'));
    const { repository, updateMany } = createRepository();

    await expect(repository.listTasks()).resolves.toEqual([]);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          startedAt: { lte: new Date('2026-07-18T02:00:00.000Z') },
          status: 'running',
        },
      }),
    );
  });

  it('rechecks every database reference before destructive cleanup', async () => {
    const fileNodeFindFirst = jest.fn(() => Promise.resolve(null));
    const fileVersionFindFirst = jest.fn(() => Promise.resolve(null));
    const previewFindMany = jest.fn(() => Promise.resolve([]));
    const transferFindMany = jest.fn(() => Promise.resolve([]));
    const uploadSessionFindMany = jest.fn(() =>
      Promise.resolve([
        {
          completionStartedAt: new Date('2026-07-18T01:59:00.000Z'),
          completionToken: 'completion-token',
          expiresAt: new Date('2026-07-18T03:00:00.000Z'),
          status: 'running',
          storageFinalizedAt: new Date('2026-07-18T01:59:30.000Z'),
          updatedAt: new Date('2026-07-18T01:59:30.000Z'),
        },
      ]),
    );
    const prisma = {
      fileNode: { findFirst: fileNodeFindFirst },
      fileVersion: { findFirst: fileVersionFindFirst },
      previewArtifact: { findMany: previewFindMany },
      transferTask: { findMany: transferFindMany },
      uploadSession: { findMany: uploadSessionFindMany },
    } as unknown as PrismaService;
    const repository = new StorageReconcileRepository(prisma);

    await expect(
      repository.isObjectKeyProtected({
        completionClaimStaleBefore: new Date('2026-07-18T01:45:00.000Z'),
        now: new Date('2026-07-18T02:00:00.000Z'),
        objectKey: 'uploads/finalizing.bin',
        staleBefore: new Date('2026-07-18T01:00:00.000Z'),
      }),
    ).resolves.toBe(true);

    expect(fileNodeFindFirst).toHaveBeenCalledWith({
      where: { objectKey: 'uploads/finalizing.bin' },
      select: { id: true },
    });
    expect(fileVersionFindFirst).toHaveBeenCalledWith({
      where: { objectKey: 'uploads/finalizing.bin' },
      select: { id: true },
    });
    expect(previewFindMany).toHaveBeenCalled();
    expect(transferFindMany).toHaveBeenCalled();
    expect(uploadSessionFindMany).toHaveBeenCalled();
  });

  it('does not let an expired completed preview permanently protect source or preview objects', async () => {
    const previewFindMany = jest.fn(() =>
      Promise.resolve([
        {
          expiresAt: new Date('2026-07-18T02:00:00.000Z'),
          status: 'completed',
          updatedAt: new Date('2026-07-18T01:59:00.000Z'),
        },
      ]),
    );
    const prisma = {
      fileNode: { findFirst: jest.fn(() => Promise.resolve(null)) },
      fileVersion: { findFirst: jest.fn(() => Promise.resolve(null)) },
      previewArtifact: { findMany: previewFindMany },
      transferTask: { findMany: jest.fn(() => Promise.resolve([])) },
      uploadSession: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;
    const repository = new StorageReconcileRepository(prisma);

    await expect(
      repository.isObjectKeyProtected({
        completionClaimStaleBefore: new Date('2026-07-18T01:45:00.000Z'),
        now: new Date('2026-07-18T02:00:00.000Z'),
        objectKey: 'previews/expired.bin',
        staleBefore: new Date('2026-07-18T01:00:00.000Z'),
      }),
    ).resolves.toBe(false);

    expect(previewFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { previewObjectKey: 'previews/expired.bin' },
          { sourceObjectKey: 'previews/expired.bin' },
        ],
      },
      select: {
        expiresAt: true,
        status: true,
        updatedAt: true,
      },
    });
  });

  it('transitions a running task to completed with result details', async () => {
    const { repository, update } = createRepository();
    const updateTask = (
      repository as unknown as {
        updateTask: (
          id: string,
          input: Record<string, unknown>,
        ) => Promise<BlobReconcileTaskResponse>;
      }
    ).updateTask.bind(repository);

    const result = await updateTask('blobrec-1', {
      deletedObjects: [],
      failureCode: null,
      finishedAt: finishedAt.toISOString(),
      missingObjects: [],
      orphanObjects: [],
      staleUploads: [],
      status: 'completed',
      summary: {
        deletedObjects: 0,
        missingObjects: 0,
        orphanObjects: 0,
        referencedObjects: 0,
        staleUploads: 0,
        storageObjects: 0,
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: null,
          finishedAt,
          status: 'completed',
        }) as unknown,
        where: { id: 'blobrec-1', status: 'running' },
      }),
    );
    expect(result).toMatchObject({
      finishedAt: finishedAt.toISOString(),
      lifecycle: {
        createdAt: startedAt.toISOString(),
        errorCode: null,
        errorMessage: null,
        expiresAt: null,
        retryable: false,
        status: 'completed',
        updatedAt: finishedAt.toISOString(),
      },
      status: 'completed',
    });
  });

  it('maps a failed task failure code into a retryable lifecycle', async () => {
    const { repository } = createRepository();
    const updateTask = (
      repository as unknown as {
        updateTask: (
          id: string,
          input: Record<string, unknown>,
        ) => Promise<BlobReconcileTaskResponse>;
      }
    ).updateTask.bind(repository);

    const result = await updateTask('blobrec-1', {
      deletedObjects: ['uploads/deleted.bin'],
      failureCode: 'STORAGE_RECONCILE_FAILED',
      finishedAt: finishedAt.toISOString(),
      missingObjects: [],
      orphanObjects: [],
      staleUploads: [],
      status: 'failed',
      summary: {
        deletedObjects: 1,
        missingObjects: 0,
        orphanObjects: 0,
        referencedObjects: 0,
        staleUploads: 0,
        storageObjects: 1,
      },
    });

    expect(result).toMatchObject({
      finishedAt: finishedAt.toISOString(),
      lifecycle: {
        createdAt: startedAt.toISOString(),
        errorCode: 'STORAGE_RECONCILE_FAILED',
        errorMessage: null,
        expiresAt: null,
        retryable: true,
        status: 'failed',
        updatedAt: finishedAt.toISOString(),
      },
      status: 'failed',
      deletedObjects: ['uploads/deleted.bin'],
    });
  });
});
