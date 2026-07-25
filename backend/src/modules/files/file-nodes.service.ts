import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Readable } from 'stream';
import {
  createSuffixedFileName,
  getFileNameConflictKey,
  normalizeFileName,
} from '../../common/security/file-name-policy';
import { StorageService } from '../storage/storage.service';
import { createFileObjectKey } from '../storage/storage-object-keys';
import { FileDownloadPreviewService } from './file-download-preview.service';
import {
  type BatchDownloadIntentResponse,
  type BatchFileNodeIdsDto,
  type BatchFileNodeOperationResponse,
  type BatchMoveFileNodesDto,
  type CompleteUploadPartDto,
  type CompleteUploadDto,
  type CopyFileNodeDto,
  type CreateDownloadIntentDto,
  type CreateFolderDto,
  type CreateUploadIntentDto,
  type FileNodeKind,
  type FileNodeListState,
  type FileNodeResponse,
  type FileNodeSpaceScope,
  type FilePolicyResponse,
  type MoveFileNodeDto,
  type RenameFileNodeDto,
  type RestoreFileNodeDto,
  type SearchFileNodesQueryDto,
  type UpdateFileNodeContentDto,
  type UpdateFileNodeStateDto,
  type UpdateFilePolicyDto,
  type UploadChunkResponse,
  type UploadIntentResponse,
  type UploadPartIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import { resolveFilePreviewCapability } from './file-preview-policy';
import { FileUploadService } from './file-upload.service';

const trashCleanupThrottleMs = 5 * 60 * 1000;
type AuditMetadata = Record<string, unknown>;
type FileAccessOptions = {
  actorRole?: string;
  actorUserId?: string;
};
type FileAuditOptions = FileAccessOptions & {
  actor?: string;
  auditMetadata?: AuditMetadata;
};

@Injectable()
export class FileNodesService {
  private lastTrashCleanupAt = 0;

  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
    private readonly fileUploadService: FileUploadService,
    private readonly fileDownloadPreviewService: FileDownloadPreviewService,
  ) {}

  async listFileNodes(
    workspaceId?: string,
    parentNodeId?: string | null,
    options: { ownerUserId?: string; spaceScope?: string; state?: string } = {},
  ) {
    const state = this.normalizeListState(options.state);
    const spaceScope = this.normalizeSpaceScope(options.spaceScope);
    if (state !== 'active') {
      await this.cleanupExpiredTrashIfDue();
    }
    return this.fileNodesRepository.list(workspaceId, parentNodeId, state, {
      ownerUserId: spaceScope === 'personal' ? options.ownerUserId : undefined,
      spaceScope,
    });
  }

  async searchFileNodes(
    query: SearchFileNodesQueryDto,
    options: Pick<FileAuditOptions, 'auditMetadata'> & {
      ownerUserId?: string;
    } = {},
  ) {
    const spaceScope = this.normalizeSpaceScope(query.spaceScope);
    const result = await this.fileNodesRepository.search(
      { ...query, spaceScope },
      {
        ownerUserId:
          spaceScope === 'personal' ? options.ownerUserId : undefined,
      },
    );
    await this.fileNodesRepository.recordAudit(
      'file.search_performed',
      query.workspaceId ?? 'workspace-default',
      {
        metadata: {
          ...options.auditMetadata,
          query: query.query ?? '',
          spaceScope,
          state: query.state ?? 'active',
          type: query.type ?? 'all',
        },
        nodeId: null,
        workspaceId: query.workspaceId ?? 'workspace-default',
      },
    );
    return result;
  }

  async getFileNode(id: string, access: FileAccessOptions = {}) {
    const node = await this.fileNodesRepository.findById(id);
    if (!node) return null;
    this.assertNodeAccess(node, access);
    return node;
  }

  async getFileNodes(ids: string[], access: FileAccessOptions = {}) {
    const nodes = await this.fileNodesRepository.findByIds(ids);
    nodes.forEach((node) => this.assertNodeAccess(node, access));
    return nodes;
  }

  getFilePolicy(): Promise<FilePolicyResponse> {
    return this.fileNodesRepository.getPolicy();
  }

  updateFilePolicy(dto: UpdateFilePolicyDto): Promise<FilePolicyResponse> {
    return this.fileNodesRepository.updatePolicy(dto);
  }

  createUploadIntent(
    dto: CreateUploadIntentDto,
    options: {
      actorRole?: string;
      auditMetadata?: AuditMetadata;
      ownerUserId?: string;
    } = {},
  ): Promise<UploadIntentResponse> {
    return this.fileUploadService.createUploadIntent(dto, options);
  }

  createUploadPartIntent(
    sessionId: string,
    partIndex: number,
    ownerUserId?: string,
  ): Promise<UploadPartIntentResponse> {
    return this.fileUploadService.createUploadPartIntent(
      sessionId,
      partIndex,
      ownerUserId,
    );
  }

  completeUploadPart(
    sessionId: string,
    partIndex: number,
    dto: CompleteUploadPartDto,
    ownerUserId?: string,
  ): Promise<UploadChunkResponse> {
    return this.fileUploadService.completeUploadPart(
      sessionId,
      partIndex,
      dto,
      ownerUserId,
    );
  }

  uploadChunk(
    sessionId: string,
    partIndex: number,
    stream: Readable,
    ownerUserId?: string,
  ): Promise<UploadChunkResponse> {
    return this.fileUploadService.uploadChunk(
      sessionId,
      partIndex,
      stream,
      ownerUserId,
    );
  }

  cancelUploadSession(
    sessionId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> & {
      ownerUserId?: string;
    } = {},
  ) {
    return this.fileUploadService.cancelUploadSession(sessionId, options);
  }

  completeUpload(
    dto: CompleteUploadDto,
    options: {
      actorRole?: string;
      auditMetadata?: AuditMetadata;
      ownerUserId?: string;
    } = {},
  ) {
    return this.fileUploadService.completeUpload(dto, options);
  }

  async createFolder(
    dto: CreateFolderDto & {
      actorRole?: string;
      actorUserId?: string;
      auditMetadata?: AuditMetadata;
      ownerUserId?: string;
    },
  ) {
    const name = this.normalizeNodeName(dto.name);
    const spaceScope = this.normalizeSpaceScope(dto.spaceScope);
    await this.assertValidParent(
      dto.workspaceId,
      dto.parentNodeId ?? null,
      spaceScope,
      undefined,
      dto,
    );
    await this.assertNoSiblingNameConflict({
      name,
      ownerUserId: dto.ownerUserId,
      parentNodeId: dto.parentNodeId ?? null,
      spaceScope,
      workspaceId: dto.workspaceId,
    });
    const node = await this.fileNodesRepository.createFolder({
      ...dto,
      name,
      owner: dto.owner?.trim() || undefined,
      parentNodeId: dto.parentNodeId ?? undefined,
      spaceScope,
    });
    await this.fileNodesRepository.recordAudit('file.folder_created', node.id, {
      metadata: dto.auditMetadata,
    });
    return node;
  }

  async renameFileNode(
    id: string,
    dto: RenameFileNodeDto,
    options: FileAuditOptions = {},
  ) {
    const source = await this.requireActiveNode(id, options);
    const name = this.normalizeNodeName(dto.name);
    if (source.name === name) return source;
    await this.assertNoSiblingNameConflict({
      excludeNodeId: source.id,
      name,
      ownerUserId: source.ownerUserId ?? undefined,
      parentNodeId: source.parentNodeId,
      spaceScope: source.spaceScope,
      workspaceId: source.workspaceId,
    });
    const node = await this.fileNodesRepository.rename(id, name);
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.renamed', id, {
      metadata: options.auditMetadata,
    });
    return node;
  }

  async moveFileNode(
    id: string,
    dto: MoveFileNodeDto,
    options: FileAuditOptions = {},
  ) {
    const source = await this.requireActiveNode(id, options);
    const parentNodeId = dto.parentNodeId ?? null;
    await this.assertValidParent(
      source.workspaceId,
      parentNodeId,
      source.spaceScope,
      source.id,
      options,
    );
    await this.assertNoSiblingNameConflict({
      excludeNodeId: source.id,
      name: source.name,
      ownerUserId: source.ownerUserId ?? undefined,
      parentNodeId,
      spaceScope: source.spaceScope,
      workspaceId: source.workspaceId,
    });
    const node = await this.fileNodesRepository.move(id, parentNodeId);
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.moved', id, {
      metadata: options.auditMetadata,
    });
    return node;
  }

  async copyFileNode(
    id: string,
    dto: CopyFileNodeDto,
    options: FileAuditOptions = {},
  ) {
    const source = await this.requireActiveNode(id, options);
    const parentNodeId = dto.parentNodeId ?? source.parentNodeId;
    await this.assertValidParent(
      source.workspaceId,
      parentNodeId,
      source.spaceScope,
      source.id,
      options,
    );
    let name: string;
    if (dto.name) {
      name = this.normalizeNodeName(dto.name);
      await this.assertNoSiblingNameConflict({
        name,
        ownerUserId: source.ownerUserId ?? undefined,
        parentNodeId,
        spaceScope: source.spaceScope,
        workspaceId: source.workspaceId,
      });
    } else {
      const proposedName = createSuffixedFileName(source.name, ' copy');
      const siblings = await this.listSiblingNodes({
        ownerUserId: source.ownerUserId ?? undefined,
        parentNodeId,
        spaceScope: source.spaceScope,
        workspaceId: source.workspaceId,
      });
      name = this.createAvailableSiblingFileName(proposedName, siblings);
    }
    const node = await this.fileNodesRepository.copyTree(source, {
      name,
      parentNodeId,
    });
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.copied', node.id, {
      metadata: options.auditMetadata,
    });
    return node;
  }

  async getFileNodeContent(id: string, access: FileAccessOptions = {}) {
    const node = await this.requireActiveNode(id, access);
    this.assertTextEditableNode(node);
    if (!node.objectKey) {
      return {
        content: '',
        id: node.id,
        mimeType: node.mimeType,
        name: node.name,
        updatedAt: node.updatedAt,
      };
    }
    const content = await this.storageService.readObjectText(node.objectKey);
    return {
      content,
      id: node.id,
      mimeType: node.mimeType,
      name: node.name,
      updatedAt: node.updatedAt,
    };
  }

  async updateFileNodeContent(
    id: string,
    dto: UpdateFileNodeContentDto,
    options: FileAuditOptions = {},
  ) {
    const node = await this.requireActiveNode(id, options);
    this.assertTextEditableNode(node);
    if (!node.objectKey) {
      throw new BadRequestException('Folder content cannot be edited');
    }
    const distributedStorage =
      await this.storageService.distributedStorageEnabled();
    const objectKey = createFileObjectKey({
      distributedStorage,
      fileName: node.name,
      spaceScope: node.spaceScope,
      workspaceId: node.workspaceId,
    });
    await this.storageService.writeObjectText(
      objectKey,
      dto.content,
      node.mimeType,
    );
    const updated = await this.fileNodesRepository.replaceContentObject({
      id,
      objectKey,
      sizeBytes: Buffer.byteLength(dto.content, 'utf8'),
      mimeType: node.mimeType,
      uploadedBy: node.owner,
    });
    if (!updated) throw new NotFoundException('File node not found');
    await this.deleteStoredObjects(
      await this.fileNodesRepository.pruneVersions(updated.id),
    );
    await this.fileNodesRepository.recordAudit('file.content_updated', id, {
      metadata: options.auditMetadata,
    });
    await this.fileNodesRepository.recordAudit('file.version_created', id, {
      metadata: options.auditMetadata,
    });
    return {
      content: dto.content,
      id: updated.id,
      mimeType: updated.mimeType,
      name: updated.name,
      updatedAt: updated.updatedAt,
    };
  }

  async updateFileNodeState(
    id: string,
    dto: UpdateFileNodeStateDto,
    options: FileAuditOptions = {},
  ) {
    if (dto.starred === undefined && dto.archived === undefined) {
      throw new BadRequestException('No file node state change provided');
    }
    await this.requireNode(id, options);
    const node =
      dto.archived === true
        ? await this.fileNodesRepository.archiveTree(id, options.actor)
        : dto.archived === false
          ? await this.fileNodesRepository.restoreTree(id)
          : await this.fileNodesRepository.updateState(id, dto);
    if (!node) throw new NotFoundException('File node not found');
    if (dto.starred !== undefined) {
      await this.fileNodesRepository.recordAudit('file.starred_updated', id, {
        metadata: options.auditMetadata,
      });
    }
    if (dto.archived === true) {
      await this.fileNodesRepository.recordAudit('file.archived', id, {
        metadata: options.auditMetadata,
      });
    } else if (dto.archived === false) {
      await this.fileNodesRepository.recordAudit('file.restored', id, {
        metadata: options.auditMetadata,
      });
    }
    return node;
  }

  async restoreFileNode(
    id: string,
    dto: RestoreFileNodeDto,
    options: FileAuditOptions = {},
  ) {
    const source = await this.requireNode(id, options);
    const parentNodeId =
      dto.parentNodeId === undefined
        ? source.originalParentNodeId
        : dto.parentNodeId;
    await this.assertValidParent(
      source.workspaceId,
      parentNodeId ?? null,
      source.spaceScope,
      id,
      options,
    );
    const node = await this.fileNodesRepository.restoreTree(id, {
      name: dto.name ? this.normalizeNodeName(dto.name) : undefined,
      parentNodeId,
    });
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.restored', id, {
      metadata: options.auditMetadata,
    });
    return node;
  }

  async permanentlyDeleteFileNode(id: string, options: FileAuditOptions = {}) {
    await this.requireNode(id, options);
    const deletion = await this.fileNodesRepository.deleteTree(id);
    if (deletion.nodes.length === 0) {
      throw new NotFoundException('File node not found');
    }
    await this.deleteStoredObjects([
      ...deletion.nodes.map((node) => node.objectKey),
      ...deletion.versions.map((version) => version.objectKey),
    ]);
    const root = deletion.nodes[0];
    await this.fileNodesRepository.recordAudit('file.permanently_deleted', id, {
      metadata: {
        ...options.auditMetadata,
        deletedNodeCount: deletion.nodes.length,
        deletedVersionCount: deletion.versions.length,
      },
      nodeId: id,
      workspaceId: root?.workspaceId ?? 'workspace-default',
    });
    return { deleted: deletion.nodes.length, id, ok: true };
  }

  async cleanupTrash() {
    const result = await this.cleanupExpiredTrash({ forceAudit: true });
    return {
      deleted: result.deleted,
      ok: true,
      trashRetentionDays: result.trashRetentionDays,
    };
  }

  createDownloadIntent(
    nodeId: string,
    dto: CreateDownloadIntentDto,
    options: FileAuditOptions = {},
  ) {
    return this.fileDownloadPreviewService.createDownloadIntent(
      nodeId,
      dto,
      options,
    );
  }

  createBatchDownloadIntents(
    dto: BatchFileNodeIdsDto,
    options: FileAuditOptions = {},
  ): Promise<BatchDownloadIntentResponse> {
    return this.fileDownloadPreviewService.createBatchDownloadIntents(
      dto,
      options,
    );
  }

  async batchArchive(
    dto: BatchFileNodeIdsDto,
    options: FileAuditOptions = {},
  ): Promise<BatchFileNodeOperationResponse> {
    const result = await this.runBatch(dto.ids, (id) =>
      this.updateFileNodeState(id, { archived: true }, options),
    );
    await this.fileNodesRepository.recordAudit(
      'file.batch_archived',
      'batch-archive',
      {
        metadata: { ...options.auditMetadata, ...result.summary },
        nodeId: null,
      },
    );
    return result;
  }

  async batchRestore(
    dto: BatchFileNodeIdsDto,
    options: FileAuditOptions = {},
  ): Promise<BatchFileNodeOperationResponse> {
    const result = await this.runBatch(dto.ids, (id) =>
      this.restoreFileNode(id, {}, options),
    );
    await this.fileNodesRepository.recordAudit(
      'file.batch_restored',
      'batch-restore',
      {
        metadata: { ...options.auditMetadata, ...result.summary },
        nodeId: null,
      },
    );
    return result;
  }

  async batchMove(
    dto: BatchMoveFileNodesDto,
    options: FileAuditOptions = {},
  ): Promise<BatchFileNodeOperationResponse> {
    const result = await this.runBatch(dto.ids, (id) =>
      this.moveFileNode(
        id,
        { parentNodeId: dto.parentNodeId ?? null },
        options,
      ),
    );
    await this.fileNodesRepository.recordAudit(
      'file.batch_moved',
      'batch-move',
      {
        metadata: {
          ...options.auditMetadata,
          ...result.summary,
          parentNodeId: dto.parentNodeId ?? null,
        },
        nodeId: null,
      },
    );
    return result;
  }

  downloadFileNode(
    nodeId: string,
    downloadId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> & { range?: string } = {},
  ) {
    return this.fileDownloadPreviewService.downloadFileNode(
      nodeId,
      downloadId,
      options,
    );
  }

  async listFileVersions(nodeId: string, access: FileAccessOptions = {}) {
    await this.requireActiveNode(nodeId, access);
    const versions = await this.fileNodesRepository.listVersions(nodeId);
    return versions.map(({ objectKey, ...version }) => {
      void objectKey;
      return version;
    });
  }

  createVersionDownloadIntent(
    nodeId: string,
    versionId: string,
    options: FileAuditOptions = {},
  ) {
    return this.fileDownloadPreviewService.createVersionDownloadIntent(
      nodeId,
      versionId,
      options,
    );
  }

  downloadFileVersion(
    nodeId: string,
    versionId: string,
    downloadId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> & { range?: string } = {},
  ) {
    return this.fileDownloadPreviewService.downloadFileVersion(
      nodeId,
      versionId,
      downloadId,
      options,
    );
  }

  async restoreFileVersion(
    nodeId: string,
    versionId: string,
    options: FileAuditOptions = {},
  ) {
    await this.requireActiveNode(nodeId, options);
    const node = await this.fileNodesRepository.restoreVersion(
      nodeId,
      versionId,
      options.actor,
    );
    if (!node) throw new NotFoundException('File version not found');
    await this.deleteStoredObjects(
      await this.fileNodesRepository.pruneVersions(node.id),
    );
    await this.fileNodesRepository.recordAudit(
      'file.version_restored',
      nodeId,
      { metadata: { ...options.auditMetadata, versionId } },
    );
    return node;
  }

  createPreviewIntent(nodeId: string, options: FileAuditOptions = {}) {
    return this.fileDownloadPreviewService.createPreviewIntent(nodeId, options);
  }

  getPreviewStatus(
    nodeId: string,
    previewId: string,
    access: FileAccessOptions = {},
  ) {
    return this.fileDownloadPreviewService.getPreviewStatus(
      nodeId,
      previewId,
      access,
    );
  }

  getStorageUsage(workspaceId: string, quotaBytes: number | null) {
    return this.fileUploadService.getStorageUsage(workspaceId, quotaBytes);
  }

  private async cleanupExpiredTrash(options: { forceAudit?: boolean } = {}) {
    const policy = await this.fileNodesRepository.getPolicy();
    const cutoff = new Date(
      Date.now() - policy.trashRetentionDays * 24 * 60 * 60 * 1000,
    );
    const deleted = await this.fileNodesRepository.cleanupTrash(cutoff);
    await this.deleteStoredObjects([
      ...deleted.nodes.map((node) => node.objectKey),
      ...deleted.versions.map((version) => version.objectKey),
    ]);
    if (options.forceAudit || deleted.nodes.length > 0) {
      await this.fileNodesRepository.recordAudit(
        'file.trash_cleaned',
        'trash-cleanup',
        {
          actor: 'system',
          metadata: {
            deletedNodeCount: deleted.nodes.length,
            deletedVersionCount: deleted.versions.length,
            trashRetentionDays: policy.trashRetentionDays,
          },
          nodeId: null,
        },
      );
    }
    return {
      deleted: deleted.nodes.length,
      trashRetentionDays: policy.trashRetentionDays,
    };
  }

  private async cleanupExpiredTrashIfDue() {
    const now = Date.now();
    if (now - this.lastTrashCleanupAt < trashCleanupThrottleMs) return;
    this.lastTrashCleanupAt = now;
    try {
      await this.cleanupExpiredTrash();
    } catch (error) {
      this.lastTrashCleanupAt = 0;
      throw error;
    }
  }

  private async deleteStoredObjects(objectKeys: Array<string | null>) {
    const uniqueObjectKeys = [
      ...new Set(objectKeys.filter((key): key is string => Boolean(key))),
    ];
    await Promise.all(
      uniqueObjectKeys.map((objectKey) =>
        this.storageService.deleteObject(objectKey).catch(() => undefined),
      ),
    );
  }

  private async runBatch<T>(
    ids: string[],
    action: (id: string) => Promise<T>,
  ): Promise<{
    failed: Array<{ id: string; message: string }>;
    succeeded: T[];
    summary: { failed: number; requested: number; succeeded: number };
  }> {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const succeeded: T[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of uniqueIds) {
      try {
        succeeded.push(await action(id));
      } catch (error) {
        failed.push({
          id,
          message: error instanceof Error ? error.message : 'Operation failed',
        });
      }
    }
    return {
      failed,
      succeeded,
      summary: {
        failed: failed.length,
        requested: uniqueIds.length,
        succeeded: succeeded.length,
      },
    };
  }

  private normalizeListState(value?: string): FileNodeListState {
    if (value === 'archived' || value === 'all') return value;
    return 'active';
  }

  private normalizeSpaceScope(value?: string): FileNodeSpaceScope {
    return value === 'personal' ? 'personal' : 'workspace';
  }

  private async listSiblingNodes(input: {
    ownerUserId?: string;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }) {
    return this.fileNodesRepository.list(
      input.workspaceId,
      input.parentNodeId,
      'active',
      {
        ownerUserId:
          input.spaceScope === 'personal' ? input.ownerUserId : undefined,
        spaceScope: input.spaceScope,
      },
    );
  }

  private createAvailableSiblingFileName(
    fileName: string,
    siblings: FileNodeResponse[],
  ) {
    const siblingKeys = new Set(
      siblings.map((node) => getFileNameConflictKey(node.name)),
    );
    if (!siblingKeys.has(getFileNameConflictKey(fileName))) return fileName;
    for (let index = 2; index < 10000; index += 1) {
      const candidate = createSuffixedFileName(fileName, ` (${index})`);
      if (!siblingKeys.has(getFileNameConflictKey(candidate))) return candidate;
    }
    throw new BadRequestException('Unable to create a non-conflicting name');
  }

  private async assertNoSiblingNameConflict(input: {
    excludeNodeId?: string;
    name: string;
    ownerUserId?: string;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }) {
    const conflicts = await this.findSiblingNameConflicts(input);
    if (conflicts.length === 0) return;
    throw new ConflictException(
      'File node name conflicts with an existing item',
    );
  }

  private async findSiblingNameConflicts(input: {
    excludeNodeId?: string;
    name: string;
    ownerUserId?: string;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }): Promise<FileNodeResponse[]> {
    const targetKey = getFileNameConflictKey(input.name);
    const siblings = await this.listSiblingNodes(input);
    return siblings.filter(
      (node) =>
        node.id !== input.excludeNodeId &&
        getFileNameConflictKey(node.name) === targetKey,
    );
  }

  private normalizeNodeName(value: string) {
    return normalizeFileName(value);
  }

  private assertTextEditableNode(node: {
    kind?: string;
    mimeType: string;
    name: string;
    objectKey: string | null;
    sizeBytes: number | null;
  }) {
    const capability = resolveFilePreviewCapability({
      kind: (node.kind ?? 'doc') as FileNodeKind,
      mimeType: node.mimeType,
      name: node.name,
      objectKey: node.objectKey,
      sizeBytes: node.sizeBytes,
    });
    if (!capability.supported) {
      if (capability.reason === 'too-large') {
        throw new BadRequestException('File is too large to edit as text');
      }
      throw new BadRequestException('File type cannot be edited as text');
    }
    if (
      capability.renderMode !== 'markdown' &&
      capability.renderMode !== 'text'
    ) {
      throw new BadRequestException('File type cannot be edited as text');
    }
  }

  private async assertValidParent(
    workspaceId: string,
    parentNodeId: string | null,
    spaceScope: FileNodeSpaceScope,
    sourceNodeId?: string,
    access: FileAccessOptions = {},
  ) {
    if (!parentNodeId) return;
    if (parentNodeId === sourceNodeId) {
      throw new BadRequestException('A file node cannot be moved into itself');
    }
    let parent = await this.requireActiveNode(parentNodeId, access);
    if (parent.workspaceId !== workspaceId) {
      throw new BadRequestException(
        'Parent folder belongs to another workspace',
      );
    }
    if (parent.spaceScope !== spaceScope) {
      throw new BadRequestException('Parent folder belongs to another space');
    }
    if (parent.kind !== 'folder') {
      throw new BadRequestException('Parent node must be a folder');
    }
    while (sourceNodeId && parent.parentNodeId) {
      if (parent.parentNodeId === sourceNodeId) {
        throw new BadRequestException(
          'A folder cannot be moved into its child folder',
        );
      }
      parent = await this.requireActiveNode(parent.parentNodeId, access);
    }
  }

  private async requireNode(nodeId: string, access: FileAccessOptions = {}) {
    const node = await this.fileNodesRepository.findById(nodeId);
    if (!node) throw new NotFoundException('File node not found');
    this.assertNodeAccess(node, access);
    return node;
  }

  private async requireActiveNode(
    nodeId: string,
    access: FileAccessOptions = {},
  ) {
    const node = await this.requireNode(nodeId, access);
    if (node.archivedAt) {
      throw new ForbiddenException('File node is archived');
    }
    return node;
  }

  private assertNodeAccess(node: FileNodeResponse, access: FileAccessOptions) {
    if (
      node.spaceScope !== 'personal' ||
      !access.actorUserId ||
      access.actorRole === 'admin' ||
      node.ownerUserId === access.actorUserId
    ) {
      return;
    }
    throw new NotFoundException('File node not found');
  }
}
