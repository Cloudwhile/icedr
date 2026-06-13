import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type {
  UploadSession as PrismaUploadSession,
  UploadSessionPart as PrismaUploadSessionPart,
} from '../../generated/prisma/client';

export type UploadSessionStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

export type UploadSession = {
  id: string;
  transferId: string;
  workspaceId: string;
  spaceScope: 'workspace' | 'personal';
  objectKey: string;
  multipartUploadId: string | null;
  resumeKey: string | null;
  fileName: string;
  parentNodeId: string | null;
  mimeType: string;
  sizeBytes: number;
  chunkSizeBytes: number;
  status: UploadSessionStatus;
  createdAt: string;
  updatedAt: string;
};

export type UploadSessionPart = {
  sessionId: string;
  partIndex: number;
  startByte: number;
  endByte: number;
  sizeBytes: number;
  eTag: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class UploadSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    chunkSizeBytes: number;
    fileName: string;
    mimeType: string;
    multipartUploadId?: string | null;
    objectKey: string;
    parentNodeId?: string | null;
    resumeKey?: string | null;
    sizeBytes: number;
    spaceScope?: 'workspace' | 'personal';
    transferId: string;
    workspaceId: string;
  }) {
    const id = `upload_session_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.uploadSession.create({
      data: {
        id,
        transferId: input.transferId,
        workspaceId: input.workspaceId,
        spaceScope: input.spaceScope ?? 'workspace',
        objectKey: input.objectKey,
        multipartUploadId: input.multipartUploadId ?? null,
        resumeKey: input.resumeKey ?? null,
        fileName: input.fileName,
        parentNodeId: input.parentNodeId ?? null,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        chunkSizeBytes: input.chunkSizeBytes,
        status: 'running',
      },
    });
    return this.mapSession(row);
  }

  async findReusable(input: {
    fileName: string;
    parentNodeId?: string | null;
    resumeKey: string;
    sizeBytes: number;
    spaceScope?: 'workspace' | 'personal';
    workspaceId: string;
  }) {
    const row = await this.prisma.uploadSession.findFirst({
      where: {
        workspaceId: input.workspaceId,
        spaceScope: input.spaceScope ?? 'workspace',
        resumeKey: input.resumeKey,
        fileName: input.fileName,
        parentNodeId: input.parentNodeId ?? null,
        sizeBytes: BigInt(input.sizeBytes),
        status: { in: ['running', 'paused', 'failed'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.mapSession(row) : null;
  }

  async findById(id: string) {
    const row = await this.prisma.uploadSession.findUnique({ where: { id } });
    return row ? this.mapSession(row) : null;
  }

  async listParts(sessionId: string) {
    const rows = await this.prisma.uploadSessionPart.findMany({
      where: { sessionId },
      orderBy: { partIndex: 'asc' },
    });
    return rows.map((row) => this.mapPart(row));
  }

  async upsertPart(input: {
    eTag?: string | null;
    endByte: number;
    partIndex: number;
    sessionId: string;
    sizeBytes: number;
    startByte: number;
  }) {
    const row = await this.prisma.uploadSessionPart.upsert({
      where: {
        sessionId_partIndex: {
          sessionId: input.sessionId,
          partIndex: input.partIndex,
        },
      },
      create: {
        sessionId: input.sessionId,
        partIndex: input.partIndex,
        startByte: BigInt(input.startByte),
        endByte: BigInt(input.endByte),
        sizeBytes: BigInt(input.sizeBytes),
        eTag: input.eTag ?? null,
      },
      update: {
        startByte: BigInt(input.startByte),
        endByte: BigInt(input.endByte),
        sizeBytes: BigInt(input.sizeBytes),
        eTag: input.eTag ?? null,
        updatedAt: new Date(),
      },
    });
    await this.touchSession(input.sessionId);
    return this.mapPart(row);
  }

  async updateStatus(id: string, status: UploadSessionStatus) {
    const existing = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    const row = await this.prisma.uploadSession.update({
      where: { id },
      data: {
        status,
        updatedAt: new Date(),
      },
    });
    return this.mapSession(row);
  }

  private async touchSession(id: string) {
    await this.prisma.uploadSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  private mapSession(row: PrismaUploadSession): UploadSession {
    return {
      id: row.id,
      transferId: row.transferId,
      workspaceId: row.workspaceId,
      spaceScope: row.spaceScope as 'workspace' | 'personal',
      objectKey: row.objectKey,
      multipartUploadId: row.multipartUploadId,
      resumeKey: row.resumeKey,
      fileName: row.fileName,
      parentNodeId: row.parentNodeId,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      chunkSizeBytes: row.chunkSizeBytes,
      status: row.status as UploadSessionStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapPart(row: PrismaUploadSessionPart): UploadSessionPart {
    return {
      sessionId: row.sessionId,
      partIndex: row.partIndex,
      startByte: Number(row.startByte),
      endByte: Number(row.endByte),
      sizeBytes: Number(row.sizeBytes),
      eTag: row.eTag,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
