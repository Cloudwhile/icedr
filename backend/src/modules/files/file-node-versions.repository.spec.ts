import type { PrismaService } from '../../database/prisma.service';
import {
  FileNodeVersionsRepository,
  isSqliteBusyPrismaError,
} from './file-node-versions.repository';

function treeNode(id: string, parentNodeId: string | null) {
  return {
    id,
    workspaceId: 'workspace-a',
    parentNodeId,
    name: id,
    kind: 'folder',
    mimeType: 'inode/directory',
    sizeBytes: null,
    objectKey: null,
    checksumAlgorithm: null,
    checksumValue: null,
    integrityStatus: 'unknown',
    lastVerifiedAt: null,
    verificationFailureCode: null,
    integrityAcknowledgedAt: null,
    integrityAcknowledgedBy: null,
    ownerName: 'User',
    ownerUserId: null,
    spaceScope: 'workspace',
    starred: false,
    archivedAt: null,
    archivedBy: null,
    originalParentNodeId: null,
    originalPath: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function treeQueryRaw(rows: ReturnType<typeof treeNode>[]) {
  return jest.fn((statement: { sql?: string; values?: unknown[] }) => {
    if (statement.sql?.toLowerCase().includes('with recursive')) {
      return Promise.resolve(rows.slice(1));
    }
    return Promise.resolve(
      (statement.values ?? [])
        .filter((value): value is string => typeof value === 'string')
        .map((id) => ({ id })),
    );
  });
}

describe('FileNodeVersionsRepository integrity metadata', () => {
  it('does not prune an unacknowledged anomalous version', async () => {
    const old = new Date('2025-01-01T00:00:00.000Z');
    const protectedVersion = {
      id: 'version-protected',
      objectKey: 'objects/protected',
      createdAt: old,
      integrityStatus: 'mismatch',
      integrityAcknowledgedAt: null,
    };
    const acknowledgedVersion = {
      id: 'version-acknowledged',
      objectKey: 'objects/acknowledged',
      createdAt: old,
      integrityStatus: 'failed',
      integrityAcknowledgedAt: new Date('2026-08-14T00:00:00.000Z'),
    };
    const deleteMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([protectedVersion, acknowledgedVersion])
      .mockResolvedValueOnce([protectedVersion]);
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      filePolicySetting: {
        upsert: jest.fn(() =>
          Promise.resolve({
            settingKey: 'global',
            trashRetentionDays: 30,
            versionRetentionCount: 0,
            versionRetentionDays: 0,
            updatedAt: new Date(),
          }),
        ),
      },
      fileVersion: {
        deleteMany,
        findMany,
      },
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);

    await expect(repository.pruneVersions('node-1')).resolves.toEqual([
      'objects/acknowledged',
    ]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'version-acknowledged',
        objectKey: 'objects/acknowledged',
        OR: [
          { integrityStatus: { notIn: ['mismatch', 'failed'] } },
          { integrityAcknowledgedAt: { not: null } },
        ],
      },
    });
  });

  it('does not release an object when a newer anomaly prevents version deletion', async () => {
    const deleteMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const repository = new FileNodeVersionsRepository({
      fileVersion: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'version-racing',
              objectKey: 'objects/racing',
              createdAt: new Date(0),
              integrityStatus: 'verified',
              integrityAcknowledgedAt: null,
            },
          ]),
        ),
        deleteMany,
      },
    } as unknown as PrismaService);
    jest.spyOn(repository, 'getPolicy').mockResolvedValue({
      versionRetentionDays: 0,
      versionRetentionCount: 0,
    } as never);

    await expect(repository.pruneVersions('node-1')).resolves.toEqual([]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'version-racing',
        objectKey: 'objects/racing',
        OR: [
          { integrityStatus: { notIn: ['mismatch', 'failed'] } },
          { integrityAcknowledgedAt: { not: null } },
        ],
      },
    });
  });

  it('does not release an old restored version still referenced by the current node', async () => {
    const restoredObjectKey = 'objects/restored-old-version';
    const deleteMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const repository = new FileNodeVersionsRepository({
      $queryRaw: jest.fn(() =>
        Promise.resolve([{ objectKey: restoredObjectKey }]),
      ),
      fileNode: {
        findMany: jest.fn(() =>
          Promise.resolve([{ objectKey: restoredObjectKey }]),
        ),
      },
      fileVersion: {
        deleteMany,
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'version-restored-old',
              objectKey: restoredObjectKey,
              createdAt: new Date(0),
              integrityStatus: 'verified',
              integrityAcknowledgedAt: null,
            },
          ])
          .mockResolvedValueOnce([]),
      },
    } as unknown as PrismaService);
    jest.spyOn(repository, 'getPolicy').mockResolvedValue({
      versionRetentionDays: 0,
      versionRetentionCount: 0,
    } as never);

    await expect(repository.pruneVersions('node-1')).resolves.toEqual([]);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it('checks node and version references in one database snapshot', async () => {
    const queryRaw = jest.fn(() =>
      Promise.resolve([{ objectKey: 'objects/still-referenced' }]),
    );
    const repository = new FileNodeVersionsRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await expect(
      repository.filterUnreferencedObjectKeys([
        'objects/still-referenced',
        'objects/unreferenced',
      ]),
    ).resolves.toEqual(['objects/unreferenced']);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const statement = (queryRaw.mock.calls[0]?.[0] as { sql?: string }).sql;
    expect(statement).toContain('FROM file_nodes');
    expect(statement).toContain('UNION');
    expect(statement).toContain('FROM file_versions');
  });

  it('deduplicates recursive descendants so legacy cycles cannot recurse forever', async () => {
    const queryRaw = jest.fn(() => Promise.resolve([]));
    const repository = new FileNodeVersionsRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);

    await repository.collectDescendantRows('root-node');

    const statement = queryRaw.mock.calls[0]?.[0] as {
      sql?: string;
      strings?: string[];
    };
    const sql = statement.sql ?? statement.strings?.join('?') ?? '';
    expect(sql).toContain('union\n');
    expect(sql).not.toContain('union all');
    expect(sql).toContain('where id <>');
  });

  it('retries archive after a concurrent child changes the locked tree', async () => {
    const root = treeNode('root', null);
    const child = treeNode('child', root.id);
    const concurrentChild = treeNode('concurrent-child', root.id);
    const firstRows = [root, child];
    const secondRows = [root, child, concurrentChild];
    const firstUpdates = jest.fn();
    const secondUpdates = jest.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) =>
        Promise.resolve({
          ...(secondRows.find((row) => row.id === where.id) ?? root),
          ...data,
        }),
    );
    const createTransaction = (
      rows: ReturnType<typeof treeNode>[],
      outsideChildCount: number,
      update: jest.Mock,
    ) => ({
      $queryRaw: treeQueryRaw(rows),
      fileNode: {
        count: jest.fn(() => Promise.resolve(outsideChildCount)),
        findMany: jest.fn(() => Promise.resolve(rows)),
        findUnique: jest.fn(() => Promise.resolve(root)),
        update,
      },
    });
    const transactions = [
      createTransaction(firstRows, 1, firstUpdates),
      createTransaction(secondRows, 0, secondUpdates),
    ];
    const transaction = jest.fn(
      (operation: (tx: (typeof transactions)[number]) => Promise<unknown>) =>
        operation(transactions.shift() ?? transactions[0]),
    );
    const repository = new FileNodeVersionsRepository({
      $transaction: transaction,
      isSqlite: () => false,
    } as unknown as PrismaService);

    await expect(
      repository.archiveTree(root.id, 'admin-1'),
    ).resolves.toMatchObject({
      id: root.id,
      archivedBy: 'admin-1',
    });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(firstUpdates).not.toHaveBeenCalled();
    expect(secondUpdates).toHaveBeenCalledTimes(3);
  });

  it('keeps an already-active nested node in its current parent when restored again', async () => {
    const active = treeNode('active-child', 'parent-folder');
    const update = jest.fn();
    const tx = {
      $queryRaw: treeQueryRaw([active]),
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        findMany: jest.fn(() => Promise.resolve([active])),
        findUnique: jest.fn(() => Promise.resolve(active)),
        update,
      },
    };
    const transaction = jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    );
    const repository = new FileNodeVersionsRepository({
      $transaction: transaction,
      isSqlite: () => false,
    } as unknown as PrismaService);

    await expect(repository.restoreTree(active.id)).resolves.toBe(active);

    expect(update).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('skips automatic trash deletion when a tree contains an unacknowledged anomaly', async () => {
    const root = {
      id: 'root-1',
      archivedAt: new Date('2025-01-01T00:00:00.000Z'),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const child = {
      id: 'child-1',
      archivedAt: root.archivedAt,
      integrityStatus: 'failed',
      integrityAcknowledgedAt: null,
    };
    const deleteMany = jest.fn();
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        deleteMany,
        findMany: jest.fn(() => Promise.resolve([root])),
        findUnique: jest.fn(() => Promise.resolve(root)),
      },
      fileVersion: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);
    jest
      .spyOn(repository, 'collectDescendantRows')
      .mockResolvedValue([child] as never);

    await expect(
      repository.cleanupTrash(new Date('2026-01-01T00:00:00.000Z')),
    ).resolves.toEqual({
      nodes: [],
      objectKeysToDelete: [],
      versions: [],
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('also protects a trash tree with an unacknowledged anomalous version', async () => {
    const root = {
      id: 'root-version',
      archivedAt: new Date('2025-01-01T00:00:00.000Z'),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const deleteMany = jest.fn();
    const prisma = {
      fileNode: {
        deleteMany,
        findMany: jest.fn(() => Promise.resolve([root])),
        findUnique: jest.fn(() => Promise.resolve(root)),
      },
      fileVersion: {
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'version-protected-trash',
              nodeId: root.id,
              versionNumber: 1,
              objectKey: 'objects/protected-trash',
              sizeBytes: 12n,
              mimeType: 'application/octet-stream',
              checksumAlgorithm: 'sha256',
              checksumValue: 'a'.repeat(64),
              integrityStatus: 'mismatch',
              integrityAcknowledgedAt: null,
              integrityAcknowledgedBy: null,
              lastVerifiedAt: new Date('2025-01-01T00:00:00.000Z'),
              verificationFailureCode: 'checksum-mismatch',
              uploadedBy: 'User',
              remark: '',
              createdAt: new Date('2025-01-01T00:00:00.000Z'),
            },
          ]),
        ),
      },
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);
    jest.spyOn(repository, 'collectDescendantRows').mockResolvedValue([]);

    await expect(
      repository.cleanupTrash(new Date('2026-01-01T00:00:00.000Z')),
    ).resolves.toEqual({
      nodes: [],
      objectKeysToDelete: [],
      versions: [],
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('preserves a trash tree when verification reports an anomaly after the initial read', async () => {
    const root = {
      id: 'root-racing',
      objectKey: 'objects/racing',
      archivedAt: new Date(0),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const deleteMany = jest.fn();
    const tx = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
      fileNode: {
        findMany: jest.fn(() =>
          Promise.resolve([{ ...root, integrityStatus: 'mismatch' }]),
        ),
        count: jest.fn(() => Promise.resolve(0)),
        deleteMany,
      },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const repository = new FileNodeVersionsRepository({
      fileNode: { findMany: jest.fn(() => Promise.resolve([root])) },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
      isSqlite: () => true,
    } as unknown as PrismaService);
    jest.spyOn(repository, 'listTreeForDeletion').mockResolvedValue({
      nodes: [root],
      versions: [],
      hasUnacknowledgedIntegrityAnomaly: false,
    } as never);

    await expect(repository.cleanupTrash(new Date())).resolves.toEqual({
      nodes: [],
      objectKeysToDelete: [],
      versions: [],
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('allows automatic trash deletion after the anomaly is acknowledged', async () => {
    const root = {
      id: 'root-acknowledged',
      objectKey: 'objects/acknowledged',
      archivedAt: new Date('2025-01-01T00:00:00.000Z'),
      integrityStatus: 'mismatch',
      integrityAcknowledgedAt: new Date('2025-02-01T00:00:00.000Z'),
    };
    const deleteMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const rootFindMany = jest
      .fn()
      .mockResolvedValueOnce([root])
      .mockResolvedValueOnce([]);
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        deleteMany,
        findMany: rootFindMany,
        findUnique: jest.fn(() => Promise.resolve(root)),
      },
      fileVersion: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      isSqlite: () => true,
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);
    Object.assign(prisma, {
      $transaction: (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: jest.fn(() => Promise.resolve(1)),
          fileNode: {
            deleteMany,
            findMany: jest.fn(() => Promise.resolve([root])),
            count: jest.fn(() => Promise.resolve(0)),
          },
          fileVersion: {
            findMany: jest.fn(() => Promise.resolve([])),
          },
        }),
    });
    jest.spyOn(repository, 'collectDescendantRows').mockResolvedValue([]);

    await expect(
      repository.cleanupTrash(new Date('2026-01-01T00:00:00.000Z')),
    ).resolves.toMatchObject({
      nodes: [root],
      objectKeysToDelete: ['objects/acknowledged'],
      versions: [],
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['root-acknowledged'] } },
    });
  });

  it('does not release an object key still referenced by a copied node', async () => {
    const objectKey = 'objects/shared-copy';
    const archivedCopy = {
      id: 'copy-archived',
      parentNodeId: null,
      objectKey,
      archivedAt: new Date(0),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const activeCopy = { objectKey };
    const deleteMany = jest.fn(() => Promise.resolve({ count: 1 }));
    const prisma = {
      $queryRaw: jest.fn(() => Promise.resolve([{ objectKey }])),
      fileNode: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([archivedCopy])
          .mockResolvedValueOnce([activeCopy]),
        findUnique: jest.fn(() => Promise.resolve(archivedCopy)),
      },
      fileVersion: {
        findMany: jest.fn(() => Promise.resolve([])),
      },
      isSqlite: () => true,
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);
    Object.assign(prisma, {
      $transaction: (
        callback: (tx: {
          $executeRaw: jest.Mock;
          fileNode: {
            count: jest.Mock;
            deleteMany: jest.Mock;
            findMany: jest.Mock;
          };
          fileVersion: { findMany: jest.Mock };
        }) => unknown,
      ) =>
        callback({
          $executeRaw: jest.fn(() => Promise.resolve(1)),
          fileNode: {
            count: jest.fn(() => Promise.resolve(0)),
            deleteMany,
            findMany: jest.fn(() => Promise.resolve([archivedCopy])),
          },
          fileVersion: {
            findMany: jest.fn(() => Promise.resolve([])),
          },
        }),
    });
    jest.spyOn(repository, 'collectDescendantRows').mockResolvedValue([]);

    await expect(repository.cleanupTrash(new Date())).resolves.toMatchObject({
      nodes: [archivedCopy],
      objectKeysToDelete: [],
      versions: [],
    });
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it('uses ordered PostgreSQL row locks and Serializable isolation for tree cleanup', async () => {
    const root = {
      id: 'root-postgres',
      parentNodeId: null,
      objectKey: 'objects/postgres',
      archivedAt: new Date(0),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findMany: jest.fn(() => Promise.resolve([root])),
      },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const transaction = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const repository = new FileNodeVersionsRepository({
      $queryRaw: jest.fn(() => Promise.resolve([])),
      $transaction: transaction,
      fileNode: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([root])
          .mockResolvedValueOnce([]),
      },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
      isSqlite: () => false,
    } as unknown as PrismaService);
    jest.spyOn(repository, 'listTreeForDeletion').mockResolvedValue({
      nodes: [root],
      versions: [],
      hasUnacknowledgedIntegrityAnomaly: false,
    } as never);

    await repository.cleanupTrash(new Date());

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const lockStatements = tx.$queryRaw.mock.calls.map(
      (call) => (call[0] as { sql?: string }).sql ?? '',
    );
    expect(lockStatements[0]).toContain('FROM file_nodes');
    expect(lockStatements[0]).toContain('FOR UPDATE');
    expect(lockStatements[1]).toContain('FROM file_versions');
    expect(lockStatements[1]).toContain('FOR UPDATE');
  });

  it('accepts a cascaded tree deletion even when the direct delete count is smaller', async () => {
    const root = {
      id: 'cascade-root',
      parentNodeId: null,
      objectKey: 'objects/cascade-root',
      archivedAt: new Date(0),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const child = {
      ...root,
      id: 'cascade-child',
      objectKey: 'objects/cascade-child',
      parentNodeId: root.id,
    };
    const count = jest.fn(() => Promise.resolve(0));
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        count,
        deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findMany: jest.fn(() => Promise.resolve([root, child])),
      },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const repository = new FileNodeVersionsRepository({
      $queryRaw: jest.fn(() => Promise.resolve([])),
      $transaction: (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      fileNode: { findMany: jest.fn(() => Promise.resolve([])) },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
      isSqlite: () => false,
    } as unknown as PrismaService);
    jest.spyOn(repository, 'listTreeForDeletion').mockResolvedValue({
      nodes: [root, child],
      versions: [],
      hasUnacknowledgedIntegrityAnomaly: false,
    } as never);

    await expect(repository.deleteTree(root.id)).resolves.toMatchObject({
      nodes: [root, child],
      objectKeysToDelete: [root.objectKey, child.objectKey],
    });

    expect(tx.fileNode.deleteMany).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('retries a Serializable tree cleanup conflict', async () => {
    const root = {
      id: 'root-retry',
      parentNodeId: null,
      objectKey: 'objects/retry',
      archivedAt: new Date(0),
      integrityStatus: 'verified',
      integrityAcknowledgedAt: null,
    };
    const tx = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
      fileNode: {
        count: jest.fn(() => Promise.resolve(0)),
        deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
        findMany: jest.fn(() => Promise.resolve([root])),
      },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('conflict'), { code: 'P2034' }),
      )
      .mockImplementation((callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      );
    const repository = new FileNodeVersionsRepository({
      $queryRaw: jest.fn(() => Promise.resolve([])),
      $transaction: transaction,
      fileNode: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([root])
          .mockResolvedValueOnce([]),
      },
      fileVersion: { findMany: jest.fn(() => Promise.resolve([])) },
      isSqlite: () => true,
    } as unknown as PrismaService);
    jest.spyOn(repository, 'listTreeForDeletion').mockResolvedValue({
      nodes: [root],
      versions: [],
      hasUnacknowledgedIntegrityAnomaly: false,
    } as never);

    await expect(repository.cleanupTrash(new Date())).resolves.toMatchObject({
      objectKeysToDelete: ['objects/retry'],
    });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('archives the current metadata and restores the selected version metadata atomically', async () => {
    const current = {
      id: 'node-1',
      workspaceId: 'workspace-default',
      spaceScope: 'workspace',
      parentNodeId: null,
      directoryKey: '',
      ownerScopeKey: '',
      name: 'report.txt',
      nameKey: 'active:report.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 12n,
      objectKey: 'objects/current',
      checksumAlgorithm: 'sha256',
      checksumValue: 'a'.repeat(64),
      integrityStatus: 'verified',
      lastVerifiedAt: new Date(1),
      verificationFailureCode: null,
      ownerName: 'User',
      ownerUserId: 'user-1',
      starred: false,
      archivedAt: null,
      archivedBy: null,
      originalParentNodeId: null,
      originalPath: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const selectedVersion = {
      id: 'version-1',
      nodeId: current.id,
      versionNumber: 1,
      objectKey: 'objects/version-1',
      sizeBytes: 11n,
      mimeType: 'text/markdown',
      checksumAlgorithm: 'sha256',
      checksumValue: 'b'.repeat(64),
      integrityStatus: 'mismatch',
      lastVerifiedAt: new Date(2),
      verificationFailureCode: 'checksum-mismatch',
      uploadedBy: 'User',
      remark: 'old',
      createdAt: new Date(0),
    };
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...current, ...data }),
    );
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update,
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: 1 } }),
        ),
        create,
        findFirst: jest.fn(() => Promise.resolve(selectedVersion)),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);
    const enqueueObjectVerification = jest.fn(() =>
      Promise.resolve('task-test'),
    );
    const integrityTasks = {
      enqueueObjectVerification,
      kickQueued: jest.fn(),
    };

    await repository.restoreVersion(
      current.id,
      selectedVersion.id,
      'User',
      integrityTasks as never,
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        objectKey: 'objects/current',
        checksumValue: 'a'.repeat(64),
        integrityStatus: 'verified',
        lastVerifiedAt: new Date(1),
      }) as unknown,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: current.id },
      data: expect.objectContaining({
        objectKey: 'objects/version-1',
        checksumAlgorithm: 'sha256',
        checksumValue: 'b'.repeat(64),
        integrityStatus: 'mismatch',
        lastVerifiedAt: new Date(2),
        verificationFailureCode: 'checksum-mismatch',
      }) as unknown,
    });
  });

  it('pins pending current, historical, and restored targets during a restore', async () => {
    const current = {
      id: 'node-pending',
      workspaceId: 'workspace-default',
      spaceScope: 'workspace',
      parentNodeId: null,
      directoryKey: '',
      ownerScopeKey: '',
      name: 'report.txt',
      nameKey: 'active:report.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 12n,
      objectKey: 'objects/current-pending',
      checksumAlgorithm: null,
      checksumValue: null,
      integrityStatus: 'pending',
      lastVerifiedAt: null,
      verificationFailureCode: null,
      ownerName: 'User',
      ownerUserId: 'user-1',
      starred: false,
      archivedAt: null,
      archivedBy: null,
      originalParentNodeId: null,
      originalPath: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const selectedVersion = {
      id: 'version-pending',
      nodeId: current.id,
      versionNumber: 1,
      objectKey: 'objects/version-pending',
      sizeBytes: 11n,
      mimeType: 'text/markdown',
      checksumAlgorithm: null,
      checksumValue: null,
      integrityStatus: 'pending',
      lastVerifiedAt: null,
      verificationFailureCode: null,
      uploadedBy: 'User',
      remark: 'old',
      createdAt: new Date(0),
    };
    const create = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(data),
    );
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([])),
      fileNode: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...current, ...data }),
        ),
      },
      fileVersion: {
        aggregate: jest.fn(() =>
          Promise.resolve({ _max: { versionNumber: 1 } }),
        ),
        create,
        findFirst: jest.fn(() => Promise.resolve(selectedVersion)),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    } as unknown as PrismaService;
    const repository = new FileNodeVersionsRepository(prisma);
    const enqueueObjectVerification = jest.fn(() =>
      Promise.resolve('task-test'),
    );

    await repository.restoreVersion(
      current.id,
      selectedVersion.id,
      'Admin',
      {
        enqueueObjectVerification,
      } as never,
      'admin-1',
    );

    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      1,
      {
        actorUserId: 'admin-1',
        nodeId: current.id,
        objectKey: current.objectKey,
        versionId: expect.any(String) as unknown,
        workspaceId: current.workspaceId,
      },
      tx,
    );
    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      2,
      {
        actorUserId: 'admin-1',
        nodeId: current.id,
        objectKey: selectedVersion.objectKey,
        versionId: selectedVersion.id,
        workspaceId: current.workspaceId,
      },
      tx,
    );
    expect(enqueueObjectVerification).toHaveBeenNthCalledWith(
      3,
      {
        actorUserId: 'admin-1',
        nodeId: current.id,
        objectKey: selectedVersion.objectKey,
        workspaceId: current.workspaceId,
      },
      tx,
    );
  });

  it('recognizes only SQLite lock contention variants as retryable raw-query errors', () => {
    expect(isSqliteBusyPrismaError({ code: 'P1008' })).toBe(true);
    expect(
      isSqliteBusyPrismaError({
        code: 'P2010',
        meta: { code: '5', message: 'database is locked' },
      }),
    ).toBe(true);
    expect(
      isSqliteBusyPrismaError({
        code: 'P2010',
        meta: { code: '19', message: 'constraint failed' },
      }),
    ).toBe(false);
    expect(isSqliteBusyPrismaError({ code: 'P2002' })).toBe(false);
  });
});
