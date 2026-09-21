import { BadRequestException, ConflictException } from '@nestjs/common';
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

function rootOnlyQueryRaw(rootId: string) {
  return jest.fn((statement: unknown) => {
    const sql =
      typeof statement === 'object' && statement !== null && 'sql' in statement
        ? String(statement.sql)
        : '';
    return Promise.resolve(
      sql.includes('SELECT id FROM file_nodes') ? [{ id: rootId }] : [],
    );
  });
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
    const tx = {
      $queryRaw: rootOnlyQueryRaw(stored.id),
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        findUnique: jest.fn(() => Promise.resolve(stored)),
        findMany: jest.fn((input: { select?: { name: boolean } }) =>
          Promise.resolve(input.select ? [{ name }] : [stored]),
        ),
        update,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
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
    const findMany = jest.fn((input: { select?: { name: boolean } }) =>
      Promise.resolve(input.select ? [] : [stored]),
    );
    const tx = {
      $queryRaw: rootOnlyQueryRaw(stored.id),
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        findMany,
        findUnique: jest.fn(() => Promise.resolve(stored)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...stored, ...data }),
        ),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    });

    await repository.restoreTree(stored.id);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerScopeKey: 'user-1',
          spaceScope: 'personal',
        }) as unknown,
        select: { name: true },
      }),
    );
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
    const repository = createRepository({
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
    });

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

  it('revalidates locked ancestors so concurrent moves cannot create a cycle', async () => {
    const folders = new Map(
      ['folder-a', 'folder-b'].map((id) => [
        id,
        {
          ...storedNode(id),
          kind: 'folder',
          mimeType: 'inode/directory',
          name: id,
          objectKey: null,
          sizeBytes: null,
        },
      ]),
    );
    const tx = {
      $queryRaw: jest.fn(() =>
        Promise.resolve([{ id: 'folder-a' }, { id: 'folder-b' }]),
      ),
      fileNode: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(folders.get(where.id) ?? null),
        ),
        update: jest.fn(
          ({
            data,
            where,
          }: {
            data: Record<string, unknown>;
            where: { id: string };
          }) => {
            const current = folders.get(where.id);
            if (!current) throw new Error('missing test node');
            const updated = { ...current, ...data };
            folders.set(where.id, updated);
            return Promise.resolve(updated);
          },
        ),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    });

    await expect(
      repository.move('folder-a', 'folder-b'),
    ).resolves.toMatchObject({
      id: 'folder-a',
      parentNodeId: 'folder-b',
    });
    await expect(
      repository.move('folder-b', 'folder-a'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(folders.get('folder-b')?.parentNodeId).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
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
      checksumAlgorithm: 'sha256',
      checksumValue: 'b'.repeat(64),
      integrityStatus: 'verified',
      lastVerifiedAt: new Date(1).toISOString(),
      verificationFailureCode: null,
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
    const sourceRow = {
      ...storedNode(source.id),
      checksumValue: source.checksumValue,
      lastVerifiedAt: new Date(source.lastVerifiedAt),
      name: source.name,
      objectKey: source.objectKey,
      ownerName: source.owner,
      ownerUserId: source.ownerUserId,
      sizeBytes: BigInt(source.sizeBytes),
      spaceScope: source.spaceScope,
    };
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: source.id }])),
      fileNode: {
        create,
        findFirst: jest.fn(() => Promise.resolve(sourceRow)),
        findUnique: jest.fn(() =>
          Promise.resolve({
            ...storedNode('folder-2'),
            kind: 'folder',
            objectKey: null,
            sizeBytes: null,
            spaceScope: 'personal',
          }),
        ),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    });

    await repository.copyTree(source, {
      name: 'Report copy.txt',
      parentNodeId: 'folder-2',
    });

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        checksumAlgorithm: 'sha256',
        checksumValue: 'b'.repeat(64),
        directoryKey: 'folder-2',
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(1),
        nameKey: 'active:report copy.txt',
        ownerScopeKey: 'user-1',
        verificationFailureCode: null,
      },
    });
  });

  it('atomically queues verification for a copy whose source is still pending', async () => {
    const source = {
      ...storedNode('source-node'),
      ownerUserId: 'owner-1',
      ownerScopeKey: 'owner-1',
      spaceScope: 'personal',
      sizeBytes: 32,
      checksumAlgorithm: null,
      checksumValue: null,
      integrityStatus: 'pending',
      lastVerifiedAt: null,
      verificationFailureCode: null,
    };
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...source, ...data }),
    );
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: source.id }])),
      fileNode: {
        create,
        findFirst: jest.fn(() => Promise.resolve(source)),
        findMany: jest.fn(() => Promise.resolve([])),
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
        isSqlite: () => false,
      },
      { enqueueObjectVerification, kickQueued },
    );

    const copied = await repository.copyTree(
      {
        ...source,
        sizeBytes: Number(source.sizeBytes),
        owner: source.ownerName,
        previewCapability: {
          downloadOnly: false,
          previewType: 'text',
          reason: null,
          renderMode: 'text',
          supported: true,
        },
        createdAt: source.createdAt.toISOString(),
        updatedAt: source.updatedAt.toISOString(),
      },
      { actorUserId: 'admin-1', parentNodeId: null },
    );

    expect(enqueueObjectVerification).toHaveBeenCalledWith(
      {
        actorUserId: 'admin-1',
        nodeId: copied?.id,
        objectKey: source.objectKey,
        workspaceId: source.workspaceId,
      },
      tx,
    );
    expect(kickQueued).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an object key when the copy source disappeared before its row lock', async () => {
    const source = storedNode('source-deleted');
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        create,
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    });

    await expect(
      repository.copyTree(
        {
          ...source,
          owner: source.ownerName,
          previewCapability: {
            downloadOnly: false,
            previewType: 'text',
            reason: null,
            renderMode: 'text',
            supported: true,
          },
          sizeBytes: Number(source.sizeBytes),
          createdAt: source.createdAt.toISOString(),
          updatedAt: source.updatedAt.toISOString(),
        },
        { parentNodeId: null },
      ),
    ).resolves.toBeNull();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.fileNode.findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('archives the complete integrity metadata and marks replacement content pending', async () => {
    const existing = storedNode('node-1');
    const createVersion = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...existing, ...data }),
    );
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: existing.id }])),
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(existing)),
        update,
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
        isSqlite: () => false,
      },
      { enqueueObjectVerification, kickQueued },
    );

    await repository.replaceContentObject({
      id: existing.id,
      mimeType: 'text/plain',
      objectKey: 'objects/replacement',
      sizeBytes: 18,
    });

    expect(createVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        checksumAlgorithm: 'sha256',
        checksumValue: 'a'.repeat(64),
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(1),
        verificationFailureCode: null,
      }) as unknown,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: expect.objectContaining({
        checksumAlgorithm: null,
        checksumValue: null,
        integrityStatus: 'pending',
        lastVerifiedAt: null,
        objectKey: 'objects/replacement',
        verificationFailureCode: null,
      }) as unknown,
    });
    expect(enqueueObjectVerification).toHaveBeenCalledWith(
      {
        actorUserId: null,
        nodeId: existing.id,
        objectKey: 'objects/replacement',
        workspaceId: 'workspace-default',
      },
      tx,
    );
    expect(kickQueued).toHaveBeenCalledTimes(1);
  });

  it('locks and retries content replacement before archiving a concurrent upload object', async () => {
    const original = storedNode('node-racing');
    const uploaded = {
      ...original,
      objectKey: 'objects/concurrent-upload',
      sizeBytes: 12n,
      updatedAt: new Date(2),
    };
    const createVersion = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    const firstUpdate = jest.fn(() =>
      Promise.reject(
        Object.assign(new Error('write conflict'), { code: 'P2034' }),
      ),
    );
    const secondUpdate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...uploaded, ...data }),
    );
    const firstTx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: original.id }])),
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(original)),
        update: firstUpdate,
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: null } }),
        ),
        create: createVersion,
      },
    };
    const secondTx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: uploaded.id }])),
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(uploaded)),
        update: secondUpdate,
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: null } }),
        ),
        create: createVersion,
      },
    };
    const transactions = [firstTx, secondTx];
    const transaction = jest.fn(
      (operation: (client: typeof firstTx) => Promise<unknown>) =>
        operation(transactions.shift() ?? secondTx),
    );
    const repository = createRepository({
      $transaction: transaction,
      isSqlite: () => false,
    });

    await expect(
      repository.replaceContentObject({
        id: original.id,
        mimeType: 'text/plain',
        objectKey: 'objects/text-edit',
        sizeBytes: 18,
      }),
    ).resolves.toMatchObject({ objectKey: 'objects/text-edit' });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(transaction).toHaveBeenNthCalledWith(2, expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(firstTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      firstTx.fileNode.findUnique.mock.invocationCallOrder[0],
    );
    expect(secondTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      secondTx.fileNode.findUnique.mock.invocationCallOrder[0],
    );
    expect(createVersion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          objectKey: uploaded.objectKey,
          sizeBytes: uploaded.sizeBytes,
        }) as unknown,
      }),
    );
    expect(secondUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          objectKey: 'objects/text-edit',
        }) as unknown,
      }),
    );
  });

  it('pins verification for a pending object when content replacement archives it', async () => {
    const existing = {
      ...storedNode('node-pending'),
      checksumAlgorithm: null,
      checksumValue: null,
      integrityStatus: 'pending',
      lastVerifiedAt: null,
    };
    const createVersion = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: existing.id }])),
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(existing)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...existing, ...data }),
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
        isSqlite: () => false,
      },
      { enqueueObjectVerification, kickQueued },
    );

    await repository.replaceContentObject({
      id: existing.id,
      mimeType: 'text/plain',
      objectKey: 'objects/replacement',
      sizeBytes: 18,
    });

    expect(createVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integrityStatus: 'pending',
        objectKey: existing.objectKey,
      }) as unknown,
    });
    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      1,
      {
        actorUserId: null,
        nodeId: existing.id,
        objectKey: existing.objectKey,
        versionId: expect.any(String) as unknown,
        workspaceId: existing.workspaceId,
      },
      tx,
    );
    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      2,
      {
        actorUserId: null,
        nodeId: existing.id,
        objectKey: 'objects/replacement',
        workspaceId: existing.workspaceId,
      },
      tx,
    );
    expect(kickQueued).toHaveBeenCalledTimes(1);
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
    const tx = {
      $queryRaw: rootOnlyQueryRaw(stored.id),
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        findMany: jest.fn((input: { select?: Record<string, boolean> }) =>
          Promise.resolve(input.select ? [] : [stored]),
        ),
        findUnique: jest.fn(() => Promise.resolve(stored)),
        update,
      },
    };
    const repository = createRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
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
});
