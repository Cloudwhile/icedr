import { ConflictException } from '@nestjs/common';
import { serializableTransactionMaxAttempts } from '../../common/database/serializable-transaction-retry';
import { createFileNodesRepository as createRepository } from './file-nodes.repository.spec-helpers';

function storedNode(id: string) {
  return {
    id,
    workspaceId: 'workspace-default',
    spaceScope: 'workspace',
    parentNodeId: null,
    directoryKey: '',
    ownerScopeKey: '',
    name: `${id}.txt`,
    nameKey: `active:${id}.txt`,
    kind: 'doc',
    mimeType: 'text/plain',
    sizeBytes: 1n,
    objectKey: `objects/${id}`,
    checksumAlgorithm: 'sha256',
    checksumValue: 'a'.repeat(64),
    integrityStatus: 'verified',
    lastVerifiedAt: new Date(1),
    verificationFailureCode: null,
    ownerName: 'Workspace User',
    ownerUserId: null,
    starred: false,
    archivedAt: null,
    archivedBy: null,
    originalParentNodeId: null,
    originalPath: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('FileNodesRepository upload completion', () => {
  it('persists canonical name keys when completing a new upload', async () => {
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        archivedBy: null,
        originalParentNodeId: null,
        originalPath: null,
      }),
    );
    const tx = {
      fileNode: {
        create,
        findUnique: jest.fn(() =>
          Promise.resolve({
            ...storedNode('folder-1'),
            kind: 'folder',
            objectKey: null,
            sizeBytes: null,
            spaceScope: 'personal',
          }),
        ),
      },
    };
    const enqueueObjectVerification = jest.fn(() =>
      Promise.resolve('task-test'),
    );
    const kickQueued = jest.fn();
    const repository = createRepository(
      {
        $transaction: jest.fn(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
      },
      { enqueueObjectVerification, kickQueued },
    );

    await repository.completeUpload({
      fileName: 'Resume.pdf',
      mimeType: 'application/pdf',
      objectKey: 'objects/original/v2/2026/07/test.blob',
      ownerUserId: 'user-1',
      parentNodeId: 'folder-1',
      sizeBytes: 32,
      spaceScope: 'personal',
      workspaceId: 'workspace-default',
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        checksumAlgorithm: null,
        checksumValue: null,
        directoryKey: 'folder-1',
        integrityStatus: 'pending',
        lastVerifiedAt: null,
        nameKey: 'active:resume.pdf',
        ownerScopeKey: 'user-1',
        verificationFailureCode: null,
      },
    });
    expect(enqueueObjectVerification).toHaveBeenCalledWith(
      {
        actorUserId: 'user-1',
        nodeId: expect.any(String) as unknown,
        objectKey: 'objects/original/v2/2026/07/test.blob',
        workspaceId: 'workspace-default',
      },
      tx,
    );
    expect(kickQueued).toHaveBeenCalledTimes(1);
  });

  it('pins verification for a pending object archived by a version upload', async () => {
    const target = {
      ...storedNode('node-pending-upload'),
      checksumAlgorithm: null,
      checksumValue: null,
      integrityStatus: 'pending',
      lastVerifiedAt: null,
    };
    const createVersion = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    const tx = {
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(target)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...target, ...data }),
        ),
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: null } }),
        ),
        create: createVersion,
      },
    };
    const enqueueObjectVerification = jest.fn(() =>
      Promise.resolve('task-test'),
    );
    const kickQueued = jest.fn();
    const repository = createRepository(
      {
        $transaction: jest.fn(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
      },
      { enqueueObjectVerification, kickQueued },
    );

    await repository.completeUpload({
      conflictStrategy: 'version',
      conflictTargetNodeId: target.id,
      fileName: target.name,
      objectKey: 'objects/uploaded-replacement',
      requestedFileName: target.name,
      sizeBytes: 32,
      workspaceId: target.workspaceId,
    });

    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      1,
      {
        actorUserId: null,
        nodeId: target.id,
        objectKey: target.objectKey,
        versionId: expect.any(String) as unknown,
        workspaceId: target.workspaceId,
      },
      tx,
    );
    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      2,
      {
        actorUserId: null,
        nodeId: target.id,
        objectKey: 'objects/uploaded-replacement',
        workspaceId: target.workspaceId,
      },
      tx,
    );
    expect(kickQueued).toHaveBeenCalledTimes(1);
  });

  it('persists the file node and completion claim in one transaction', async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        archivedBy: null,
        originalParentNodeId: null,
        originalPath: null,
      }),
    );
    const tx = {
      fileNode: { create },
      uploadSession: { updateMany },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    const completed = await repository.completeUpload(
      {
        fileName: 'Atomic.pdf',
        mimeType: 'application/pdf',
        objectKey: 'objects/original/v2/2026/07/atomic.blob',
        sizeBytes: 32,
        workspaceId: 'workspace-default',
      },
      {
        sessionId: 'upload-session-1',
        completionToken: 'completion-token',
      },
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'upload-session-1',
        status: 'running',
        completionToken: 'completion-token',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) as unknown } },
        ],
      },
      data: {
        nodeId: completed.node.id,
        fileName: 'Atomic.pdf',
        completionStartedAt: expect.any(Date) as unknown,
        updatedAt: expect.any(Date) as unknown,
      },
    });
  });

  it('rejects a file-node write when its completion claim was superseded', async () => {
    const tx = {
      fileNode: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...data,
            archivedBy: null,
            originalParentNodeId: null,
            originalPath: null,
          }),
        ),
      },
      uploadSession: {
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.completeUpload(
        {
          fileName: 'Atomic.pdf',
          objectKey: 'objects/original/v2/2026/07/atomic.blob',
          sizeBytes: 32,
          workspaceId: 'workspace-default',
        },
        {
          sessionId: 'upload-session-1',
          completionToken: 'stale-token',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an upload target that changed after the upload session started', async () => {
    const create = jest.fn();
    const update = jest.fn();
    const findUnique = jest.fn((input: { where: Record<string, unknown> }) => {
      return Promise.resolve(
        input.where.id === 'folder-1'
          ? {
              ...storedNode('folder-1'),
              kind: 'folder',
              objectKey: null,
              sizeBytes: null,
            }
          : null,
      );
    });
    const tx = {
      fileNode: {
        create,
        findUnique,
        update,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.completeUpload({
        conflictStrategy: 'overwrite',
        conflictTargetNodeId: 'node-1',
        fileName: 'Report.pdf',
        mimeType: 'application/pdf',
        objectKey: 'objects/original/v2/2026/07/test.blob',
        parentNodeId: 'folder-1',
        sizeBytes: 32,
        spaceScope: 'workspace',
        workspaceId: 'workspace-default',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'node-1' } });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrent same-name insert without a target', async () => {
    const databaseError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'file_nodes_scope_directory_name_key' },
    });
    const existing = {
      archivedAt: null,
      id: 'concurrent-node',
      name: 'Report.pdf',
      objectKey: 'existing-object',
      ownerName: 'Workspace User',
      ownerUserId: null,
      parentNodeId: null,
      spaceScope: 'workspace',
      workspaceId: 'workspace-default',
    };
    const create = jest.fn(() => Promise.reject(databaseError));
    const update = jest.fn(() => Promise.resolve(existing));
    const tx = {
      fileNode: {
        create,
        update,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.completeUpload({
        conflictStrategy: 'overwrite',
        fileName: 'Report.pdf',
        objectKey: 'new-object',
        sizeBytes: 32,
        workspaceId: 'workspace-default',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['overwrite', 'version'] as const)(
    'does not rebind a deleted %s target to a concurrent same-name node',
    async (conflictStrategy) => {
      const concurrentNode = {
        ...storedNode('node-b'),
        name: 'Report.pdf',
        nameKey: 'active:report.pdf',
        objectKey: 'object-b',
      };
      const update = jest.fn();
      const tx = {
        fileNode: {
          create: jest.fn(),
          findUnique: jest.fn(() => Promise.resolve(null)),
          update,
        },
        fileVersion: {
          aggregate: jest.fn(),
          create: jest.fn(),
        },
      };
      const repository = createRepository({
        fileNode: {
          findMany: jest.fn(() => Promise.resolve([concurrentNode])),
        },
        $transaction: jest.fn(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
      });

      await expect(
        repository.completeUpload({
          conflictStrategy,
          conflictTargetNodeId: 'node-a',
          conflictTargetObjectKey: 'object-a',
          fileName: 'Report.pdf',
          objectKey: 'new-object',
          requestedFileName: 'Report.pdf',
          sizeBytes: 32,
          workspaceId: 'workspace-default',
        }),
      ).rejects.toMatchObject({
        response: { code: 'UPLOAD_CONFLICT_TARGET_CHANGED' },
      });
      expect(update).not.toHaveBeenCalled();
      expect(tx.fileVersion.create).not.toHaveBeenCalled();
    },
  );

  it('rejects overwrite when the pinned target object changed', async () => {
    const target = {
      ...storedNode('node-a'),
      name: 'Report.pdf',
      nameKey: 'active:report.pdf',
      objectKey: 'newer-object',
    };
    const update = jest.fn();
    const tx = {
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(target)),
        update,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.completeUpload({
        conflictStrategy: 'overwrite',
        conflictTargetNodeId: target.id,
        conflictTargetObjectKey: 'intent-object',
        fileName: target.name,
        objectKey: 'uploaded-object',
        sizeBytes: 32,
        workspaceId: target.workspaceId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'UPLOAD_CONFLICT_TARGET_CHANGED' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns the exact object displaced by overwrite', async () => {
    const target = {
      ...storedNode('node-a'),
      name: 'Report.pdf',
      nameKey: 'active:report.pdf',
      objectKey: 'intent-object',
    };
    const tx = {
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(target)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...target, ...data }),
        ),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    const completed = await repository.completeUpload({
      conflictStrategy: 'overwrite',
      conflictTargetNodeId: target.id,
      conflictTargetObjectKey: target.objectKey ?? undefined,
      fileName: target.name,
      objectKey: 'uploaded-object',
      sizeBytes: 32,
      workspaceId: target.workspaceId,
    });

    expect(completed.displacedObjectKey).toBe('intent-object');
    expect(completed.node.objectKey).toBe('uploaded-object');
  });

  it('recomputes a rename from the requested name after a name collision', async () => {
    const nameConflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'file_nodes_scope_directory_name_key' },
    });
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ name: 'Report.pdf' }])
      .mockResolvedValueOnce([
        { name: 'Report.pdf' },
        { name: 'Report (2).pdf' },
      ]);
    const create = jest
      .fn<
        Promise<Record<string, unknown>>,
        [
          {
            data: Record<string, unknown> & { name: string };
          },
        ]
      >()
      .mockRejectedValueOnce(nameConflict)
      .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...data,
          archivedBy: null,
          originalParentNodeId: null,
          originalPath: null,
        }),
      );
    const updateMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const tx = {
      fileNode: {
        create,
        findMany,
        findUnique: jest.fn(() =>
          Promise.resolve({
            ...storedNode('folder-1'),
            kind: 'folder',
            objectKey: null,
            sizeBytes: null,
          }),
        ),
      },
      uploadSession: { updateMany },
    };
    const transaction = jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    );
    const repository = createRepository({ $transaction: transaction });

    const completed = await repository.completeUpload(
      {
        conflictStrategy: 'rename',
        fileName: 'Report (2).pdf',
        objectKey: 'uploaded-object',
        parentNodeId: 'folder-1',
        requestedFileName: 'Report.pdf',
        sizeBytes: 32,
        workspaceId: 'workspace-default',
      },
      {
        completionToken: 'completion-token',
        sessionId: 'upload-session-1',
      },
    );

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: 'Serializable',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          directoryKey: 'folder-1',
          parentNodeId: 'folder-1',
        }) as unknown,
      }),
    );
    expect(create.mock.calls.map(([input]) => input.data.name)).toEqual([
      'Report (2).pdf',
      'Report (3).pdf',
    ]);
    expect(completed.node.name).toBe('Report (3).pdf');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: 'Report (3).pdf',
          nodeId: completed.node.id,
        }) as unknown,
      }),
    );
  });

  it('retries a serializable rename transaction conflict', async () => {
    const transactionConflict = Object.assign(
      new Error('write conflict or deadlock'),
      { code: 'P2034' },
    );
    const tx = {
      fileNode: {
        findMany: jest.fn(() => Promise.resolve([])),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...data,
            archivedBy: null,
            originalParentNodeId: null,
            originalPath: null,
          }),
        ),
      },
    };
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(transactionConflict)
      .mockImplementationOnce(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      );
    const repository = createRepository({ $transaction: transaction });

    await expect(
      repository.completeUpload({
        conflictStrategy: 'rename',
        fileName: 'Report.pdf',
        objectKey: 'uploaded-object',
        requestedFileName: 'Report.pdf',
        sizeBytes: 32,
        workspaceId: 'workspace-default',
      }),
    ).resolves.toMatchObject({ node: { name: 'Report.pdf' } });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('retries a version-number collision using the latest target object', async () => {
    const versionConflict = Object.assign(
      new Error('Unique constraint failed'),
      {
        code: 'P2002',
        meta: { target: ['nodeId', 'versionNumber'] },
      },
    );
    const firstTarget = {
      ...storedNode('node-a'),
      name: 'Report.pdf',
      nameKey: 'active:report.pdf',
      objectKey: 'first-object',
    };
    const secondTarget = {
      ...firstTarget,
      objectKey: 'concurrently-uploaded-object',
    };
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(firstTarget)
      .mockResolvedValueOnce(secondTarget);
    const createVersion = jest
      .fn<
        Promise<unknown>,
        [
          {
            data: Record<string, unknown> & { objectKey: string };
          },
        ]
      >()
      .mockRejectedValueOnce(versionConflict)
      .mockResolvedValueOnce({ id: 'version-2' });
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...secondTarget, ...data }),
    );
    const tx = {
      fileNode: { findUnique, update },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: 1 } }),
        ),
        create: createVersion,
      },
    };
    const transaction = jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    );
    const repository = createRepository({ $transaction: transaction });

    const completed = await repository.completeUpload({
      conflictStrategy: 'version',
      conflictTargetNodeId: firstTarget.id,
      conflictTargetObjectKey: firstTarget.objectKey ?? undefined,
      fileName: firstTarget.name,
      objectKey: 'final-upload-object',
      requestedFileName: firstTarget.name,
      sizeBytes: 32,
      workspaceId: firstTarget.workspaceId,
    });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(
      createVersion.mock.calls.map(([input]) => input.data.objectKey),
    ).toEqual(['first-object', 'concurrently-uploaded-object']);
    expect(update).toHaveBeenCalledTimes(1);
    expect(completed.node.objectKey).toBe('final-upload-object');
    expect(completed.displacedObjectKey).toBeNull();
  });

  it('maps an exhausted version-number collision to a stable conflict', async () => {
    const versionConflict = Object.assign(
      new Error('Unique constraint failed'),
      {
        code: 'P2002',
        meta: { target: ['nodeId', 'versionNumber'] },
      },
    );
    const target = {
      ...storedNode('node-a'),
      name: 'Report.pdf',
      nameKey: 'active:report.pdf',
      objectKey: 'current-object',
    };
    const createVersion = jest.fn(() => Promise.reject(versionConflict));
    const tx = {
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(target)),
        update: jest.fn(),
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: 1 } }),
        ),
        create: createVersion,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.completeUpload({
        conflictStrategy: 'version',
        conflictTargetNodeId: target.id,
        fileName: target.name,
        objectKey: 'final-upload-object',
        requestedFileName: target.name,
        sizeBytes: 32,
        workspaceId: target.workspaceId,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'UPLOAD_VERSION_CONFLICT',
        message: 'File version changed while the upload was being completed',
      },
    });
    expect(createVersion).toHaveBeenCalledTimes(
      serializableTransactionMaxAttempts,
    );
    expect(tx.fileNode.update).not.toHaveBeenCalled();
  });

  it('maps only skip name races to the structured skipped result', async () => {
    const nameConflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'file_nodes_scope_directory_name_key' },
    });
    const tx = {
      fileNode: {
        create: jest.fn(() => Promise.reject(nameConflict)),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    await expect(
      repository.completeUpload({
        conflictStrategy: 'skip',
        fileName: 'Report.pdf',
        objectKey: 'uploaded-object',
        sizeBytes: 32,
        workspaceId: 'workspace-default',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'UPLOAD_CONFLICT_SKIPPED',
        message: 'File upload skipped because a same-name item exists',
      },
    });
  });
});
