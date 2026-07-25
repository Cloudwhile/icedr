import { ConflictException } from '@nestjs/common';
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

describe('FileNodesRepository', () => {
  it('looks up unique ids in sequential batches and preserves first input order', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `node-${index}`);
    const requested = [
      ids[700],
      ...ids.filter((id) => id !== ids[700]),
      'missing',
      ids[700],
    ];
    let activeQueries = 0;
    let maxActiveQueries = 0;
    const findMany = jest.fn(
      async (input: { where: { id: { in: string[] } } }) => {
        activeQueries += 1;
        maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
        await Promise.resolve();
        activeQueries -= 1;
        return [...input.where.id.in]
          .reverse()
          .filter((id) => id !== 'missing')
          .map((id) => storedNode(id));
      },
    );
    const repository = createRepository({ fileNode: { findMany } });

    const result = await repository.findByIds(requested);

    expect(findMany).toHaveBeenCalledTimes(3);
    expect(
      findMany.mock.calls.map((call) => call[0].where.id.in.length),
    ).toEqual([500, 500, 2]);
    expect(findMany.mock.calls.flatMap((call) => call[0].where.id.in)).toEqual([
      ...new Set(requested),
    ]);
    expect(result.map((node) => node.id)).toEqual([
      ids[700],
      ...ids.filter((id) => id !== ids[700]),
    ]);
    expect(maxActiveQueries).toBe(1);
  });

  it('distinguishes a null owner filter from an omitted owner filter', async () => {
    const findMany = jest.fn(() => Promise.resolve([]));
    const repository = createRepository({ fileNode: { findMany } });

    await repository.list('workspace-default', 'folder', 'active', {
      ownerUserId: null,
      spaceScope: 'personal',
    });
    await repository.list('workspace-default', 'folder', 'active', {
      spaceScope: 'personal',
    });

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        ownerUserId: null,
        parentNodeId: 'folder',
        spaceScope: 'personal',
      },
    });
    expect(findMany.mock.calls[1]?.[0].where).not.toHaveProperty('ownerUserId');
  });

  it('keeps generated restore names within the UTF-8 byte limit', async () => {
    const name = `${'界'.repeat(83)}ab.txt`;
    expect(Buffer.byteLength(name, 'utf8')).toBe(255);
    const archivedAt = new Date('2026-07-13T00:00:00.000Z');
    let stored = {
      id: 'archived-node',
      workspaceId: 'workspace-default',
      spaceScope: 'workspace',
      parentNodeId: null,
      name,
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: BigInt(32),
      objectKey: 'uploads/workspace-default/root/archived-node.txt',
      ownerName: 'Workspace User',
      ownerUserId: null,
      starred: false,
      archivedAt,
      archivedBy: 'user-1',
      originalParentNodeId: null,
      originalPath: name,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const update = jest.fn(({ data }: { data: Partial<typeof stored> }) => {
      stored = { ...stored, ...data };
      return Promise.resolve(stored);
    });
    const repository = createRepository({
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(stored)),
        findMany: jest.fn(() => Promise.resolve([{ name }])),
        update,
      },
      $queryRaw: jest.fn(() => Promise.resolve([])),
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    });

    const restored = await repository.restoreTree(stored.id);

    expect(restored?.name.endsWith(' (2).txt')).toBe(true);
    expect(Buffer.byteLength(restored?.name ?? '', 'utf8')).toBeLessThanOrEqual(
      255,
    );
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: stored.id },
      data: {
        directoryKey: '',
        nameKey: `active:${restored?.name}`,
        ownerScopeKey: '',
      },
    });
  });

  it('scopes personal restore conflicts to the file owner', async () => {
    const archivedAt = new Date('2026-07-13T00:00:00.000Z');
    const stored = {
      id: 'archived-personal-node',
      workspaceId: 'workspace-default',
      spaceScope: 'personal',
      parentNodeId: null,
      name: 'Report.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: BigInt(32),
      objectKey: 'object-1',
      ownerName: 'User 1',
      ownerUserId: 'user-1',
      starred: false,
      archivedAt,
      archivedBy: 'user-1',
      originalParentNodeId: null,
      originalPath: 'Report.txt',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const findMany = jest.fn(
      (input: {
        select: { name: boolean };
        where: Record<string, unknown>;
      }) => {
        void input;
        return Promise.resolve([]);
      },
    );
    const repository = createRepository({
      fileNode: {
        findMany,
        findUnique: jest.fn(() => Promise.resolve(stored)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...stored, ...data }),
        ),
      },
      $queryRaw: jest.fn(() => Promise.resolve([])),
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    });

    await repository.restoreTree(stored.id);

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        ownerScopeKey: 'user-1',
        spaceScope: 'personal',
      },
      select: { name: true },
    });
  });

  it('persists canonical active name keys when creating a folder', async () => {
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        archivedBy: null,
        originalParentNodeId: null,
        originalPath: null,
      }),
    );
    const repository = createRepository({ fileNode: { create } });

    await repository.createFolder({
      workspaceId: 'workspace-default',
      name: 'Résumé',
      ownerUserId: 'user-1',
      parentNodeId: 'folder-1',
      spaceScope: 'personal',
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        directoryKey: 'folder-1',
        nameKey: 'active:résumé',
        ownerScopeKey: 'user-1',
      },
    });
  });

  it('maps database name collisions to a conflict response', async () => {
    const databaseError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: 'file_nodes_scope_directory_name_key' },
    });
    const repository = createRepository({
      fileNode: {
        create: jest.fn(() => Promise.reject(databaseError)),
      },
    });

    await expect(
      repository.createFolder({
        workspaceId: 'workspace-default',
        name: 'Report',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not mislabel unrelated unique constraint errors', async () => {
    const databaseError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['nodeId', 'versionNumber'] },
    });
    const repository = createRepository({
      fileNode: {
        create: jest.fn(() => Promise.reject(databaseError)),
      },
    });

    await expect(
      repository.createFolder({
        workspaceId: 'workspace-default',
        name: 'Report',
      }),
    ).rejects.toBe(databaseError);
  });

  it('updates the canonical name key when renaming a node', async () => {
    const stored = {
      id: 'node-1',
      workspaceId: 'workspace-default',
      spaceScope: 'workspace',
      parentNodeId: 'folder-1',
      directoryKey: 'folder-1',
      ownerScopeKey: '',
      name: 'Draft.txt',
      nameKey: 'active:draft.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: BigInt(32),
      objectKey: 'object-1',
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
    const update = jest.fn(({ data }: { data: Partial<typeof stored> }) =>
      Promise.resolve({ ...stored, ...data }),
    );
    const repository = createRepository({
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(stored)),
        update,
      },
    });

    await repository.rename(stored.id, 'Final.txt');

    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: stored.id },
      data: {
        directoryKey: 'folder-1',
        name: 'Final.txt',
        nameKey: 'active:final.txt',
        ownerScopeKey: '',
      },
    });
  });

  it('persists canonical name keys when copying a node', async () => {
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        archivedBy: null,
        originalParentNodeId: null,
        originalPath: null,
      }),
    );
    const repository = createRepository({
      fileNode: {
        create,
        findMany: jest.fn(() => Promise.resolve([])),
      },
    });
    const source = {
      id: 'source-node',
      workspaceId: 'workspace-default',
      spaceScope: 'personal',
      parentNodeId: null,
      name: 'Report.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey: 'object-1',
      owner: 'User 1',
      ownerUserId: 'user-1',
      starred: false,
      archivedAt: null,
      archivedBy: null,
      originalParentNodeId: null,
      originalPath: null,
      previewCapability: {
        downloadOnly: false,
        previewType: 'text',
        reason: null,
        renderMode: 'text',
        supported: true,
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } as const;

    await repository.copyTree(source, {
      name: 'Report copy.txt',
      parentNodeId: 'folder-2',
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        directoryKey: 'folder-2',
        nameKey: 'active:report copy.txt',
        ownerScopeKey: 'user-1',
      },
    });
  });

  it('releases the active name key when archiving a node', async () => {
    const stored = {
      id: 'node-1',
      workspaceId: 'workspace-default',
      spaceScope: 'personal',
      parentNodeId: 'folder-1',
      directoryKey: 'folder-1',
      ownerScopeKey: 'user-1',
      name: 'Report.txt',
      nameKey: 'active:report.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: BigInt(32),
      objectKey: 'object-1',
      ownerName: 'User 1',
      ownerUserId: 'user-1',
      starred: false,
      archivedAt: null as Date | null,
      archivedBy: null as string | null,
      originalParentNodeId: null as string | null,
      originalPath: null as string | null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const update = jest.fn(({ data }: { data: Partial<typeof stored> }) => {
      Object.assign(stored, data);
      return Promise.resolve(stored);
    });
    const repository = createRepository({
      fileNode: {
        findMany: jest.fn(() => Promise.resolve([])),
        findUnique: jest.fn(() => Promise.resolve(stored)),
        update,
      },
      $queryRaw: jest.fn(() => Promise.resolve([])),
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    });

    await repository.archiveTree(stored.id, 'user-1');

    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: stored.id },
      data: {
        directoryKey: 'folder-1',
        nameKey: `archived:${stored.id}`,
        ownerScopeKey: 'user-1',
      },
    });
  });

  it('persists canonical name keys when completing a new upload', async () => {
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        archivedBy: null,
        originalParentNodeId: null,
        originalPath: null,
      }),
    );
    const findFirst = jest.fn((input: { where: Record<string, unknown> }) => {
      void input;
      return Promise.resolve(null);
    });
    const tx = {
      fileNode: {
        create,
        findFirst,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

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
        directoryKey: 'folder-1',
        nameKey: 'active:resume.pdf',
        ownerScopeKey: 'user-1',
      },
    });
    expect(findFirst).not.toHaveBeenCalled();
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
      fileNode: { create, findFirst: jest.fn(() => Promise.resolve(null)) },
      uploadSession: { updateMany },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    });

    const node = await repository.completeUpload(
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
        nodeId: node.id,
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
        findFirst: jest.fn(() => Promise.resolve(null)),
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
    const findFirst = jest.fn((input: { where: Record<string, unknown> }) => {
      void input;
      return Promise.resolve(null);
    });
    const tx = {
      fileNode: {
        create,
        findFirst,
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
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        directoryKey: 'folder-1',
        id: 'node-1',
        nameKey: 'active:report.pdf',
        ownerScopeKey: '',
      },
    });
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
        findFirst: jest.fn(() => Promise.resolve(existing)),
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
});
