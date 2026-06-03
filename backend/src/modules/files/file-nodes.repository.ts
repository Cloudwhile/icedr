import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { createAuditEvent } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type FileDownloadIntent,
  type FileNode,
  type PreviewArtifact,
} from '../../generated/prisma/client';
import {
  CompleteUploadDto,
  CreateFolderDto,
  DownloadIntentResponse,
  FileNodeListState,
  FileNodeKind,
  FileNodeResponse,
  PreviewIntentResponse,
} from './file-nodes.dto';
import {
  resolveFilePreviewCapability,
  type PreviewRenderMode,
} from './file-preview-policy';

export type FileAuditAction =
  | 'file.folder_created'
  | 'file.renamed'
  | 'file.moved'
  | 'file.copied'
  | 'file.content_updated'
  | 'file.upload_intent_created'
  | 'file.upload_completed'
  | 'file.starred_updated'
  | 'file.archived'
  | 'file.restored'
  | 'file.download_intent_created'
  | 'file.download_started'
  | 'file.preview_requested';

@Injectable()
export class FileNodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    workspaceId?: string,
    parentNodeId?: string | null,
    state: FileNodeListState = 'active',
  ) {
    const rows = await this.prisma.fileNode.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        ...(parentNodeId !== undefined ? { parentNodeId } : {}),
        ...(state === 'active' ? { archivedAt: null } : {}),
        ...(state === 'archived' ? { archivedAt: { not: null } } : {}),
      },
      orderBy: [{ parentNodeId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.mapRow(row));
  }

  async findById(id: string) {
    const row = await this.prisma.fileNode.findUnique({ where: { id } });
    return row ? this.mapRow(row) : null;
  }

  async createFolder(dto: CreateFolderDto) {
    const now = new Date();
    const row = await this.prisma.fileNode.create({
      data: {
        id: `node_${randomBytes(12).toString('base64url')}`,
        workspaceId: dto.workspaceId,
        parentNodeId: dto.parentNodeId ?? null,
        name: dto.name,
        kind: 'folder',
        mimeType: 'inode/directory',
        sizeBytes: null,
        objectKey: null,
        ownerName: dto.owner ?? '',
        starred: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.mapRow(row);
  }

  async rename(id: string, name: string) {
    return this.updateNode(id, { name, updatedAt: new Date() });
  }

  async move(id: string, parentNodeId: string | null) {
    return this.updateNode(id, { parentNodeId, updatedAt: new Date() });
  }

  async updateSize(id: string, sizeBytes: number) {
    return this.updateNode(id, {
      sizeBytes: BigInt(sizeBytes),
      updatedAt: new Date(),
    });
  }

  async copyTree(
    source: FileNodeResponse,
    options: { name?: string; parentNodeId: string | null },
  ) {
    const descendants = await this.collectDescendants(source.id);
    const rows = [source, ...descendants];
    const idMap = new Map<string, string>();
    rows.forEach((row) => {
      idMap.set(row.id, `node_${randomBytes(12).toString('base64url')}`);
    });

    const now = new Date();
    const copiedNodes: FileNodeResponse[] = [];
    for (const row of rows) {
      const copiedId = idMap.get(row.id);
      if (!copiedId) continue;
      const copiedParent =
        row.id === source.id
          ? options.parentNodeId
          : row.parentNodeId
            ? (idMap.get(row.parentNodeId) ?? null)
            : null;
      const copiedName =
        row.id === source.id ? options.name?.trim() || row.name : row.name;
      const copied = await this.prisma.fileNode.create({
        data: {
          id: copiedId,
          workspaceId: row.workspaceId,
          parentNodeId: copiedParent,
          name: copiedName,
          kind: row.kind,
          mimeType: row.mimeType,
          sizeBytes:
            row.sizeBytes === null || row.sizeBytes === undefined
              ? null
              : BigInt(row.sizeBytes),
          objectKey: row.objectKey,
          ownerName: row.owner,
          starred: false,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      copiedNodes.push(this.mapRow(copied));
    }
    return copiedNodes[0] ?? null;
  }

  async updateState(
    id: string,
    state: { starred?: boolean; archived?: boolean },
  ) {
    const data: Partial<Pick<FileNode, 'archivedAt' | 'starred'>> & {
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (state.starred !== undefined) {
      data.starred = state.starred;
    }
    if (state.archived !== undefined) {
      data.archivedAt = state.archived ? new Date() : null;
    }
    if (state.starred === undefined && state.archived === undefined) {
      return this.findById(id);
    }
    return this.updateNode(id, data);
  }

  async createDownloadIntent(
    node: FileNodeResponse,
    method: DownloadIntentResponse['method'],
  ) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const id = `fdl_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.fileDownloadIntent.create({
      data: {
        id,
        nodeId: node.id,
        filename: node.name,
        method,
        expiresAt: new Date(expiresAt),
      },
    });
    return this.mapDownloadIntent(row);
  }

  async findDownloadIntent(downloadId: string) {
    const row = await this.prisma.fileDownloadIntent.findUnique({
      where: { id: downloadId },
    });
    return row ? this.mapDownloadIntent(row) : null;
  }

  async createPreviewArtifact(
    node: FileNodeResponse,
    status: PreviewIntentResponse['status'],
    previewType: PreviewIntentResponse['previewType'],
    error: string | null = null,
  ) {
    const id = `preview_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.previewArtifact.create({
      data: {
        id,
        nodeId: node.id,
        sourceObjectKey: node.objectKey,
        previewObjectKey: null,
        previewType,
        status,
        error,
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

  async completeUpload(dto: CompleteUploadDto) {
    const now = new Date();
    const row = await this.prisma.fileNode.create({
      data: {
        id: `node_${randomBytes(12).toString('base64url')}`,
        workspaceId: dto.workspaceId,
        parentNodeId: dto.parentNodeId ?? null,
        name: dto.fileName,
        kind: this.getKind(dto.fileName, dto.mimeType),
        mimeType: dto.mimeType ?? 'application/octet-stream',
        sizeBytes: BigInt(dto.sizeBytes),
        objectKey: dto.objectKey,
        ownerName: dto.owner ?? '',
        starred: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return this.mapRow(row);
  }

  private async collectDescendants(parentId: string) {
    const collected: FileNodeResponse[] = [];
    const visit = async (id: string) => {
      const rows = await this.prisma.fileNode.findMany({
        where: {
          archivedAt: null,
          parentNodeId: id,
        },
        orderBy: { name: 'asc' },
      });
      for (const row of rows) {
        const node = this.mapRow(row);
        collected.push(node);
        await visit(node.id);
      }
    };

    await visit(parentId);
    return collected;
  }

  async recordAudit(action: FileAuditAction, target: string) {
    const node = action.startsWith('file.')
      ? await this.findById(target)
      : null;
    const event = createAuditEvent({
      action,
      actor: 'workspace',
      target,
      workspaceId: node?.workspaceId ?? 'workspace-default',
      nodeId: node?.id ?? (action.startsWith('file.') ? target : null),
      metadata: { source: 'file-nodes-service' },
    });

    await this.prisma.auditEvent.create({
      data: {
        id: event.id,
        action: event.action,
        actor: event.actor,
        target: event.target,
        workspaceId: event.workspaceId,
        shareToken: event.shareToken,
        nodeId: event.nodeId,
        metadata: event.metadata as Prisma.InputJsonValue,
        createdAt: new Date(event.createdAt),
      },
    });
  }

  async countAuditEvents(action?: FileAuditAction) {
    return this.prisma.auditEvent.count({
      where: action ? { action } : undefined,
    });
  }

  async getStorageUsage(workspaceId: string) {
    const [fileStats, folderCount] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: {
          archivedAt: null,
          sizeBytes: { not: null },
          workspaceId,
        },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileNode.count({
        where: {
          archivedAt: null,
          sizeBytes: null,
          workspaceId,
        },
      }),
    ]);
    return {
      usedBytes: Number(fileStats._sum.sizeBytes ?? 0),
      fileCount: fileStats._count._all,
      folderCount,
    };
  }

  private getKind(fileName: string, mimeType = ''): FileNodeKind {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (['xlsx', 'xls', 'csv'].includes(extension)) return 'sheet';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
      return 'image';
    }
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) {
      return 'video';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'archive';
    return 'doc';
  }

  private async updateNode(
    id: string,
    data: Prisma.FileNodeUpdateInput,
  ): Promise<FileNodeResponse | null> {
    const existing = await this.prisma.fileNode.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    const row = await this.prisma.fileNode.update({
      where: { id },
      data,
    });
    return this.mapRow(row);
  }

  private mapRow(row: FileNode): FileNodeResponse {
    const mapped = {
      id: row.id,
      workspaceId: row.workspaceId,
      parentNodeId: row.parentNodeId,
      name: row.name,
      kind: row.kind as FileNodeKind,
      mimeType: row.mimeType,
      sizeBytes:
        row.sizeBytes === null || row.sizeBytes === undefined
          ? null
          : Number(row.sizeBytes),
      objectKey: row.objectKey,
      owner: row.ownerName,
      starred: row.starred,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    return {
      ...mapped,
      previewCapability: resolveFilePreviewCapability(mapped),
    };
  }

  private mapDownloadIntent(row: FileDownloadIntent) {
    return {
      downloadId: row.id,
      nodeId: row.nodeId,
      filename: row.filename,
      method: row.method as DownloadIntentResponse['method'],
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapPreviewArtifact(row: PreviewArtifact): PreviewIntentResponse {
    const renderMode = this.normalizeStoredPreviewType(row.previewType);
    const capability = row.nodeId
      ? {
          supported: row.status !== 'unsupported',
          renderMode,
          reason:
            row.status === 'unsupported'
              ? ('unknown-type' as const)
              : ('previewable' as const),
          maxPreviewBytes: null,
          sanitized: false,
          downloadOnly: row.status === 'unsupported',
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
      status: row.status as PreviewIntentResponse['status'],
      previewType: row.previewType as PreviewIntentResponse['previewType'],
      renderMode,
      statusUrl: `/api/file-nodes/${encodeURIComponent(row.nodeId)}/preview/status`,
      capability,
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
