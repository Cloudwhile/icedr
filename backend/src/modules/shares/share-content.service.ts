import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FileNodeResponse } from '../files/file-nodes.dto';
import { FileNodesService } from '../files/file-nodes.service';
import { ShareContentRepository } from './share-content.repository';
import { createShareError, SHARE_ERROR_CODES } from './share-errors';
import type {
  NormalizedCreateShareDto,
  ResolvedShareCreateScope,
  ShareContentMemberSnapshot,
  ShareCreatorAccess,
} from './share-content.types';
import type {
  CreateShareDto,
  ShareContentChange,
  ShareContentMemberRole,
  ShareContentScopeMode,
  ShareContentSummary,
  ShareDetailResponse,
  ShareFileNodeResponse,
  ShareResponse,
} from './shares.dto';

type ShareAction = 'download' | 'preview';
type ContentOptions = {
  includeItems?: boolean;
  includeSnapshots?: boolean;
};

const unavailablePreviewCapability = {
  supported: false,
  renderMode: 'metadata' as const,
  reason: 'missing-object' as const,
  maxPreviewBytes: null,
  sanitized: false,
  downloadOnly: true,
};

const rolePriority: Record<ShareContentMemberRole, number> = {
  descendant: 0,
  navigation: 1,
  selected: 2,
  root: 3,
};

@Injectable()
export class ShareContentService {
  constructor(
    private readonly contentRepository: ShareContentRepository,
    private readonly fileNodesService: FileNodesService,
  ) {}

  async resolveCreateScope(
    dto: CreateShareDto,
    access: ShareCreatorAccess = {},
  ): Promise<ResolvedShareCreateScope> {
    if (!dto.selection) return this.resolveLegacyCreateScope(dto, access);

    if (dto.selection.type === 'single-file') {
      if (!dto.selection.itemId?.trim()) {
        throw new BadRequestException('Single-file selection requires itemId');
      }
      const node = await this.requireCreatableNode(
        dto.selection.itemId,
        dto.workspaceId,
        access,
      );
      if (node.kind === 'folder') {
        throw new BadRequestException(
          'Single-file selection requires a file node',
        );
      }
      return this.createResolvedScope(dto, {
        allowedNodes: [node],
        dynamicRootId: null,
        mode: 'single-file',
        owner: node.owner,
        roles: new Map([[node.id, 'root']]),
        rootNodes: [node],
        scopeMode: 'items',
        title: node.name,
        workspaceId: node.workspaceId,
      });
    }

    if (dto.selection.type === 'multi-item') {
      const itemIds = this.uniqueIds(dto.selection.itemIds ?? []);
      if (itemIds.length === 0) {
        throw new BadRequestException('Multi-item selection requires itemIds');
      }
      return this.resolveMultiItemCreateScope(dto, itemIds, access);
    }

    const folderId = dto.selection.folderId?.trim();
    const visibility = dto.selection.visibility;
    if (!folderId || !visibility) {
      throw new BadRequestException(
        'Folder selection requires folderId and visibility',
      );
    }
    return this.resolveFolderCreateScope(
      dto,
      folderId,
      visibility,
      dto.selection.selectedItemIds ?? [],
      access,
    );
  }

  async withContent<T extends ShareResponse>(
    share: T,
    options: ContentOptions & { includeItems: true },
  ): Promise<T & ShareDetailResponse>;
  async withContent<T extends ShareResponse>(
    share: T,
    options?: ContentOptions,
  ): Promise<T & { contentSummary: ShareContentSummary }>;
  async withContent<T extends ShareResponse>(
    share: T,
    options: ContentOptions = {},
  ) {
    const content = await this.resolveContent(share, options.includeSnapshots);
    if (!options.includeItems) {
      return { ...share, contentSummary: content.summary };
    }
    return {
      ...share,
      contentSummary: content.summary,
      items: content.items,
    };
  }

  async requireNode(share: ShareResponse, nodeId: string, action: ShareAction) {
    const scopeMode = share.scopeMode ?? 'legacy';
    if (scopeMode !== 'entire-folder') {
      const allowed = await this.isFixedMember(share, nodeId);
      if (!allowed) throw new NotFoundException('File node not found');
    }

    const node = await this.fileNodesService.getFileNode(nodeId, {
      actorRole: 'admin',
    });
    if (!node || node.archivedAt || node.workspaceId !== share.workspaceId) {
      throw new NotFoundException('File node not found');
    }
    if (
      scopeMode === 'entire-folder' &&
      !(await this.isWithinDynamicFolder(share, node))
    ) {
      throw new NotFoundException('File node not found');
    }

    if (action === 'download' && !share.allowDownload) {
      throw createShareError(SHARE_ERROR_CODES.DOWNLOAD_DISABLED);
    }
    if (action === 'preview' && !share.allowPreview) {
      throw createShareError(SHARE_ERROR_CODES.PREVIEW_DISABLED);
    }
    if (scopeMode === 'entire-folder') {
      const existingMember = await this.contentRepository.findMember(
        share.token,
        node.id,
      );
      if (!existingMember) {
        await this.contentRepository.createMembersIfMissing(share.token, [
          this.toMemberSnapshot(
            node,
            node.id === share.dynamicRootId ? 'root' : 'descendant',
          ),
        ]);
      }
    }
    return node;
  }

  private async resolveFolderCreateScope(
    dto: CreateShareDto,
    folderId: string,
    visibility: 'entire-folder' | 'selected-items',
    selectedItemIds: string[],
    access: ShareCreatorAccess,
  ) {
    const root = await this.requireCreatableNode(
      folderId,
      dto.workspaceId,
      access,
    );
    if (root.kind !== 'folder') {
      throw new BadRequestException('Folder selection requires a folder node');
    }
    const tree = await this.loadActiveTree(root);
    const roles = new Map<string, ShareContentMemberRole>([[root.id, 'root']]);

    if (visibility === 'entire-folder') {
      this.collectDescendants(root.id, tree.byParent).forEach((node) =>
        this.setRole(roles, node.id, 'descendant'),
      );
    } else {
      const selectedIds = this.uniqueIds(selectedItemIds);
      if (selectedIds.length === 0) {
        throw new BadRequestException(
          'Selected folder content requires at least one item',
        );
      }
      const normalizedIds = this.removeCoveredSelections(
        selectedIds,
        root.id,
        tree.byId,
      );
      normalizedIds.forEach((nodeId) => {
        const node = tree.byId.get(nodeId);
        if (!node || node.id === root.id) {
          throw new BadRequestException(
            'Selected item is outside the shared folder',
          );
        }
        const ancestors = this.getAncestorsWithinRoot(node, root.id, tree.byId);
        ancestors.forEach((ancestor) =>
          this.setRole(roles, ancestor.id, 'navigation'),
        );
        this.setRole(roles, node.id, 'selected');
        if (node.kind === 'folder') {
          this.collectDescendants(node.id, tree.byParent).forEach(
            (descendant) => this.setRole(roles, descendant.id, 'descendant'),
          );
        }
      });
    }

    const allowedNodes = [...roles.keys()].map((id) => tree.byId.get(id)!);
    return this.createResolvedScope(dto, {
      allowedNodes,
      dynamicRootId: root.id,
      mode: 'folder',
      owner: root.owner,
      roles,
      rootNodes: [root],
      scopeMode: visibility,
      title: root.name,
      workspaceId: root.workspaceId,
    });
  }

  private async resolveMultiItemCreateScope(
    dto: CreateShareDto,
    itemIds: string[],
    access: ShareCreatorAccess,
  ) {
    const requested = await Promise.all(
      itemIds.map((id) =>
        this.requireCreatableNode(id, dto.workspaceId, access),
      ),
    );
    this.assertSameNodeScope(requested);
    const scopeRoot = requested[0];
    const tree = await this.loadActiveTree(requested);
    const normalizedRoots = requested.filter(
      (node) =>
        !requested.some(
          (candidate) =>
            candidate.id !== node.id &&
            candidate.kind === 'folder' &&
            this.isDescendant(node, candidate.id, tree.byId),
        ),
    );
    const roles = new Map<string, ShareContentMemberRole>();
    normalizedRoots.forEach((node) => {
      this.setRole(roles, node.id, 'root');
      if (node.kind === 'folder') {
        this.collectDescendants(node.id, tree.byParent).forEach((child) =>
          this.setRole(roles, child.id, 'descendant'),
        );
      }
    });
    const allowedNodes = [...roles.keys()].map((id) => tree.byId.get(id)!);
    const owner = normalizedRoots.every(
      (node) => node.owner === normalizedRoots[0].owner,
    )
      ? normalizedRoots[0].owner
      : '';
    return this.createResolvedScope(dto, {
      allowedNodes,
      dynamicRootId: null,
      mode: 'multi-file',
      owner,
      roles,
      rootNodes: normalizedRoots,
      scopeMode: 'items',
      title:
        dto.title?.trim() ||
        (normalizedRoots.length === 1
          ? normalizedRoots[0].name
          : 'Shared items'),
      workspaceId: scopeRoot.workspaceId,
    });
  }

  private async resolveLegacyCreateScope(
    dto: CreateShareDto,
    access: ShareCreatorAccess,
  ): Promise<ResolvedShareCreateScope> {
    const rootItemIds = this.uniqueIds(dto.rootItemIds ?? []);
    const allowedItemIds = this.uniqueIds(dto.allowedItemIds ?? []);
    if (
      !dto.mode ||
      !dto.title?.trim() ||
      !dto.owner?.trim() ||
      rootItemIds.length === 0 ||
      allowedItemIds.length === 0
    ) {
      throw new BadRequestException('Share selection is required');
    }
    if (
      rootItemIds.length !== (dto.rootItemIds?.length ?? 0) ||
      allowedItemIds.length !== (dto.allowedItemIds?.length ?? 0)
    ) {
      throw new BadRequestException('Share node ids must be unique');
    }
    const allowedSet = new Set(allowedItemIds);
    rootItemIds.forEach((id) => {
      if (!allowedSet.has(id)) {
        throw new BadRequestException(
          'Share roots must be included in the allowed item scope',
        );
      }
    });
    const nodes = await Promise.all(
      allowedItemIds.map((id) =>
        this.requireCreatableNode(id, dto.workspaceId, access),
      ),
    );
    this.assertSameNodeScope(nodes);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const roots = rootItemIds.map((id) => byId.get(id)!);
    if (dto.mode === 'single-file') {
      if (roots.length !== 1 || roots[0].kind === 'folder') {
        throw new BadRequestException(
          'Single-file shares require exactly one file root',
        );
      }
    }
    if (dto.mode === 'folder') {
      if (
        roots.length !== 1 ||
        roots[0].kind !== 'folder' ||
        dto.dynamicRootId !== roots[0].id
      ) {
        throw new BadRequestException(
          'Folder shares require one matching folder root',
        );
      }
    } else if (dto.dynamicRootId) {
      throw new BadRequestException(
        'Dynamic root is only available for folder shares',
      );
    }
    for (const node of nodes) {
      if (rootItemIds.includes(node.id)) continue;
      if (!(await this.isWithinLegacyRoots(node, roots, access))) {
        throw new BadRequestException(
          'File node is outside the selected share roots',
        );
      }
    }
    const roles = new Map<string, ShareContentMemberRole>(
      nodes.map((node) => [
        node.id,
        rootItemIds.includes(node.id) ? 'root' : 'selected',
      ]),
    );
    return this.createResolvedScope(dto, {
      allowedNodes: nodes,
      dynamicRootId: dto.dynamicRootId ?? null,
      mode: dto.mode,
      owner: dto.owner.trim(),
      roles,
      rootNodes: roots,
      scopeMode: 'legacy',
      title: dto.title.trim(),
      workspaceId: nodes[0].workspaceId,
    });
  }

  private createResolvedScope(
    dto: CreateShareDto,
    input: {
      allowedNodes: FileNodeResponse[];
      dynamicRootId: string | null;
      mode: NormalizedCreateShareDto['mode'];
      owner: string;
      roles: Map<string, ShareContentMemberRole>;
      rootNodes: FileNodeResponse[];
      scopeMode: ShareContentScopeMode;
      title: string;
      workspaceId: string;
    },
  ): ResolvedShareCreateScope {
    const members = input.allowedNodes.map((node) =>
      this.toMemberSnapshot(node, input.roles.get(node.id) ?? 'descendant'),
    );
    return {
      dto: {
        ...dto,
        workspaceId: input.workspaceId,
        title: input.title,
        mode: input.mode,
        owner: input.owner,
        rootItemIds: input.rootNodes.map((node) => node.id),
        allowedItemIds: input.allowedNodes.map((node) => node.id),
        dynamicRootId: input.dynamicRootId,
        scopeMode: input.scopeMode,
      },
      members,
    };
  }

  private async resolveContent(share: ShareResponse, includeSnapshots = false) {
    let members = (await this.contentRepository.listMembers(share.token)).map(
      (member) => this.toSnapshot(member),
    );
    if (members.length === 0) {
      members = await this.createLegacyFallbackMembers(share);
    }
    const storedById = new Map(
      members.map((member) => [member.nodeId, member]),
    );
    const storedNodes = await this.fileNodesService.getFileNodes(
      members.map((member) => member.nodeId),
      { actorRole: 'admin' },
    );
    const liveById = new Map(storedNodes.map((node) => [node.id, node]));
    let dynamicIds: Set<string> | null = null;

    if (share.scopeMode === 'entire-folder' && share.dynamicRootId) {
      const root =
        liveById.get(share.dynamicRootId) ??
        (await this.fileNodesService.getFileNode(share.dynamicRootId, {
          actorRole: 'admin',
        }));
      if (root && !root.archivedAt) {
        const tree = await this.loadActiveTree(root);
        const dynamicNodes = [
          root,
          ...this.collectDescendants(root.id, tree.byParent),
        ];
        dynamicIds = new Set(dynamicNodes.map((node) => node.id));
        const newMembers: ShareContentMemberSnapshot[] = [];
        dynamicNodes.forEach((node) => {
          liveById.set(node.id, node);
          if (!storedById.has(node.id)) {
            const snapshot = this.toMemberSnapshot(
              node,
              node.id === root.id ? 'root' : 'descendant',
            );
            storedById.set(node.id, snapshot);
            newMembers.push(snapshot);
          }
        });
        await this.contentRepository.createMembersIfMissing(
          share.token,
          newMembers,
        );
      } else {
        dynamicIds = new Set();
      }
    }

    const allMemberIds = new Set(storedById.keys());
    const rootIds = new Set(share.rootItemIds);
    const items = [...storedById.values()].map((member) => {
      const node = liveById.get(member.nodeId) ?? null;
      const availability = !node
        ? 'missing'
        : node.archivedAt
          ? 'archived'
          : dynamicIds && !dynamicIds.has(member.nodeId)
            ? 'out-of-scope'
            : 'available';
      const changes = this.getChanges(member, node, availability);
      const parentNodeId = rootIds.has(member.nodeId)
        ? null
        : share.scopeMode === 'entire-folder' && availability === 'available'
          ? node?.parentNodeId && allMemberIds.has(node.parentNodeId)
            ? node.parentNodeId
            : null
          : member.snapshotParentNodeId &&
              allMemberIds.has(member.snapshotParentNodeId)
            ? member.snapshotParentNodeId
            : null;
      const response: ShareFileNodeResponse = {
        id: member.nodeId,
        parentNodeId,
        name:
          availability === 'available'
            ? (node?.name ?? member.snapshotName ?? '')
            : (member.snapshotName ?? ''),
        kind: (node?.kind ??
          member.snapshotKind ??
          'other') as FileNodeResponse['kind'],
        mimeType: node?.mimeType ?? member.snapshotMimeType ?? '',
        sizeBytes:
          availability === 'available'
            ? (node?.sizeBytes ?? null)
            : this.toNumber(member.snapshotSizeBytes),
        hasContent: availability === 'available' && Boolean(node?.objectKey),
        previewCapability:
          availability === 'available' && node
            ? node.previewCapability
            : unavailablePreviewCapability,
        availability,
        changes,
        role: member.role,
        ...(node?.createdAt ? { createdAt: node.createdAt } : {}),
        ...(node?.updatedAt ? { updatedAt: node.updatedAt } : {}),
        ...(includeSnapshots && member.snapshotName
          ? { snapshotName: member.snapshotName }
          : {}),
      };
      return response;
    });
    return { items, summary: this.summarize(items, share) };
  }

  private summarize(
    items: ShareFileNodeResponse[],
    share: ShareResponse,
  ): ShareContentSummary {
    return items.reduce<ShareContentSummary>(
      (summary, item) => {
        if (item.availability !== 'available') {
          summary.unavailableCount += 1;
          return summary;
        }
        if (item.changes.length > 0) summary.changedCount += 1;
        if (
          share.mode === 'folder' &&
          item.role === 'root' &&
          item.id === share.dynamicRootId
        ) {
          return summary;
        }
        if (item.kind === 'folder') summary.folderCount += 1;
        else {
          summary.fileCount += 1;
          summary.totalSizeBytes += item.sizeBytes ?? 0;
        }
        return summary;
      },
      {
        fileCount: 0,
        folderCount: 0,
        totalSizeBytes: 0,
        unavailableCount: 0,
        changedCount: 0,
      },
    );
  }

  private getChanges(
    member: ShareContentMemberSnapshot,
    node: FileNodeResponse | null,
    availability: string,
  ) {
    if (!node || availability !== 'available') return [];
    const changes: ShareContentChange[] = [];
    if (member.snapshotName && member.snapshotName !== node.name) {
      changes.push('renamed');
    }
    if (member.snapshotParentNodeId !== node.parentNodeId) {
      changes.push('moved');
    }
    return changes;
  }

  private async createLegacyFallbackMembers(
    share: ShareResponse,
  ): Promise<ShareContentMemberSnapshot[]> {
    const ids = this.uniqueIds([...share.rootItemIds, ...share.allowedItemIds]);
    const nodes = await this.fileNodesService.getFileNodes(ids, {
      actorRole: 'admin',
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const roots = new Set(share.rootItemIds);
    return ids.map((id): ShareContentMemberSnapshot => {
      const node = byId.get(id);
      const role: ShareContentMemberRole = roots.has(id) ? 'root' : 'selected';
      return node
        ? this.toMemberSnapshot(node, role)
        : {
            nodeId: id,
            role,
            snapshotKind: null,
            snapshotMimeType: null,
            snapshotName: null,
            snapshotParentNodeId: null,
            snapshotSizeBytes: null,
          };
    });
  }

  private async isFixedMember(share: ShareResponse, nodeId: string) {
    const member = await this.contentRepository.findMember(share.token, nodeId);
    return Boolean(member) || share.allowedItemIds.includes(nodeId);
  }

  private async isWithinDynamicFolder(
    share: ShareResponse,
    node: FileNodeResponse,
  ) {
    const rootId = share.dynamicRootId;
    if (!rootId) return false;
    const root = await this.fileNodesService.getFileNode(rootId, {
      actorRole: 'admin',
    });
    if (
      !root ||
      root.archivedAt ||
      root.kind !== 'folder' ||
      root.workspaceId !== share.workspaceId ||
      node.workspaceId !== root.workspaceId ||
      node.spaceScope !== root.spaceScope ||
      (root.spaceScope === 'personal' && node.ownerUserId !== root.ownerUserId)
    ) {
      return false;
    }
    if (node.id === rootId) return true;
    const visited = new Set([node.id]);
    let parentId = node.parentNodeId;
    while (parentId) {
      if (parentId === rootId) return true;
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      const parent = await this.fileNodesService.getFileNode(parentId, {
        actorRole: 'admin',
      });
      if (!parent || parent.archivedAt) return false;
      parentId = parent.parentNodeId;
    }
    return false;
  }

  private async requireCreatableNode(
    nodeId: string,
    workspaceId: string | undefined,
    access: ShareCreatorAccess,
  ) {
    const node = await this.fileNodesService.getFileNode(nodeId, access);
    if (!node) throw new NotFoundException('File node not found');
    if (
      node.spaceScope === 'personal' &&
      access.actorUserId &&
      access.actorRole !== 'admin' &&
      access.actorRole !== 'owner' &&
      node.ownerUserId !== access.actorUserId
    ) {
      throw new NotFoundException('File node not found');
    }
    if (node.archivedAt) {
      throw new BadRequestException('Archived file nodes cannot be shared');
    }
    if (workspaceId && node.workspaceId !== workspaceId) {
      throw new BadRequestException('File node belongs to another workspace');
    }
    return node;
  }

  private async loadActiveTree(input: FileNodeResponse | FileNodeResponse[]) {
    const roots = Array.isArray(input) ? input : [input];
    const scopeRoot = roots[0];
    this.assertSameNodeScope(roots);

    const byId = new Map(roots.map((node) => [node.id, node]));
    const byParent = new Map<string, FileNodeResponse[]>();
    const pendingFolderIds = roots
      .filter((node) => node.kind === 'folder')
      .map((node) => node.id);
    const scheduledFolderIds = new Set(pendingFolderIds);

    for (const parentNodeId of pendingFolderIds) {
      const children = await this.fileNodesService.listFileNodes(
        scopeRoot.workspaceId,
        parentNodeId,
        {
          ownerUserId:
            scopeRoot.spaceScope === 'personal'
              ? scopeRoot.ownerUserId
              : undefined,
          spaceScope: scopeRoot.spaceScope,
          state: 'active',
        },
      );
      const siblings = byParent.get(parentNodeId) ?? [];
      for (const child of children) {
        if (child.parentNodeId !== parentNodeId) {
          throw new BadRequestException('File node hierarchy is invalid');
        }
        this.assertSameNodeScope([scopeRoot, child]);
        if (siblings.some((node) => node.id === child.id)) {
          throw new BadRequestException('File node hierarchy contains a cycle');
        }
        const existing = byId.get(child.id);
        if (existing && existing.parentNodeId !== child.parentNodeId) {
          throw new BadRequestException('File node hierarchy is invalid');
        }
        byId.set(child.id, child);
        siblings.push(child);
        if (child.kind === 'folder' && !scheduledFolderIds.has(child.id)) {
          scheduledFolderIds.add(child.id);
          pendingFolderIds.push(child.id);
        }
      }
      byParent.set(parentNodeId, siblings);
    }

    this.assertTreeAcyclic(byId);
    return { byId, byParent };
  }

  private assertTreeAcyclic(byId: Map<string, FileNodeResponse>) {
    const resolved = new Set<string>();
    byId.forEach((node) => {
      if (resolved.has(node.id)) return;
      const path = new Set<string>();
      let current: FileNodeResponse | undefined = node;
      while (current && !resolved.has(current.id)) {
        if (path.has(current.id)) {
          throw new BadRequestException('File node hierarchy contains a cycle');
        }
        path.add(current.id);
        current = current.parentNodeId
          ? byId.get(current.parentNodeId)
          : undefined;
      }
      path.forEach((nodeId) => resolved.add(nodeId));
    });
  }

  private collectDescendants(
    rootId: string,
    byParent: Map<string, FileNodeResponse[]>,
  ) {
    const collected: FileNodeResponse[] = [];
    const visited = new Set([rootId]);
    const visit = (parentId: string) => {
      (byParent.get(parentId) ?? []).forEach((node) => {
        if (visited.has(node.id)) {
          throw new BadRequestException('File node hierarchy contains a cycle');
        }
        visited.add(node.id);
        collected.push(node);
        if (node.kind === 'folder') visit(node.id);
      });
    };
    visit(rootId);
    return collected;
  }

  private removeCoveredSelections(
    selectedIds: string[],
    rootId: string,
    byId: Map<string, FileNodeResponse>,
  ) {
    const selected = new Set(selectedIds);
    selectedIds.forEach((id) => {
      const node = byId.get(id);
      if (!node || !this.isDescendant(node, rootId, byId)) {
        throw new BadRequestException(
          'Selected item is outside the shared folder',
        );
      }
    });
    return selectedIds.filter((id) => {
      let parentId = byId.get(id)?.parentNodeId;
      const visited = new Set([id]);
      while (parentId && parentId !== rootId) {
        if (visited.has(parentId)) {
          throw new BadRequestException('File node hierarchy contains a cycle');
        }
        visited.add(parentId);
        if (selected.has(parentId) && byId.get(parentId)?.kind === 'folder') {
          return false;
        }
        parentId = byId.get(parentId)?.parentNodeId ?? null;
      }
      return true;
    });
  }

  private getAncestorsWithinRoot(
    node: FileNodeResponse,
    rootId: string,
    byId: Map<string, FileNodeResponse>,
  ) {
    const ancestors: FileNodeResponse[] = [];
    const visited = new Set([node.id]);
    let parentId = node.parentNodeId;
    while (parentId && parentId !== rootId) {
      if (visited.has(parentId)) {
        throw new BadRequestException('File node hierarchy contains a cycle');
      }
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        throw new BadRequestException(
          'Selected item is outside the shared folder',
        );
      }
      ancestors.unshift(parent);
      parentId = parent.parentNodeId;
    }
    if (parentId !== rootId) {
      throw new BadRequestException(
        'Selected item is outside the shared folder',
      );
    }
    return ancestors;
  }

  private isDescendant(
    node: FileNodeResponse,
    rootId: string,
    byId: Map<string, FileNodeResponse>,
  ) {
    const visited = new Set([node.id]);
    let parentId = node.parentNodeId;
    while (parentId) {
      if (parentId === rootId) return true;
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentNodeId ?? null;
    }
    return false;
  }

  private async isWithinLegacyRoots(
    node: FileNodeResponse,
    roots: FileNodeResponse[],
    access: ShareCreatorAccess,
  ) {
    const rootIds = new Set(roots.map((root) => root.id));
    const visited = new Set([node.id]);
    let parentId = node.parentNodeId;
    while (parentId) {
      if (rootIds.has(parentId)) return true;
      if (visited.has(parentId)) {
        throw new BadRequestException('File node hierarchy contains a cycle');
      }
      visited.add(parentId);
      const parent = await this.fileNodesService.getFileNode(parentId, access);
      if (!parent || parent.archivedAt) return false;
      parentId = parent.parentNodeId;
    }
    return false;
  }

  private assertSameNodeScope(nodes: FileNodeResponse[]) {
    const first = nodes[0];
    if (
      nodes.some(
        (node) =>
          node.workspaceId !== first.workspaceId ||
          node.spaceScope !== first.spaceScope ||
          (first.spaceScope === 'personal' &&
            node.ownerUserId !== first.ownerUserId),
      )
    ) {
      throw new BadRequestException(
        'Shared file nodes must use the same workspace scope',
      );
    }
  }

  private toMemberSnapshot(
    node: FileNodeResponse,
    role: ShareContentMemberRole,
  ): ShareContentMemberSnapshot {
    return {
      nodeId: node.id,
      role,
      snapshotParentNodeId: node.parentNodeId,
      snapshotName: node.name,
      snapshotKind: node.kind,
      snapshotMimeType: node.mimeType,
      snapshotSizeBytes:
        node.sizeBytes === null ? null : BigInt(node.sizeBytes),
    };
  }

  private toSnapshot(member: {
    nodeId: string;
    role: string;
    snapshotKind: string | null;
    snapshotMimeType: string | null;
    snapshotName: string | null;
    snapshotParentNodeId: string | null;
    snapshotSizeBytes: bigint | null;
  }): ShareContentMemberSnapshot {
    return {
      nodeId: member.nodeId,
      role: this.isMemberRole(member.role) ? member.role : 'selected',
      snapshotKind: member.snapshotKind,
      snapshotMimeType: member.snapshotMimeType,
      snapshotName: member.snapshotName,
      snapshotParentNodeId: member.snapshotParentNodeId,
      snapshotSizeBytes: member.snapshotSizeBytes,
    };
  }

  private setRole(
    roles: Map<string, ShareContentMemberRole>,
    nodeId: string,
    role: ShareContentMemberRole,
  ) {
    const current = roles.get(nodeId);
    if (!current || rolePriority[role] > rolePriority[current]) {
      roles.set(nodeId, role);
    }
  }

  private uniqueIds(ids: string[]) {
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  }

  private isMemberRole(value: string): value is ShareContentMemberRole {
    return value in rolePriority;
  }

  private toNumber(value: bigint | null) {
    if (value === null) return null;
    return Number(
      value > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : value,
    );
  }
}
