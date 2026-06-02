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
import { TransfersService } from '../downloads/transfers/transfers.service';
import {
  CompleteUploadPartDto,
  CompleteUploadDto,
  CopyFileNodeDto,
  CreateDownloadIntentDto,
  CreateFolderDto,
  CreateUploadIntentDto,
  DownloadIntentResponse,
  FileNodeListState,
  MoveFileNodeDto,
  PreviewIntentResponse,
  RenameFileNodeDto,
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
import type { Readable } from 'stream';

@Injectable()
export class FileNodesService {
  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
    private readonly transfersService: TransfersService,
    private readonly uploadSessionsRepository: UploadSessionsRepository,
  ) {}

  listFileNodes(
    workspaceId?: string,
    parentNodeId?: string | null,
    options: { state?: string } = {},
  ) {
    const state = this.normalizeListState(options.state);
    return this.fileNodesRepository.list(workspaceId, parentNodeId, state);
  }

  getFileNode(id: string) {
    return this.fileNodesRepository.findById(id);
  }

  async createUploadIntent(
    dto: CreateUploadIntentDto,
  ): Promise<UploadIntentResponse> {
    const distributedStorage =
      await this.storageService.distributedStorageEnabled();
    const sizeBytes = Math.max(0, Math.trunc(dto.fileSizeBytes ?? 0));
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
          await this.cancelUploadSession(reusable.id);
        } else {
          const parts = await this.uploadSessionsRepository.listParts(
            reusable.id,
          );
          const uploaded = this.getUploadedSessionState(reusable, parts);
          await this.uploadSessionsRepository.updateStatus(
            reusable.id,
            'running',
          );
          await this.transfersService.updateTransfer(reusable.transferId, {
            status: 'running',
            progress: uploaded.progress,
          });
          return this.toUploadIntent(reusable, parts);
        }
      }
    }

    const objectKey = this.createUploadObjectKey(dto, distributedStorage);
    const transfer = await this.transfersService.createUploadTransfer({
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
    await this.transfersService.updateTransfer(session.transferId, {
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
    await this.transfersService.updateTransfer(session.transferId, {
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

  async cancelUploadSession(sessionId: string) {
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
    await this.transfersService.updateTransfer(session.transferId, {
      status: 'canceled',
    });
    return { ok: true };
  }

  async completeUpload(dto: CompleteUploadDto) {
    this.assertUploadObjectKey(dto);
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
    });
    await this.fileNodesRepository.recordAudit(
      'file.upload_completed',
      node.id,
    );
    const transferId = dto.transferId ?? uploadSession?.transferId;
    if (transferId) {
      await this.transfersService.completeTransfer({
        transferId,
        nodeId: node.id,
      });
    }
    return node;
  }

  async createFolder(dto: CreateFolderDto) {
    const name = this.normalizeNodeName(dto.name);
    await this.assertValidParent(dto.workspaceId, dto.parentNodeId ?? null);
    const node = await this.fileNodesRepository.createFolder({
      ...dto,
      name,
      owner: dto.owner?.trim() || undefined,
      parentNodeId: dto.parentNodeId ?? undefined,
    });
    await this.fileNodesRepository.recordAudit('file.folder_created', node.id);
    return node;
  }

  async renameFileNode(id: string, dto: RenameFileNodeDto) {
    const source = await this.requireActiveNode(id);
    const name = this.normalizeNodeName(dto.name);
    if (source.name === name) return source;
    const node = await this.fileNodesRepository.rename(id, name);
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.renamed', id);
    return node;
  }

  async moveFileNode(id: string, dto: MoveFileNodeDto) {
    const source = await this.requireActiveNode(id);
    const parentNodeId = dto.parentNodeId ?? null;
    await this.assertValidParent(source.workspaceId, parentNodeId, source.id);
    const node = await this.fileNodesRepository.move(id, parentNodeId);
    if (!node) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.moved', id);
    return node;
  }

  async copyFileNode(id: string, dto: CopyFileNodeDto) {
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
    await this.fileNodesRepository.recordAudit('file.copied', node.id);
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

  async updateFileNodeContent(id: string, dto: UpdateFileNodeContentDto) {
    const node = await this.requireActiveNode(id);
    this.assertTextEditableNode(node);
    if (!node.objectKey) {
      throw new BadRequestException('Folder content cannot be edited');
    }

    await this.storageService.writeObjectText(
      node.objectKey,
      dto.content,
      node.mimeType,
    );
    const updated = await this.fileNodesRepository.updateSize(
      id,
      Buffer.byteLength(dto.content, 'utf8'),
    );
    if (!updated) throw new NotFoundException('File node not found');
    await this.fileNodesRepository.recordAudit('file.content_updated', id);
    return {
      content: dto.content,
      id: updated.id,
      mimeType: updated.mimeType,
      name: updated.name,
      updatedAt: updated.updatedAt,
    };
  }

  async updateFileNodeState(id: string, dto: UpdateFileNodeStateDto) {
    if (dto.starred === undefined && dto.archived === undefined) {
      throw new BadRequestException('No file node state change provided');
    }
    const node = await this.fileNodesRepository.updateState(id, dto);
    if (!node) throw new NotFoundException('File node not found');
    if (dto.starred !== undefined) {
      await this.fileNodesRepository.recordAudit('file.starred_updated', id);
    }
    if (dto.archived === true) {
      await this.fileNodesRepository.recordAudit('file.archived', id);
    } else if (dto.archived === false) {
      await this.fileNodesRepository.recordAudit('file.restored', id);
    }
    return node;
  }

  async createDownloadIntent(nodeId: string, dto: CreateDownloadIntentDto) {
    void dto;
    const node = await this.requireActiveNode(nodeId);
    const method = node.objectKey ? 'presigned-url' : 'backend-manifest';
    const intent = await this.fileNodesRepository.createDownloadIntent(
      node,
      method,
    );
    await this.fileNodesRepository.recordAudit(
      'file.download_intent_created',
      node.id,
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

  async downloadFileNode(nodeId: string, downloadId: string) {
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
    await this.fileNodesRepository.recordAudit(
      'file.download_started',
      node.id,
    );

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

  async createPreviewIntent(nodeId: string) {
    const node = await this.requireActiveNode(nodeId);
    const status: PreviewIntentResponse['status'] =
      node.kind === 'archive' ? 'unsupported' : 'pending';

    const intent = await this.fileNodesRepository.createPreviewArtifact(
      node,
      status,
      node.kind,
      status === 'unsupported'
        ? 'Preview conversion is not supported for this file type'
        : null,
    );
    await this.fileNodesRepository.recordAudit(
      'file.preview_requested',
      node.id,
    );
    return intent;
  }

  async getPreviewStatus(nodeId: string, previewId: string) {
    const intent =
      await this.fileNodesRepository.findPreviewArtifact(previewId);
    if (!intent || intent.nodeId !== nodeId) {
      throw new NotFoundException('Preview intent not found');
    }
    return intent;
  }

  async getStorageUsage(workspaceId: string, quotaBytes: number | null) {
    const usage = await this.fileNodesRepository.getStorageUsage(workspaceId);
    const usagePercent =
      quotaBytes && quotaBytes > 0
        ? Math.min(100, Math.round((usage.usedBytes / quotaBytes) * 1000) / 10)
        : null;
    return {
      workspaceId,
      ...usage,
      quotaBytes,
      usagePercent,
      updatedAt: new Date().toISOString(),
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
      progress: Math.min(95, Math.round((5 + uploadRatio * 90) * 10) / 10),
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
    mimeType: string;
    name: string;
    objectKey: string | null;
    sizeBytes: number | null;
  }) {
    const extension = node.name.split('.').pop()?.toLowerCase() ?? '';
    const editable =
      node.mimeType.startsWith('text/') ||
      ['txt', 'md', 'markdown', 'json', 'csv', 'log', 'yaml', 'yml'].includes(
        extension,
      );
    if (!editable) {
      throw new BadRequestException('File type cannot be edited as text');
    }
    if ((node.sizeBytes ?? 0) > 1024 * 1024) {
      throw new BadRequestException('File is too large to edit as text');
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
}
