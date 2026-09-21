import type { PrismaService } from '../../database/prisma.service';
import type { FileNode, Prisma } from '../../generated/prisma/client';
import { lockAndValidateActiveFileNodeParent } from './file-node-hierarchy-write';

function folder(
  id: string,
  parentNodeId: string | null,
  archivedAt: Date | null = null,
): FileNode {
  return {
    id,
    workspaceId: 'workspace-a',
    spaceScope: 'workspace',
    parentNodeId,
    directoryKey: parentNodeId ?? '',
    ownerScopeKey: '',
    name: id,
    nameKey: `active:${id}`,
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
    starred: false,
    archivedAt,
    archivedBy: archivedAt ? 'admin-1' : null,
    originalParentNodeId: null,
    originalPath: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('file node hierarchy write locks', () => {
  it('rejects an active parent whose ancestor was archived concurrently', async () => {
    const parent = folder('parent', 'archived-root');
    const archivedRoot = folder('archived-root', null, new Date(1));
    const rows = new Map([
      [parent.id, parent],
      [archivedRoot.id, archivedRoot],
    ]);
    const queryRaw = jest.fn((statement: { values?: unknown[] }) =>
      Promise.resolve(
        (statement.values ?? [])
          .filter((value): value is string => typeof value === 'string')
          .map((id) => ({ id })),
      ),
    );
    const findUnique = jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.get(where.id) ?? null),
    );
    const tx = {
      $queryRaw: queryRaw,
      fileNode: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      lockAndValidateActiveFileNodeParent(
        { isSqlite: () => false } as unknown as PrismaService,
        tx,
        parent.id,
        { spaceScope: 'workspace', workspaceId: 'workspace-a' },
      ),
    ).resolves.toBe(false);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
