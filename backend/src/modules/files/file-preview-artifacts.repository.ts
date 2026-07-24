import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { PreviewArtifact } from '../../generated/prisma/client';
import {
  createTransferTaskLifecycle,
  normalizeTransferTaskStatus,
  type TransferTaskFailureCode,
} from '../../common/transfers/transfer-task-state';
import type { FileNodeResponse, PreviewIntentResponse } from './file-nodes.dto';
import {
  resolveFilePreviewCapability,
  type PreviewRenderMode,
} from './file-preview-policy';

@Injectable()
export class FilePreviewArtifactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPreviewArtifact(
    node: FileNodeResponse,
    status: PreviewIntentResponse['status'],
    previewType: PreviewIntentResponse['previewType'],
    error: string | null = null,
    options: {
      actorUserId?: string | null;
      expiresAt?: Date | null;
      failureCode?: TransferTaskFailureCode | null;
    } = {},
  ) {
    const id = `preview_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.previewArtifact.create({
      data: {
        id,
        nodeId: node.id,
        actorUserId: options.actorUserId ?? null,
        sourceObjectKey: node.objectKey,
        previewObjectKey: null,
        previewType,
        status: normalizeTransferTaskStatus(status),
        failureCode: options.failureCode ?? null,
        error,
        expiresAt: options.expiresAt ?? null,
      },
    });
    return this.mapPreviewArtifact(row);
  }

  async findPreviewArtifact(previewId: string) {
    const row = await this.prisma.previewArtifact.findUnique({
      where: { id: previewId },
    });
    return row ? this.mapPreviewArtifact(row) : null;
  }

  private mapPreviewArtifact(row: PreviewArtifact): PreviewIntentResponse {
    const inferredFailureCode =
      row.failureCode ??
      (row.status === 'unsupported' ? 'PREVIEW_UNSUPPORTED' : null);
    const lifecycle = createTransferTaskLifecycle({
      status: row.status,
      failureCode: inferredFailureCode,
      failureMessage: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
    });
    const legacyPreviewStatus: PreviewIntentResponse['legacyPreviewStatus'] =
      row.status === 'ready' || row.status === 'unsupported'
        ? row.status
        : lifecycle.status === 'completed'
          ? 'ready'
          : lifecycle.status === 'pending' || lifecycle.status === 'running'
            ? 'pending'
            : lifecycle.errorCode === 'PREVIEW_UNSUPPORTED' ||
                lifecycle.errorCode === 'PREVIEW_TOO_LARGE'
              ? 'unsupported'
              : 'failed';
    const renderMode = this.normalizeStoredPreviewType(row.previewType);
    const unsupported = legacyPreviewStatus === 'unsupported';
    const capability = row.nodeId
      ? {
          supported: !unsupported,
          renderMode,
          reason: unsupported
            ? ('unknown-type' as const)
            : ('previewable' as const),
          maxPreviewBytes: null,
          sanitized: false,
          downloadOnly: unsupported,
        }
      : resolveFilePreviewCapability({
          kind: 'doc',
          mimeType: 'application/octet-stream',
          name: '',
          objectKey: null,
          sizeBytes: null,
        });
    return {
      previewId: row.id,
      nodeId: row.nodeId,
      actorUserId: row.actorUserId,
      status: lifecycle.status,
      legacyPreviewStatus,
      previewType: row.previewType as PreviewIntentResponse['previewType'],
      renderMode,
      statusUrl: `/api/file-nodes/${encodeURIComponent(row.nodeId)}/preview/status`,
      capability,
      lifecycle,
      error: row.error,
    };
  }

  private normalizeStoredPreviewType(value: string): PreviewRenderMode {
    if (
      value === 'image' ||
      value === 'video' ||
      value === 'pdf' ||
      value === 'docx' ||
      value === 'markdown' ||
      value === 'text' ||
      value === 'metadata' ||
      value === 'download-only'
    ) {
      return value;
    }
    if (value === 'archive') return 'download-only';
    return 'metadata';
  }
}
