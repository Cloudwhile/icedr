import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import {
  createFileObjectKey,
  isUploadObjectKeyForPayload,
} from '../storage/storage-object-keys';
import type { TransferStatus } from '../downloads/transfers/transfers.dto';
import { TransfersService } from '../downloads/transfers/transfers.service';
import {
  BatchDownloadIntentResponse,
  BatchFileNodeIdsDto,
  BatchFileNodeOperationResponse,
  BatchMoveFileNodesDto,
  CompleteUploadPartDto,
  CompleteUploadDto,
  CopyFileNodeDto,
  CreateDownloadIntentDto,
  CreateFolderDto,
  CreateUploadIntentDto,
  DownloadIntentResponse,
  FileNodeListState,
  type FileNodeKind,
  FilePolicyResponse,
  MoveFileNodeDto,
  PreviewIntentResponse,
  RenameFileNodeDto,
  RestoreFileNodeDto,
  SearchFileNodesQueryDto,
  UpdateFilePolicyDto,
  UpdateFileNodeContentDto,
  UpdateFileNodeStateDto,
  UploadChunkResponse,
  UploadIntentResponse,
  UploadPartIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import {
  UploadSession,
  UploadSessionPart,
  UploadSessionsRepository,
} from './upload-sessions.repository';
import {
  resolveFilePreviewCapability,
  type FilePreviewCapability,
} from './file-preview-policy';
import type { Readable } from 'stream';

const trashCleanupThrottleMs = 5 * 60 * 1000;
const insufficientStorageMessage = 'Storage space is insufficient';
type AuditMetadata = Record<string, unknown>;
type FileAuditOptions = {
  actor?: string;
  auditMetadata?: AuditMetadata;
};

type FileDownloadAuditPurpose = 'download' | 'preview';

@Injectable()
export class FileNodesService {
  private lastTrashCleanupAt = 0;

  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
    private readonly transfersService: TransfersService,
    private readonly uploadSessionsRepository: UploadSessionsRepository,
  ) {}

  async listFileNodes(
    workspaceId?: string,
    parentNodeId?: string | null,
    options: { state?: string } = {},
  ) {
    const state = this.normalizeListState(options.state);
    if (state !== 'active') {
      await this.cleanupExpiredTrashIfDue();
    }
    return this.fileNodesRepository.list(workspaceId, parentNodeId, state);
  }

  async searchFileNodes(
    query: SearchFileNodesQueryDto,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const result = await this.fileNodesRepository.search(query);
    await this.fileNodesRepository.recordAudit(
      'file.search_performed',
      query.workspaceId ?? 'workspace-default',
      {
        metadata: {
          ...options.auditMetadata,
          query: query.query ?? '',
          state: query.state ?? 'active',
          type: query.type ?? 'all',
        },
        nodeId: null,
        workspaceId: query.workspaceId ?? 'workspace-default',
      },
    );
    return result;
  }

  getFileNode(id: string) {
    return this.fileNodesRepository.findById(id);
  }

  getFilePolicy(): Promise<FilePolicyResponse> {
    return this.fileNodesRepository.getPolicy();
  }

  updateFilePolicy(dto: UpdateFilePolicyDto): Promise<FilePolicyResponse> {
    return this.fileNodesRepository.updatePolicy(dto);
  }

  async createUploadIntent(
    dto: CreateUploadIntentDto,
    options: { auditMetadata?: AuditMetadata; ownerUserId?: string } = {},
  ): Promise<UploadIntentResponse> {
    const distributedStorage =
      await this.storageService.distributedStorageEnabled();
    const sizeBytes = Math.max(0, Math.trunc(dto.fileSizeBytes ?? 0));
    await this.assertWithinWorkspaceQuota(
      dto.workspaceId,
      sizeBytes,
      options.ownerUserId,
      options.auditMetadata,
    );
    const chunkSizeBytes = this.normalizeChunkSize(dto.chunkSizeBytes, {
      distributedStorage,
    });
    const resumeKey = dto.resumeKey?.trim() || undefined;
    if (resumeKey && dto.fileSizeBytes !== undefined) {
      const reusable = await this.uploadSessionsRepository.findReusable({
        workspaceId: dto.workspaceId,
        resumeKey,
        fileName: dto.fileName,
        parentNodeId: dto.parentNodeId ?? null,
        sizeBytes,
      });
      if (reusable) {
        if (!this.canReuseSession(reusable, distributedStorage)) {
          await this.cancelUploadSession(reusable.id, {
            auditMetadata: options.auditMetadata,
          });
        } else {
          const parts = await this.uploadSessionsRepository.listParts(
            reusable.id,
          );
          const uploaded = this.getUploadedSessionState(reusable, parts);
          await this.uploadSessionsRepository.updateStatus(
            reusable.id,
            'running',
          );
          await this.syncUploadTransfer(reusable.transferId, {
            status: 'running',
            progress: uploaded.progress,
          });
          return this.toUploadIntent(reusable, parts);
        }
      }
    }

    const objectKey = this.createUploadObjectKey(dto, distributedStorage);
    const transfer = await this.transfersService.createUploadTransfer({
      auditMetadata: options.auditMetadata,
      workspaceId: dto.workspaceId,
      objectKey,
      name: dto.fileName,
    });
    const multipartUpload = distributedStorage
      ? await this.storageService.createMultipartUpload(
          objectKey,
          dto.mimeType ?? 'application/octet-stream',
        )
      : null;
    try {
      const session = await this.uploadSessionsRepository.create({
        workspaceId: dto.workspaceId,
        transferId: transfer.id,
        objectKey,
        multipartUploadId: multipartUpload?.uploadId ?? null,
        resumeKey: resumeKey ?? null,
        fileName: dto.fileName,
        parentNodeId: dto.parentNodeId ?? null,
        mimeType: dto.mimeType ?? 'application/octet-stream',
        sizeBytes,
        chunkSizeBytes,
      });
      await this.fileNodesRepository.recordAudit(
        'file.upload_intent_created',
        objectKey,
        { metadata: options.auditMetadata },
      );

      return this.toUploadIntent(session, []);
    } catch (error) {
      if (multipartUpload?.uploadId) {
        await this.storageService
          .abortMultipartUpload({
            objectKey,
            uploadId: multipartUpload.uploadId,
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async createUploadPartIntent(
    sessionId: string,
    partIndex: number,
  ): Promise<UploadPartIntentResponse> {
    const session = await this.requireUploadSession(sessionId);
    this.assertWritableUploadSession(session);
    if (!session.multipartUploadId) {
      throw new BadRequestException(
        'Upload session does not use object storage multipart upload',
      );
    }

    const normalizedPartIndex = Math.trunc(partIndex);
    this.getExpectedPartRange(session, normalizedPartIndex);
    const signed = await this.storageService.createMultipartUploadPartUrl({
      objectKey: session.objectKey,
      partIndex: normalizedPartIndex,
      uploadId: session.multipartUploadId,
    });
    return {
      expiresAt: signed.expiresAt,
      expiresInSeconds: signed.expiresInSeconds,
      headers: signed.headers,
      partIndex: normalizedPartIndex,
      sessionId: session.id,
      uploadUrl: signed.url,
    };
  }

  async completeUploadPart(
    sessionId: string,
    partIndex: number,
    dto: CompleteUploadPartDto,
  ): Promise<UploadChunkResponse> {
    const session = await this.requireUploadSession(sessionId);
    this.assertWritableUploadSession(session);
    if (!session.multipartUploadId) {
      throw new BadRequestException(
        'Upload session does not use object storage multipart upload',
      );
    }

    const normalizedPartIndex = Math.trunc(partIndex);
    const expected = this.getExpectedPartRange(session, normalizedPartIndex);
    let eTag = dto.eTag?.trim() || null;
    let sizeBytes = dto.sizeBytes ?? expected.sizeBytes;

    if (!eTag) {
      const storedPart = await this.storageService.findMultipartUploadPart({
        objectKey: session.objectKey,
        partIndex: normalizedPartIndex,
        uploadId: session.multipartUploadId,
      });
      eTag = storedPart.eTag;
      sizeBytes = storedPart.sizeBytes ?? sizeBytes;
    }

    if (sizeBytes !== expected.sizeBytes) {
      throw new BadRequestException('Upload chunk size does not match session');
    }

    await this.uploadSessionsRepository.upsertPart({
      sessionId: session.id,
      partIndex: normalizedPartIndex,
      startByte: expected.startByte,
      endByte: expected.endByte,
      sizeBytes,
      eTag,
    });
    await this.uploadSessionsRepository.updateStatus(session.id, 'running');
    const parts = await this.uploadSessionsRepository.listParts(session.id);
    const uploaded = this.getUploadedSessionState(session, parts);
    await this.syncUploadTransfer(session.transferId, {
      status: 'running',
      progress: uploaded.progress,
    });

    return {
      sessionId: session.id,
      partIndex: normalizedPartIndex,
      uploadedBytes: uploaded.uploadedBytes,
      uploadedPartIndexes: uploaded.uploadedPartIndexes,
      progress: uploaded.progress,
    };
  }

  async uploadChunk(
    sessionId: string,
    partIndex: number,
    stream: Readable,
  ): Promise<UploadChunkResponse> {
    const session = await this.requireUploadSession(sessionId);
    this.assertWritableUploadSession(session);
    if (session.multipartUploadId) {
      throw new BadRequestException(
        'Upload session uses object storage multipart upload',
      );
    }

    const normalizedPartIndex = Math.trunc(partIndex);
    const expected = this.getExpectedPartRange(session, normalizedPartIndex);
    const written = await this.storageService.writeUploadSessionPart(
      session.id,
      normalizedPartIndex,
      stream,
    );
    if (written.sizeBytes !== expected.sizeBytes) {
      throw new BadRequestException('Upload chunk size does not match session');
    }

    await this.uploadSessionsRepository.upsertPart({
      sessionId: session.id,
      partIndex: normalizedPartIndex,
      startByte: expected.startByte,
      endByte: expected.endByte,
      sizeBytes: written.sizeBytes,
    });
    await this.uploadSessionsRepository.updateStatus(session.id, 'running');
    const parts = await this.uploadSessionsRepository.listParts(session.id);
    const uploaded = this.getUploadedSessionState(session, parts);
    await this.syncUploadTransfer(session.transferId, {
      status: 'running',
      progress: uploaded.progress,
    });

    return {
      sessionId: session.id,
      partIndex: normalizedPartIndex,
      uploadedBytes: uploaded.uploadedBytes,
      uploadedPartIndexes: uploaded.uploadedPartIndexes,
      progress: uploaded.progress,
    };
  }

  async cancelUploadSession(
    sessionId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const session = await this.requireUploadSession(sessionId);
    if (session.status === 'completed') {
      throw new BadRequestException('Completed upload sessions cannot cancel');
    }
    await this.uploadSessionsRepository.updateStatus(session.id, 'canceled');
    if (session.multipartUploadId) {
      await this.storageService.abortMultipartUpload({
        objectKey: session.objectKey,
        uploadId: session.multipartUploadId,
      });
    } else {
      await this.storageService.deleteUploadSessionParts(session.id);
    }
    await this.syncUploadTransfer(session.transferId, {
      status: 'canceled',
      auditMetadata: options.auditMetadata,
    });
    return { ok: true };
  }

  async completeUpload(
    dto: CompleteUploadDto,
    options: { auditMetadata?: AuditMetadata; ownerUserId?: string } = {},
  ) {
    this.assertUploadObjectKey(dto);
    const existingUploadTarget = (
      await this.fileNodesRepository.list(
        dto.workspaceId,
        dto.parentNodeId ?? null,
        'active',
      )
    ).find((node) => node.name === dto.fileName && Boolean(node.objectKey));
    const uploadSession = dto.uploadSessionId
      ? await this.requireCompletableUploadSession(dto)
      : null;
    if (uploadSession) {
      const parts = await this.uploadSessionsRepository.listParts(
        uploadSession.id,
      );
      this.assertUploadSessionComplete(uploadSession, parts);
      if (uploadSession.multipartUploadId) {
        await this.storageService.completeMultipartUpload({
          objectKey: dto.objectKey,
          uploadId: uploadSession.multipartUploadId,
          parts: parts.map((part) => ({
            eTag: part.eTag ?? '',
            partIndex: part.partIndex,
          })),
        });
      } else {
        await this.storageService.composeUploadSessionParts({
          sessionId: uploadSession.id,
          partIndexes: parts.map((part) => part.partIndex),
          objectKey: dto.objectKey,
          contentType: dto.mimeType ?? uploadSession.mimeType,
        });
      }
      await this.uploadSessionsRepository.updateStatus(
        uploadSession.id,
        'completed',
      );
    }
    await this.storageService.assertObjectExists(dto.objectKey);
    const node = await this.fileNodesRepository.completeUpload({
      ...dto,
      owner: dto.owner?.trim() || undefined,
      ownerUserId: options.ownerUserId,
    });
    await this.deleteStoredObjects(
      await this.fileNodesRepository.pruneVersions(node.id),
    );
    await this.fileNodesRepository.recordAudit(
      'file.upload_completed',
      node.id,
      { metadata: options.auditMetadata },
    );
    if (existingUploadTarget) {
      await this.fileNodesRepository.recordAudit(
        'file.version_created',
        node.id,
        { metadata: options.auditMetadata },
      );
    }
    const transferId = dto.transferId ?? uploadSession?.transferId;
    if (transferId) {
      await this.completeUploadTransfer({
        auditMetadata: options.auditMetadata,
        transferId,
        nodeId: node.id,
      });
    }
    return node;
  }

  async createFolder(
    dto: CreateFolderDto & {
      auditMetadata?: AuditMetadata;
      ownerUserId?: string;
    },
  ) {
    const name = this.normalizeNodeName(dto.name);
    await this.assertValidParent(dto.workspaceId, dto.parentNodeId ?? null);
    const node = await this.fileNodesRepository.createFolder({
      ...dto,
      name,
      owner: dto.owner?.trim() || undefined,
      parentNodeId: dto.parentNodeId ?? undefined,
    });
    await this.fileNodesRepository.recordAudit('file.folder_created', node.id, {
      metadata: dto.auditMetadata,
    });
    return node;
  }

  async renameFileNode(
    id: string,
    dto: RenameFileNodeDto,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const source = await this.requireActiveNode(id);
    const name = this.normalizeNodeName(dto.name);
    if (source.name === name) return source;
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
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const source = await this.requireActiveNode(id);
    const parentNodeId = dto.parentNodeId ?? null;
    await this.assertValidParent(source.workspaceId, parentNodeId, source.id);
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
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const source = await this.requireActiveNode(id);
    const parentNodeId = dto.parentNodeId ?? source.parentNodeId;
    await this.assertValidParent(source.workspaceId, parentNodeId, source.id);
    const node = await this.fileNodesRepository.copyTree(source, {
      name: dto.name
        ? this.normalizeNodeName(dto.name)
        : this.createCopyName(source.name),
      parentNodeId,
    });
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.copied', node.id, {
      metadata: options.auditMetadata,
    });
    return node;
  }

  async getFileNodeContent(id: string) {
    const node = await this.requireActiveNode(id);
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
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const node = await this.requireActiveNode(id);
    this.assertTextEditableNode(node);
    if (!node.objectKey) {
      throw new BadRequestException('Folder content cannot be edited');
    }

    const distributedStorage =
      await this.storageService.distributedStorageEnabled();
    const objectKey = createFileObjectKey({
      distributedStorage,
      fileName: node.name,
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
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const source = await this.fileNodesRepository.findById(id);
    if (!source) throw new NotFoundException('File node not found');
    const parentNodeId =
      dto.parentNodeId === undefined
        ? source.originalParentNodeId
        : dto.parentNodeId;
    await this.assertValidParent(source.workspaceId, parentNodeId ?? null, id);
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

  async permanentlyDeleteFileNode(
    id: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
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
    return {
      deleted: deletion.nodes.length,
      id,
      ok: true,
    };
  }

  async cleanupTrash() {
    const result = await this.cleanupExpiredTrash({ forceAudit: true });
    return {
      deleted: result.deleted,
      ok: true,
      trashRetentionDays: result.trashRetentionDays,
    };
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

  async createDownloadIntent(
    nodeId: string,
    dto: CreateDownloadIntentDto,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    void dto;
    const node = await this.requireActiveNode(nodeId);
    const method = node.objectKey ? 'presigned-url' : 'backend-manifest';
    const intent = await this.fileNodesRepository.createDownloadIntent(
      node,
      method,
      options.auditMetadata,
    );
    await this.fileNodesRepository.recordAudit(
      'file.download_intent_created',
      node.id,
      { metadata: options.auditMetadata },
    );

    return {
      downloadId: intent.downloadId,
      nodeId: node.id,
      filename: node.name,
      method,
      availableAt: new Date().toISOString(),
      expiresAt: intent.expiresAt,
      downloadUrl: `/api/file-nodes/${encodeURIComponent(node.id)}/download?downloadId=${encodeURIComponent(intent.downloadId)}`,
    } satisfies DownloadIntentResponse;
  }

  async createBatchDownloadIntents(
    dto: BatchFileNodeIdsDto,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ): Promise<BatchDownloadIntentResponse> {
    const result = await this.runBatch(dto.ids, (id) =>
      this.createDownloadIntent(id, {}, options),
    );
    await this.fileNodesRepository.recordAudit(
      'file.batch_download_intents_created',
      'batch-download',
      {
        metadata: { ...options.auditMetadata, ...result.summary },
        nodeId: null,
      },
    );
    return result;
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
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
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
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
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

  async downloadFileNode(
    nodeId: string,
    downloadId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> & {
      auditPurpose?: FileDownloadAuditPurpose;
    } = {},
  ) {
    const intent =
      await this.fileNodesRepository.findDownloadIntent(downloadId);
    if (
      !intent ||
      intent.nodeId !== nodeId ||
      new Date(intent.expiresAt).getTime() < Date.now()
    ) {
      throw new NotFoundException('Download intent not found');
    }

    const node = await this.requireActiveNode(nodeId);
    if (options.auditPurpose !== 'preview') {
      await this.fileNodesRepository.recordAudit(
        'file.download_started',
        node.id,
        {
          metadata: {
            ...intent.auditMetadata,
            ...options.auditMetadata,
          },
        },
      );
    }

    if (intent.method === 'presigned-url' && node.objectKey) {
      const signed = await this.storageService.createPresignedDownload(
        node.objectKey,
        node.name,
      );
      return {
        method: 'presigned-url' as const,
        filename: node.name,
        redirectUrl: signed.url,
      };
    }

    return {
      method: 'backend-manifest' as const,
      filename: `${node.name}.txt`,
      contentType: 'text/plain; charset=utf-8',
      content: this.buildDownloadManifest(node),
    };
  }

  async listFileVersions(nodeId: string) {
    await this.requireActiveNode(nodeId);
    return this.fileNodesRepository.listVersions(nodeId);
  }

  async createVersionDownloadIntent(
    nodeId: string,
    versionId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    await this.requireActiveNode(nodeId);
    const version = await this.fileNodesRepository.findVersion(
      nodeId,
      versionId,
    );
    if (!version) throw new NotFoundException('File version not found');
    const signed = await this.storageService.createPresignedDownload(
      version.objectKey,
      `v${version.versionNumber}-${version.nodeId}`,
    );
    await this.fileNodesRepository.recordAudit(
      'file.version_downloaded',
      nodeId,
      {
        metadata: {
          ...options.auditMetadata,
          versionId,
          versionNumber: version.versionNumber,
        },
      },
    );
    return {
      downloadId: `version:${version.id}`,
      nodeId,
      filename: `v${version.versionNumber}-${version.nodeId}`,
      method: 'presigned-url' as const,
      availableAt: new Date().toISOString(),
      expiresAt: signed.expiresAt,
      downloadUrl: signed.url,
    };
  }

  async restoreFileVersion(
    nodeId: string,
    versionId: string,
    options: FileAuditOptions = {},
  ) {
    await this.requireActiveNode(nodeId);
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
      {
        metadata: { ...options.auditMetadata, versionId },
      },
    );
    return node;
  }

  async createPreviewIntent(
    nodeId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> = {},
  ) {
    const node = await this.requireActiveNode(nodeId);
    const capability = resolveFilePreviewCapability(node);
    const status: PreviewIntentResponse['status'] = capability.supported
      ? 'ready'
      : 'unsupported';

    const intent = await this.fileNodesRepository.createPreviewArtifact(
      node,
      status,
      capability.renderMode,
      capability.supported ? null : this.getPreviewUnsupportedError(capability),
    );
    await this.fileNodesRepository.recordAudit(
      'file.preview_requested',
      node.id,
      { metadata: options.auditMetadata },
    );
    return this.withPreviewCapability(intent, capability);
  }

  async getPreviewStatus(nodeId: string, previewId: string) {
    const intent =
      await this.fileNodesRepository.findPreviewArtifact(previewId);
    if (!intent || intent.nodeId !== nodeId) {
      throw new NotFoundException('Preview intent not found');
    }
    const node = await this.requireActiveNode(nodeId);
    return this.withPreviewCapability(
      intent,
      resolveFilePreviewCapability(node),
    );
  }

  async getStorageUsage(workspaceId: string, quotaBytes: number | null) {
    const usage = await this.fileNodesRepository.getStorageUsage(workspaceId);
    const resolvedQuotaBytes = usage.quotaBytes ?? quotaBytes;
    const usagePercent =
      resolvedQuotaBytes && resolvedQuotaBytes > 0
        ? Math.min(
            100,
            Math.round((usage.usedBytes / resolvedQuotaBytes) * 1000) / 10,
          )
        : null;
    return {
      workspaceId,
      ...usage,
      quotaBytes: resolvedQuotaBytes,
      usagePercent,
      updatedAt: new Date().toISOString(),
    };
  }

  private async assertWithinWorkspaceQuota(
    workspaceId: string,
    incomingBytes: number,
    ownerUserId?: string,
    auditMetadata: AuditMetadata = {},
  ) {
    const usage = await this.fileNodesRepository.getStorageUsage(workspaceId);
    const workspaceQuotaBytes = usage.quotaBytes;
    const storagePolicyQuotaBytes =
      await this.storageService.getConfiguredQuotaBytes();
    const quotaBytes = resolveEffectiveQuotaBytes(
      workspaceQuotaBytes,
      storagePolicyQuotaBytes,
    );
    const quotaScope =
      workspaceQuotaBytes !== null &&
      workspaceQuotaBytes !== undefined &&
      quotaBytes === workspaceQuotaBytes
        ? 'workspace'
        : 'storage';
    if (
      quotaBytes &&
      quotaBytes > 0 &&
      usage.usedBytes + incomingBytes > quotaBytes
    ) {
      await this.fileNodesRepository.recordAudit(
        'file.quota_upload_rejected',
        workspaceId,
        {
          metadata: {
            ...auditMetadata,
            incomingBytes,
            quotaBytes,
            scope: quotaScope,
            usedBytes: usage.usedBytes,
          },
          nodeId: null,
          workspaceId,
        },
      );
      throw new BadRequestException(insufficientStorageMessage);
    }
    if (!ownerUserId) return;
    const userUsage = await this.fileNodesRepository.getUserStorageUsage(
      workspaceId,
      ownerUserId,
    );
    const userQuotaBytes = userUsage.quotaBytes;
    if (
      !userQuotaBytes ||
      userQuotaBytes <= 0 ||
      userUsage.usedBytes + incomingBytes <= userQuotaBytes
    ) {
      return;
    }
    await this.fileNodesRepository.recordAudit(
      'file.quota_upload_rejected',
      workspaceId,
      {
        metadata: {
          ...auditMetadata,
          incomingBytes,
          quotaBytes: userQuotaBytes,
          scope: 'user',
          usedBytes: userUsage.usedBytes,
          userId: ownerUserId,
        },
        nodeId: null,
        workspaceId,
      },
    );
    throw new BadRequestException(insufficientStorageMessage);
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

  private async syncUploadTransfer(
    transferId: string,
    input: {
      status: TransferStatus;
      progress?: number;
      auditMetadata?: AuditMetadata;
    },
  ) {
    try {
      await this.transfersService.updateTransfer(transferId, input);
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }

  private async completeUploadTransfer(input: {
    transferId: string;
    nodeId: string;
    auditMetadata?: AuditMetadata;
  }) {
    try {
      await this.transfersService.completeTransfer(input);
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
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

  private toUploadIntent(
    session: UploadSession,
    parts: UploadSessionPart[],
  ): UploadIntentResponse {
    const uploaded = this.getUploadedSessionState(session, parts);
    const objectMultipart = Boolean(session.multipartUploadId);
    return {
      objectKey: session.objectKey,
      transferId: session.transferId,
      uploadMethod: objectMultipart ? 'object-multipart' : 'chunked',
      uploadUrl: objectMultipart
        ? `/api/file-nodes/upload-sessions/${encodeURIComponent(session.id)}/parts`
        : `/api/file-nodes/upload-sessions/${encodeURIComponent(session.id)}/chunks`,
      headers: {},
      expiresInSeconds: 86400,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      sessionId: session.id,
      chunkSizeBytes: session.chunkSizeBytes,
      uploadedBytes: uploaded.uploadedBytes,
      uploadedPartIndexes: uploaded.uploadedPartIndexes,
    };
  }

  private getUploadedSessionState(
    session: UploadSession,
    parts: UploadSessionPart[],
  ) {
    const uploadedBytes = parts.reduce(
      (total, part) => total + part.sizeBytes,
      0,
    );
    const uploadRatio =
      session.sizeBytes > 0 ? uploadedBytes / session.sizeBytes : 1;
    return {
      uploadedBytes,
      uploadedPartIndexes: parts
        .map((part) => part.partIndex)
        .sort((left, right) => left - right),
      progress: Math.min(95, Math.round(uploadRatio * 95 * 10) / 10),
    };
  }

  private getExpectedPartRange(session: UploadSession, partIndex: number) {
    if (!Number.isInteger(partIndex) || partIndex < 0) {
      throw new BadRequestException('Upload chunk index is invalid');
    }
    const totalParts = this.getUploadSessionPartCount(session);
    if (partIndex >= totalParts) {
      throw new BadRequestException('Upload chunk index is outside session');
    }
    const startByte = partIndex * session.chunkSizeBytes;
    const endByte = Math.min(
      session.sizeBytes - 1,
      startByte + session.chunkSizeBytes - 1,
    );
    return {
      startByte,
      endByte,
      sizeBytes: endByte - startByte + 1,
    };
  }

  private assertUploadSessionComplete(
    session: UploadSession,
    parts: UploadSessionPart[],
  ) {
    const totalParts = this.getUploadSessionPartCount(session);
    if (parts.length !== totalParts) {
      throw new BadRequestException('Upload session is missing chunks');
    }
    const expectedIndexes = new Set(
      Array.from({ length: totalParts }, (_, index) => index),
    );
    for (const part of parts) {
      const expected = this.getExpectedPartRange(session, part.partIndex);
      if (
        !expectedIndexes.delete(part.partIndex) ||
        part.startByte !== expected.startByte ||
        part.endByte !== expected.endByte ||
        part.sizeBytes !== expected.sizeBytes ||
        (Boolean(session.multipartUploadId) && !part.eTag)
      ) {
        throw new BadRequestException('Upload session chunks are invalid');
      }
    }
    if (expectedIndexes.size > 0) {
      throw new BadRequestException('Upload session is missing chunks');
    }
  }

  private getUploadSessionPartCount(session: UploadSession) {
    if (session.sizeBytes === 0) return 0;
    return Math.ceil(session.sizeBytes / session.chunkSizeBytes);
  }

  private assertWritableUploadSession(session: UploadSession) {
    if (session.status === 'completed' || session.status === 'canceled') {
      throw new BadRequestException('Upload session is not writable');
    }
  }

  private canReuseSession(session: UploadSession, distributedStorage: boolean) {
    return distributedStorage
      ? Boolean(session.multipartUploadId)
      : !session.multipartUploadId;
  }

  private async requireUploadSession(sessionId: string) {
    const session = await this.uploadSessionsRepository.findById(sessionId);
    if (!session) throw new NotFoundException('Upload session not found');
    return session;
  }

  private async requireCompletableUploadSession(dto: CompleteUploadDto) {
    const session = await this.requireUploadSession(dto.uploadSessionId ?? '');
    if (
      session.workspaceId !== dto.workspaceId ||
      session.objectKey !== dto.objectKey ||
      session.fileName !== dto.fileName ||
      session.sizeBytes !== dto.sizeBytes ||
      (session.parentNodeId ?? null) !== (dto.parentNodeId ?? null)
    ) {
      throw new BadRequestException(
        'Upload session does not match completion payload',
      );
    }
    if (session.status === 'canceled') {
      throw new BadRequestException('Upload session was canceled');
    }
    return session;
  }

  private normalizeChunkSize(
    value: number | undefined,
    options: { distributedStorage: boolean },
  ) {
    const minimum = options.distributedStorage ? 5 * 1024 * 1024 : 64 * 1024;
    const fallback = options.distributedStorage
      ? 8 * 1024 * 1024
      : 4 * 1024 * 1024;
    const raw = Math.trunc(value ?? fallback);
    return Math.min(Math.max(raw, minimum), 32 * 1024 * 1024);
  }

  private createUploadObjectKey(
    dto: CreateUploadIntentDto,
    distributedStorage: boolean,
  ) {
    return createFileObjectKey({
      distributedStorage,
      fileName: dto.fileName,
      workspaceId: dto.workspaceId,
    });
  }

  private assertUploadObjectKey(dto: CompleteUploadDto) {
    if (!isUploadObjectKeyForPayload(dto)) {
      throw new BadRequestException(
        'Upload object key does not match a valid upload intent',
      );
    }
  }

  private normalizeListState(value?: string): FileNodeListState {
    if (value === 'archived' || value === 'all') return value;
    return 'active';
  }

  private normalizeNodeName(value: string) {
    const name = value.trim();
    if (!name) throw new BadRequestException('File node name is required');
    if (
      name.includes('/') ||
      name.includes('\\') ||
      name === '.' ||
      name === '..'
    ) {
      throw new BadRequestException('File node name is not valid');
    }
    return name;
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

  private createCopyName(name: string) {
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex > 0 && dotIndex < name.length - 1) {
      return `${name.slice(0, dotIndex)} copy${name.slice(dotIndex)}`;
    }
    return `${name} copy`;
  }

  private async assertValidParent(
    workspaceId: string,
    parentNodeId: string | null,
    sourceNodeId?: string,
  ) {
    if (!parentNodeId) return;
    if (parentNodeId === sourceNodeId) {
      throw new BadRequestException('A file node cannot be moved into itself');
    }

    let parent = await this.requireActiveNode(parentNodeId);
    if (parent.workspaceId !== workspaceId) {
      throw new BadRequestException(
        'Parent folder belongs to another workspace',
      );
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
      parent = await this.requireActiveNode(parent.parentNodeId);
    }
  }

  private async requireActiveNode(nodeId: string) {
    const node = await this.fileNodesRepository.findById(nodeId);
    if (!node) throw new NotFoundException('File node not found');
    if (node.archivedAt) {
      throw new ForbiddenException('File node is archived');
    }
    return node;
  }

  private buildDownloadManifest(node: {
    id: string;
    name: string;
    owner: string;
    kind: string;
    mimeType: string;
    sizeBytes: number | null;
    objectKey: string | null;
  }) {
    return [
      ['name', node.name],
      ['nodeId', node.id],
      ['owner', node.owner],
      ['kind', node.kind],
      ['mimeType', node.mimeType],
      ['sizeBytes', node.sizeBytes ?? 'folder'],
      ['objectKey', node.objectKey ?? 'folder'],
    ]
      .map((row) => row.join('\t'))
      .join('\n');
  }

  private withPreviewCapability(
    intent: PreviewIntentResponse,
    capability: FilePreviewCapability,
  ): PreviewIntentResponse {
    return {
      ...intent,
      previewType: capability.renderMode,
      renderMode: capability.renderMode,
      capability,
      error: capability.supported
        ? (intent.error ?? null)
        : (intent.error ?? this.getPreviewUnsupportedError(capability)),
    };
  }

  private getPreviewUnsupportedError(capability: FilePreviewCapability) {
    switch (capability.reason) {
      case 'archive':
        return 'Archives are available for download only';
      case 'folder':
        return 'Folders do not have file previews';
      case 'html-disabled':
        return 'HTML-like files are available for download only';
      case 'missing-object':
        return 'File content is not available for preview';
      case 'too-large':
        return 'File is too large to preview';
      default:
        return 'Preview is not supported for this file type';
    }
  }
}

function resolveEffectiveQuotaBytes(
  workspaceQuotaBytes: number | null | undefined,
  storagePolicyQuotaBytes: number | null,
) {
  const candidates = [workspaceQuotaBytes, storagePolicyQuotaBytes].filter(
    (quotaBytes): quotaBytes is number =>
      quotaBytes !== null && quotaBytes !== undefined && quotaBytes > 0,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}
