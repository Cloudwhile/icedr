import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DownloadResponsePayload } from '../../common/http/download-response';
import { StorageService } from '../storage/storage.service';
import {
  type BatchDownloadIntentResponse,
  type BatchFileNodeIdsDto,
  type CreateDownloadIntentDto,
  type DownloadIntentResponse,
  type FileNodeResponse,
  type PreviewIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import {
  resolveFilePreviewCapability,
  type FilePreviewCapability,
} from './file-preview-policy';

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
export class FileDownloadPreviewService {
  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
  ) {}

  async createDownloadIntent(
    nodeId: string,
    dto: CreateDownloadIntentDto,
    options: FileAuditOptions = {},
  ) {
    const node = await this.requireActiveNode(nodeId, options);
    const purpose = dto.purpose ?? 'download';
    if (purpose === 'preview' && !node.previewCapability.supported) {
      throw new BadRequestException('File type is not available for preview');
    }
    const method = node.objectKey ? 'stream' : 'manifest';
    const intent = await this.fileNodesRepository.createDownloadIntent({
      actorUserId: options.actorUserId,
      auditMetadata: options.auditMetadata,
      filename: node.name,
      method,
      nodeId: node.id,
      purpose,
      visitor: this.toDownloadVisitor(options.auditMetadata),
    });
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
      purpose,
      availableAt: new Date().toISOString(),
      expiresAt: intent.expiresAt,
      downloadUrl: `/api/file-nodes/${encodeURIComponent(node.id)}/download?downloadId=${encodeURIComponent(intent.downloadId)}`,
      lifecycle: intent.lifecycle,
    } satisfies DownloadIntentResponse;
  }

  async createBatchDownloadIntents(
    dto: BatchFileNodeIdsDto,
    options: FileAuditOptions = {},
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

  async downloadFileNode(
    nodeId: string,
    downloadId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> & {
      range?: string;
    } = {},
  ) {
    const visitor = this.toDownloadVisitor(options.auditMetadata);
    const availableIntent =
      await this.fileNodesRepository.findAvailableDownloadIntent({
        downloadId,
        nodeId,
        visitor,
      });
    if (!availableIntent) {
      throw new NotFoundException('Download intent not found');
    }

    const node = await this.requireActiveNode(nodeId);
    const claim = await this.fileNodesRepository.claimDownloadIntent({
      downloadId,
      nodeId,
      visitor,
    });
    if (!claim) {
      throw new NotFoundException('Download intent not found');
    }
    const intent = claim.intent;

    let preparedDownload: DownloadResponsePayload | null = null;
    try {
      if (intent.method === 'stream' && node.objectKey) {
        const object = await this.storageService.openObjectStream({
          objectKey: node.objectKey,
          range: options.range,
        });
        preparedDownload = {
          ...object,
          contentType: node.mimeType || object.contentType,
          method: 'stream' as const,
          filename: node.name,
          purpose: intent.purpose,
        };
      } else {
        preparedDownload = {
          method: 'manifest' as const,
          filename: `${node.name}.txt`,
          contentType: 'text/plain; charset=utf-8',
          content: this.buildDownloadManifest(node),
          purpose: intent.purpose,
        };
      }
    } catch (error) {
      this.destroyPreparedFileDownload(preparedDownload);
      await this.failClaimedDownloadIntent(downloadId, claim.claimToken);
      throw error;
    }

    let committedIntent;
    try {
      committedIntent = await this.fileNodesRepository.commitDownloadIntent({
        audit:
          intent.purpose === 'download'
            ? {
                action: 'file.download_started',
                target: node.id,
                nodeId: node.id,
                workspaceId: node.workspaceId,
                metadata: {
                  ...intent.auditMetadata,
                  ...options.auditMetadata,
                },
              }
            : undefined,
        claimToken: claim.claimToken,
        downloadId,
        purpose: intent.purpose,
      });
    } catch (error) {
      this.destroyPreparedFileDownload(preparedDownload);
      await this.failClaimedDownloadIntent(downloadId, claim.claimToken);
      throw error;
    }
    if (!committedIntent) {
      this.destroyPreparedFileDownload(preparedDownload);
      await this.failClaimedDownloadIntent(downloadId, claim.claimToken);
      throw new NotFoundException('Download intent not found');
    }
    return preparedDownload;
  }

  async createVersionDownloadIntent(
    nodeId: string,
    versionId: string,
    options: FileAuditOptions = {},
  ) {
    const node = await this.requireActiveNode(nodeId, options);
    const version = await this.fileNodesRepository.findVersion(
      nodeId,
      versionId,
    );
    if (!version) throw new NotFoundException('File version not found');
    const filename = `v${version.versionNumber}-${node.name}`;
    const intent = await this.fileNodesRepository.createDownloadIntent({
      actorUserId: options.actorUserId,
      auditMetadata: options.auditMetadata,
      filename,
      method: 'stream',
      nodeId,
      purpose: 'download',
      versionId,
      visitor: this.toDownloadVisitor(options.auditMetadata),
    });
    await this.fileNodesRepository.recordAudit(
      'file.download_intent_created',
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
      downloadId: intent.downloadId,
      nodeId,
      filename,
      method: 'stream' as const,
      purpose: 'download' as const,
      availableAt: new Date().toISOString(),
      expiresAt: intent.expiresAt,
      downloadUrl: `/api/file-nodes/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(versionId)}/download?downloadId=${encodeURIComponent(intent.downloadId)}`,
      lifecycle: intent.lifecycle,
    } satisfies DownloadIntentResponse;
  }

  async downloadFileVersion(
    nodeId: string,
    versionId: string,
    downloadId: string,
    options: Pick<FileAuditOptions, 'auditMetadata'> & { range?: string } = {},
  ) {
    const visitor = this.toDownloadVisitor(options.auditMetadata);
    const availableIntent =
      await this.fileNodesRepository.findAvailableDownloadIntent({
        downloadId,
        nodeId,
        versionId,
        visitor,
      });
    if (!availableIntent || availableIntent.purpose !== 'download') {
      throw new NotFoundException('Download intent not found');
    }
    const node = await this.requireActiveNode(nodeId);
    const version = await this.fileNodesRepository.findVersion(
      nodeId,
      versionId,
    );
    if (!version) throw new NotFoundException('File version not found');

    const claim = await this.fileNodesRepository.claimDownloadIntent({
      downloadId,
      nodeId,
      versionId,
      visitor,
    });
    if (!claim || claim.intent.purpose !== 'download') {
      throw new NotFoundException('Download intent not found');
    }
    const intent = claim.intent;

    let preparedDownload: Extract<
      DownloadResponsePayload,
      { method: 'stream' }
    > | null = null;
    try {
      const object = await this.storageService.openObjectStream({
        objectKey: version.objectKey,
        range: options.range,
      });
      preparedDownload = {
        ...object,
        contentType: version.mimeType || object.contentType,
        filename: intent.filename,
        method: 'stream' as const,
        purpose: 'download' as const,
      };
    } catch (error) {
      this.destroyPreparedFileDownload(preparedDownload);
      await this.failClaimedDownloadIntent(downloadId, claim.claimToken);
      throw error;
    }

    let committedIntent;
    try {
      committedIntent = await this.fileNodesRepository.commitDownloadIntent({
        audit: {
          action: 'file.version_downloaded',
          target: nodeId,
          nodeId,
          workspaceId: node.workspaceId,
          metadata: {
            ...intent.auditMetadata,
            ...options.auditMetadata,
            versionId,
            versionNumber: version.versionNumber,
          },
        },
        claimToken: claim.claimToken,
        downloadId,
        purpose: 'download',
      });
    } catch (error) {
      this.destroyPreparedFileDownload(preparedDownload);
      await this.failClaimedDownloadIntent(downloadId, claim.claimToken);
      throw error;
    }
    if (!committedIntent) {
      this.destroyPreparedFileDownload(preparedDownload);
      await this.failClaimedDownloadIntent(downloadId, claim.claimToken);
      throw new NotFoundException('Download intent not found');
    }
    return preparedDownload;
  }

  async createPreviewIntent(nodeId: string, options: FileAuditOptions = {}) {
    const node = await this.requireActiveNode(nodeId, options);
    const capability = resolveFilePreviewCapability(node);
    const status: PreviewIntentResponse['status'] = capability.supported
      ? 'completed'
      : 'failed';
    const intent = await this.fileNodesRepository.createPreviewArtifact(
      node,
      status,
      capability.renderMode,
      capability.supported ? null : this.getPreviewUnsupportedError(capability),
      {
        actorUserId: options.actorUserId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        failureCode: capability.supported
          ? null
          : capability.reason === 'too-large'
            ? 'PREVIEW_TOO_LARGE'
            : 'PREVIEW_UNSUPPORTED',
      },
    );
    await this.fileNodesRepository.recordAudit(
      'file.preview_requested',
      node.id,
      { metadata: options.auditMetadata },
    );
    return this.withPreviewCapability(intent, capability);
  }

  async getPreviewStatus(
    nodeId: string,
    previewId: string,
    access: FileAccessOptions = {},
  ) {
    const intent =
      await this.fileNodesRepository.findPreviewArtifact(previewId);
    if (!intent || intent.nodeId !== nodeId) {
      throw new NotFoundException('Preview intent not found');
    }
    const node = await this.requireActiveNode(nodeId, access);
    return this.withPreviewCapability(
      intent,
      resolveFilePreviewCapability(node),
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

  private async requireActiveNode(
    nodeId: string,
    access: FileAccessOptions = {},
  ) {
    const node = await this.fileNodesRepository.findById(nodeId);
    if (!node) throw new NotFoundException('File node not found');
    this.assertNodeAccess(node, access);
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

  private destroyPreparedFileDownload(
    download: DownloadResponsePayload | null,
  ) {
    if (download && 'stream' in download) download.stream.destroy();
  }

  private async failClaimedDownloadIntent(
    downloadId: string,
    claimToken: string,
  ) {
    try {
      await this.fileNodesRepository.failDownloadIntent({
        claimToken,
        downloadId,
        failureCode: 'DOWNLOAD_FAILED',
      });
    } catch {
      return;
    }
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
    ]
      .map((row) => row.join('\t'))
      .join('\n');
  }

  private toDownloadVisitor(auditMetadata?: AuditMetadata): {
    ip?: string;
    userAgent?: string;
  } {
    return {
      ip: typeof auditMetadata?.ip === 'string' ? auditMetadata.ip : undefined,
      userAgent:
        typeof auditMetadata?.userAgent === 'string'
          ? auditMetadata.userAgent
          : undefined,
    };
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
