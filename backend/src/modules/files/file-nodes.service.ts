import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { TransfersService } from '../downloads/transfers/transfers.service';
import {
  CompleteUploadDto,
  CreateDownloadIntentDto,
  CreateUploadIntentDto,
  DownloadIntentResponse,
  FileNodeListState,
  PreviewIntentResponse,
  UpdateFileNodeStateDto,
  UploadIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';

@Injectable()
export class FileNodesService {
  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
    private readonly transfersService: TransfersService,
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
    const objectKey = this.createUploadObjectKey(
      dto,
      distributedStorage ? 'uploads' : 'local/uploads',
    );
    const transfer = await this.transfersService.createUploadTransfer({
      workspaceId: dto.workspaceId,
      objectKey,
      name: dto.fileName,
    });

    if (!distributedStorage) {
      await this.fileNodesRepository.recordAudit(
        'file.upload_intent_created',
        objectKey,
      );

      return {
        objectKey,
        transferId: transfer.id,
        uploadMethod: 'backend-local' as const,
        uploadUrl: `/api/storage/local-uploads?objectKey=${encodeURIComponent(objectKey)}`,
        headers: {
          'Content-Type': dto.mimeType ?? 'application/octet-stream',
        },
        expiresInSeconds: 900,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      };
    }

    const upload = await this.storageService.createPresignedUpload(
      objectKey,
      dto.mimeType,
    );
    await this.fileNodesRepository.recordAudit(
      'file.upload_intent_created',
      objectKey,
    );

    return {
      objectKey,
      transferId: transfer.id,
      uploadMethod: 'presigned-url',
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
      expiresAt: upload.expiresAt,
    };
  }

  async completeUpload(dto: CompleteUploadDto) {
    this.assertUploadObjectKey(dto);
    await this.storageService.assertObjectExists(dto.objectKey);
    const node = await this.fileNodesRepository.completeUpload({
      ...dto,
      owner: dto.owner?.trim() || undefined,
    });
    await this.fileNodesRepository.recordAudit(
      'file.upload_completed',
      node.id,
    );
    if (dto.transferId) {
      await this.transfersService.completeTransfer({
        transferId: dto.transferId,
        nodeId: node.id,
      });
    }
    return node;
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

  private createUploadObjectKey(
    dto: CreateUploadIntentDto,
    prefix = 'uploads',
  ) {
    const workspaceSegment = this.encodeObjectKeySegment(dto.workspaceId);
    const parentSegment = dto.parentNodeId
      ? this.encodeObjectKeySegment(dto.parentNodeId)
      : 'root';
    const fileSegment = this.encodeObjectKeySegment(dto.fileName);
    const nonce = randomBytes(12).toString('base64url');

    return [
      prefix,
      workspaceSegment,
      parentSegment,
      `${Date.now()}-${nonce}-${fileSegment}`,
    ].join('/');
  }

  private assertUploadObjectKey(dto: CompleteUploadDto) {
    const parts = dto.objectKey.split('/');
    const isLocal = parts[0] === 'local' && parts[1] === 'uploads';
    const prefixLength = isLocal ? 2 : 1;
    const expectedWorkspace = this.encodeObjectKeySegment(dto.workspaceId);
    const expectedParent = dto.parentNodeId
      ? this.encodeObjectKeySegment(dto.parentNodeId)
      : 'root';
    const expectedFileName = this.encodeObjectKeySegment(dto.fileName);
    const fileSegment = parts[prefixLength + 2] ?? '';

    if (
      parts.length !== prefixLength + 3 ||
      (!isLocal && parts[0] !== 'uploads') ||
      parts[prefixLength] !== expectedWorkspace ||
      parts[prefixLength + 1] !== expectedParent ||
      !/^\d{10,}-[A-Za-z0-9_-]{16}-.+$/.test(fileSegment) ||
      !fileSegment.endsWith(`-${expectedFileName}`) ||
      fileSegment.includes('\\')
    ) {
      throw new BadRequestException(
        'Upload object key does not match a valid upload intent',
      );
    }
  }

  private encodeObjectKeySegment(value: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new BadRequestException('Upload key segment is empty');
    return encodeURIComponent(trimmed);
  }

  private normalizeListState(value?: string): FileNodeListState {
    if (value === 'archived' || value === 'all') return value;
    return 'active';
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
