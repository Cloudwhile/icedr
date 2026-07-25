import { NotFoundException } from '@nestjs/common';
import type { FileNodeResponse } from '../files/file-nodes.dto';
import type { FileNodesService } from '../files/file-nodes.service';
import { resolveFilePreviewCapability } from '../files/file-preview-policy';
import type { ShareContentRepository } from './share-content.repository';
import { ShareContentService } from './share-content.service';
import type { ShareContentMemberSnapshot } from './share-content.types';
import { resolveShareDownloadPolicy } from './share-download-policy';
import type { CreateShareDto, ShareResponse } from './shares.dto';

const policy = {
  waitValue: 0,
  waitUnit: 'seconds' as const,
  speedValue: 0,
  speedUnit: 'KB/s' as const,
  expiresValue: 7,
  expiresUnit: 'days' as const,
  downloadLimit: '',
  allowedDomain: '',
  emailAllowlist: [],
  maxDownloads: 0,
  maxViews: 0,
  rateLimitProfile: '',
};

function createNode(
  id: string,
  input: Partial<FileNodeResponse> = {},
): FileNodeResponse {
  const base = {
    id,
    workspaceId: 'workspace-default',
    spaceScope: 'workspace' as const,
    parentNodeId: null,
    name: `${id}.txt`,
    kind: 'doc' as const,
    mimeType: 'text/plain',
    sizeBytes: 100,
    objectKey: `objects/${id}`,
    owner: 'Mina',
    ownerUserId: 'user-a',
    starred: false,
    archivedAt: null,
    archivedBy: null,
    originalParentNodeId: null,
    originalPath: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const node = { ...base, ...input };
  return {
    ...node,
    previewCapability: resolveFilePreviewCapability(node),
  };
}

function folder(
  id: string,
  parentNodeId: string | null = null,
  input: Partial<FileNodeResponse> = {},
) {
  return createNode(id, {
    parentNodeId,
    name: id,
    kind: 'folder',
    mimeType: 'inode/directory',
    sizeBytes: null,
    objectKey: null,
    ...input,
  });
}

function createDto(selection: CreateShareDto['selection']): CreateShareDto {
  return {
    workspaceId: 'workspace-default',
    selection,
    allowDownload: true,
    allowPreview: true,
    expiresDays: 7,
    remark: '',
    policy,
  };
}

function createShare(input: Partial<ShareResponse> = {}): ShareResponse {
  return {
    token: 's_scope',
    url: 'http://localhost/share/s/s_scope',
    workspaceId: 'workspace-default',
    title: 'Root',
    mode: 'folder',
    owner: 'Mina',
    rootItemIds: ['root'],
    allowedItemIds: ['root', 'selected'],
    dynamicRootId: 'root',
    allowDownload: true,
    allowPreview: true,
    expiresDays: 7,
    remark: '',
    policy,
    downloadPolicy: resolveShareDownloadPolicy(policy),
    scopeMode: 'selected-items',
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
    ...input,
  };
}

describe('ShareContentService', () => {
  function createHarness(initialNodes: FileNodeResponse[]) {
    const nodes = new Map(initialNodes.map((node) => [node.id, node]));
    const members = new Map<string, ShareContentMemberSnapshot[]>();
    const contentRepository = {
      listMembers: jest.fn((token: string) =>
        Promise.resolve(members.get(token) ?? []),
      ),
      findMember: jest.fn((token: string, nodeId: string) =>
        Promise.resolve(
          members.get(token)?.find((member) => member.nodeId === nodeId) ??
            null,
        ),
      ),
      createMembersIfMissing: jest.fn(
        (token: string, snapshots: ShareContentMemberSnapshot[]) => {
          const existing = members.get(token) ?? [];
          const existingIds = new Set(existing.map((member) => member.nodeId));
          const additions = snapshots.filter(
            (member) => !existingIds.has(member.nodeId),
          );
          members.set(token, [...existing, ...additions]);
          return Promise.resolve({ count: additions.length });
        },
      ),
    };
    const fileNodesService = {
      getFileNode: jest.fn((id: string) =>
        Promise.resolve(nodes.get(id) ?? null),
      ),
      getFileNodes: jest.fn((ids: string[]) =>
        Promise.resolve(
          ids
            .map((id) => nodes.get(id))
            .filter((node): node is FileNodeResponse => Boolean(node)),
        ),
      ),
      listFileNodes: jest.fn(
        (
          workspaceId?: string,
          _parentNodeId?: string | null,
          options: { ownerUserId?: string; spaceScope?: string } = {},
        ) =>
          Promise.resolve(
            [...nodes.values()].filter(
              (node) =>
                !node.archivedAt &&
                (!workspaceId || node.workspaceId === workspaceId) &&
                (!options.spaceScope ||
                  node.spaceScope === options.spaceScope) &&
                (!options.ownerUserId ||
                  node.ownerUserId === options.ownerUserId),
            ),
          ),
      ),
    };
    const service = new ShareContentService(
      contentRepository as unknown as ShareContentRepository,
      fileNodesService as unknown as FileNodesService,
    );
    return { contentRepository, fileNodesService, members, nodes, service };
  }

  it('derives an entire-folder scope on the server', async () => {
    const root = folder('root');
    const file = createNode('file', { parentNodeId: root.id });
    const childFolder = folder('child', root.id);
    const nested = createNode('nested', { parentNodeId: childFolder.id });
    const { service } = createHarness([root, file, childFolder, nested]);

    const resolved = await service.resolveCreateScope(
      createDto({
        type: 'folder',
        folderId: root.id,
        visibility: 'entire-folder',
      }),
      { actorRole: 'member', actorUserId: 'user-a' },
    );

    expect(resolved.dto).toMatchObject({
      scopeMode: 'entire-folder',
      rootItemIds: ['root'],
      dynamicRootId: 'root',
    });
    expect(new Set(resolved.dto.allowedItemIds)).toEqual(
      new Set(['root', 'file', 'child', 'nested']),
    );
    expect(
      Object.fromEntries(
        resolved.members.map((member) => [member.nodeId, member.role]),
      ),
    ).toEqual({
      root: 'root',
      file: 'descendant',
      child: 'descendant',
      nested: 'descendant',
    });
  });

  it('includes only selected content, navigation ancestors, and selected folder snapshots', async () => {
    const root = folder('root');
    const privateFile = createNode('private', { parentNodeId: root.id });
    const navigation = folder('navigation', root.id);
    const selectedFile = createNode('selected', {
      parentNodeId: navigation.id,
    });
    const selectedFolder = folder('selected-folder', root.id);
    const nested = createNode('nested', { parentNodeId: selectedFolder.id });
    const { service } = createHarness([
      root,
      privateFile,
      navigation,
      selectedFile,
      selectedFolder,
      nested,
    ]);

    const resolved = await service.resolveCreateScope(
      createDto({
        type: 'folder',
        folderId: root.id,
        visibility: 'selected-items',
        selectedItemIds: [selectedFile.id, selectedFolder.id, nested.id],
      }),
    );

    expect(new Set(resolved.dto.allowedItemIds)).toEqual(
      new Set(['root', 'navigation', 'selected', 'selected-folder', 'nested']),
    );
    expect(resolved.dto.allowedItemIds).not.toContain('private');
    expect(
      Object.fromEntries(
        resolved.members.map((member) => [member.nodeId, member.role]),
      ),
    ).toEqual({
      root: 'root',
      navigation: 'navigation',
      selected: 'selected',
      'selected-folder': 'selected',
      nested: 'descendant',
    });
  });

  it('keeps a fixed selected item authorized after it moves', async () => {
    const root = folder('root');
    const moved = createNode('selected', { parentNodeId: 'outside' });
    const { members, service } = createHarness([root, moved]);
    members.set('s_scope', [
      {
        nodeId: moved.id,
        role: 'selected',
        snapshotParentNodeId: root.id,
        snapshotName: moved.name,
        snapshotKind: moved.kind,
        snapshotMimeType: moved.mimeType,
        snapshotSizeBytes: BigInt(moved.sizeBytes ?? 0),
      },
    ]);

    await expect(
      service.requireNode(createShare(), moved.id, 'download'),
    ).resolves.toMatchObject({ id: moved.id });
  });

  it('denies a node after it moves outside an entire-folder scope', async () => {
    const root = folder('root');
    const moved = createNode('selected', { parentNodeId: 'outside' });
    const { service } = createHarness([root, moved]);

    await expect(
      service.requireNode(
        createShare({
          scopeMode: 'entire-folder',
          allowedItemIds: ['root', 'selected'],
        }),
        moved.id,
        'download',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not reveal policy or lifecycle state for nodes outside the scope', async () => {
    const root = folder('root');
    const outside = createNode('outside');
    const archived = createNode('archived', {
      parentNodeId: root.id,
      archivedAt: new Date().toISOString(),
    });
    const { members, service } = createHarness([root, outside, archived]);
    members.set('s_scope', [
      snapshot(root, 'root'),
      snapshot(archived, 'selected'),
    ]);

    await expect(
      service.requireNode(
        createShare({ allowDownload: false }),
        outside.id,
        'download',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.requireNode(createShare(), archived.id, 'download'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokes an entire-folder scope when its root is archived', async () => {
    const root = folder('root', null, {
      archivedAt: new Date().toISOString(),
    });
    const child = createNode('child', { parentNodeId: root.id });
    const { service } = createHarness([root, child]);

    await expect(
      service.requireNode(
        createShare({ scopeMode: 'entire-folder' }),
        child.id,
        'download',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a dynamic descendant from another workspace', async () => {
    const root = folder('root');
    const crossWorkspace = createNode('cross-workspace', {
      workspaceId: 'workspace-other',
      parentNodeId: root.id,
    });
    const { service } = createHarness([root, crossWorkspace]);

    await expect(
      service.requireNode(
        createShare({ scopeMode: 'entire-folder' }),
        crossWorkspace.id,
        'download',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns safe lifecycle states and authoritative content statistics', async () => {
    const root = folder('root');
    const renamedAndMoved = createNode('selected', {
      name: 'Current.txt',
      parentNodeId: 'root',
      sizeBytes: 250,
    });
    const archived = createNode('archived', {
      parentNodeId: root.id,
      archivedAt: new Date().toISOString(),
    });
    const { members, service } = createHarness([
      root,
      renamedAndMoved,
      archived,
    ]);
    members.set('s_scope', [
      snapshot(root, 'root'),
      {
        ...snapshot(renamedAndMoved, 'selected'),
        snapshotName: 'Original.txt',
        snapshotParentNodeId: 'old-parent',
      },
      snapshot(archived, 'selected'),
      {
        nodeId: 'missing',
        role: 'selected',
        snapshotParentNodeId: root.id,
        snapshotName: 'Removed.txt',
        snapshotKind: 'doc',
        snapshotMimeType: 'text/plain',
        snapshotSizeBytes: 90n,
      },
    ]);

    const detail = await service.withContent(createShare(), {
      includeItems: true,
      includeSnapshots: true,
    });

    expect(detail.contentSummary).toEqual({
      fileCount: 1,
      folderCount: 0,
      totalSizeBytes: 250,
      unavailableCount: 2,
      changedCount: 1,
    });
    expect(detail.items.find((item) => item.id === 'selected')).toMatchObject({
      availability: 'available',
      changes: ['renamed', 'moved'],
      name: 'Current.txt',
      parentNodeId: null,
      snapshotName: 'Original.txt',
    });
    expect(detail.items.find((item) => item.id === 'archived')).toMatchObject({
      availability: 'archived',
      hasContent: false,
    });
    expect(detail.items.find((item) => item.id === 'missing')).toMatchObject({
      availability: 'missing',
      name: 'Removed.txt',
      hasContent: false,
    });
    expect(JSON.stringify(detail.items)).not.toContain('originalPath');
    expect(JSON.stringify(detail.items)).not.toContain('ownerUserId');
    expect(JSON.stringify(detail.items)).not.toContain('workspaceId');
  });

  it('counts single-file and multi-item roots while excluding a folder container root', async () => {
    const rootFile = createNode('root-file', { sizeBytes: 320 });
    const rootFolder = folder('root-folder');
    const nested = createNode('nested', {
      parentNodeId: rootFolder.id,
      sizeBytes: 180,
    });
    const { members, service } = createHarness([rootFile, rootFolder, nested]);

    members.set('single', [snapshot(rootFile, 'root')]);
    members.set('folder', [
      snapshot(rootFolder, 'root'),
      snapshot(nested, 'descendant'),
    ]);

    const single = await service.withContent(
      createShare({
        token: 'single',
        mode: 'single-file',
        rootItemIds: [rootFile.id],
        allowedItemIds: [rootFile.id],
        dynamicRootId: null,
        scopeMode: 'items',
      }),
    );
    const folderDetail = await service.withContent(
      createShare({
        token: 'folder',
        rootItemIds: [rootFolder.id],
        allowedItemIds: [rootFolder.id, nested.id],
        dynamicRootId: rootFolder.id,
      }),
    );

    expect(single.contentSummary).toEqual({
      fileCount: 1,
      folderCount: 0,
      totalSizeBytes: 320,
      unavailableCount: 0,
      changedCount: 0,
    });
    expect(folderDetail.contentSummary).toEqual({
      fileCount: 1,
      folderCount: 0,
      totalSizeBytes: 180,
      unavailableCount: 0,
      changedCount: 0,
    });
  });

  it('persists newly discovered dynamic members so later moves remain traceable', async () => {
    const root = folder('root');
    const added = createNode('added-later', {
      parentNodeId: root.id,
      sizeBytes: 140,
    });
    const { contentRepository, members, nodes, service } = createHarness([
      root,
      added,
    ]);
    members.set('dynamic', [snapshot(root, 'root')]);
    const share = createShare({
      token: 'dynamic',
      scopeMode: 'entire-folder',
      rootItemIds: [root.id],
      allowedItemIds: [root.id],
      dynamicRootId: root.id,
    });

    const initial = await service.withContent(share, { includeItems: true });

    expect(initial.items.find((item) => item.id === added.id)).toMatchObject({
      availability: 'available',
      role: 'descendant',
    });
    expect(contentRepository.createMembersIfMissing).toHaveBeenCalledWith(
      'dynamic',
      [expect.objectContaining({ nodeId: added.id, role: 'descendant' })],
    );

    nodes.set(added.id, { ...added, parentNodeId: 'outside' });
    const moved = await service.withContent(share, { includeItems: true });

    expect(moved.items.find((item) => item.id === added.id)).toMatchObject({
      availability: 'out-of-scope',
      name: added.name,
      role: 'descendant',
    });
    expect(moved.contentSummary.unavailableCount).toBe(1);
  });
});

function snapshot(
  node: FileNodeResponse,
  role: ShareContentMemberSnapshot['role'],
): ShareContentMemberSnapshot {
  return {
    nodeId: node.id,
    role,
    snapshotParentNodeId: node.parentNodeId,
    snapshotName: node.name,
    snapshotKind: node.kind,
    snapshotMimeType: node.mimeType,
    snapshotSizeBytes: node.sizeBytes === null ? null : BigInt(node.sizeBytes),
  };
}
