import type { PrismaService } from '../../database/prisma.service';
import { completeFileNodeUploadWrite } from './file-upload-completion-write';

describe('completeFileNodeUploadWrite hierarchy integrity', () => {
  it('does not attach a completed upload to an archived parent', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: 'parent' }])),
      fileNode: {
        create,
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 'parent',
            workspaceId: 'workspace-a',
            spaceScope: 'workspace',
            parentNodeId: null,
            kind: 'folder',
            archivedAt: new Date(1),
          }),
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
      isSqlite: () => false,
    } as unknown as PrismaService;

    await expect(
      completeFileNodeUploadWrite(
        prisma,
        {} as never,
        {} as never,
        () => 'doc',
        {
          fileName: 'report.txt',
          objectKey: 'objects/report',
          parentNodeId: 'parent',
          sizeBytes: 12,
          workspaceId: 'workspace-a',
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'UPLOAD_PARENT_CHANGED' },
    });

    expect(create).not.toHaveBeenCalled();
  });
});
