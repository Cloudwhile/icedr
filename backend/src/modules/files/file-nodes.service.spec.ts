import { NotFoundException } from '@nestjs/common';
import { getFileNameConflictKey } from '../../common/security/file-name-policy';
import { createNode } from './file-upload-test-fixtures.helper';
import {
  createFileNodesServiceTestHarness,
  type FileNodesServiceTestHarness,
} from './file-upload-test-harness.helper';

describe('FileNodesService facade', () => {
  let repository: FileNodesServiceTestHarness['repository'];
  let service: FileNodesServiceTestHarness['service'];

  beforeEach(() => {
    ({ repository, service } = createFileNodesServiceTestHarness());
  });

  it('lists file nodes from the repository', async () => {
    const nodes = await service.listFileNodes('workspace-default');

    expect(nodes.some((node) => node.id === 'roadmap')).toBe(true);
  });

  it('keeps repeated generated copy names unique and within the byte limit', async () => {
    const sourceName = `${'界'.repeat(83)}ab.txt`;
    expect(Buffer.byteLength(sourceName, 'utf8')).toBe(255);
    const source = createNode({
      id: 'long-name-source',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: sourceName,
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey: 'uploads/workspace-default/root/long-name-source.txt',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    jest.spyOn(repository, 'findById').mockResolvedValue(source);

    const first = await service.copyFileNode(source.id, {});
    const second = await service.copyFileNode(source.id, {});

    for (const copy of [first, second]) {
      expect(copy.name.endsWith('.txt')).toBe(true);
      expect(Buffer.byteLength(copy.name, 'utf8')).toBeLessThanOrEqual(255);
    }
    expect(
      new Set([first.name, second.name].map(getFileNameConflictKey)).size,
    ).toBe(2);
  });

  it('prevents member IDOR across personal spaces', async () => {
    const memberAccess = { actorRole: 'member', actorUserId: 'user-a' };

    await expect(
      service.getFileNode('personal-b', memberAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createDownloadIntent('personal-b', {}, memberAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.renameFileNode(
        'personal-b',
        { name: 'Stolen.txt' },
        memberAccess,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createFolder({
        workspaceId: 'workspace-default',
        name: 'Injected Folder',
        parentNodeId: 'personal-folder-b',
        spaceScope: 'personal',
        ownerUserId: 'user-a',
        ...memberAccess,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getFileNode('personal-b', {
        actorRole: 'admin',
        actorUserId: 'admin-user',
      }),
    ).resolves.toMatchObject({ id: 'personal-b' });
  });

  it('preserves the oversized text edit error message', async () => {
    await expect(service.getFileNodeContent('large-log')).rejects.toThrow(
      'File is too large to edit as text',
    );
  });
});
