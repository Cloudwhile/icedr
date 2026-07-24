import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { TransferTaskFailureCode } from '../../common/transfers/transfer-task-state';
import { UploadSessionCompletionStore } from './upload-session-completion';
import { UploadSessionLifecycleStore } from './upload-session-lifecycle';
import { UploadSessionPartsStore } from './upload-session-parts';
import {
  mapUploadSession,
  type UploadCompletionClaim,
  type UploadPartInput,
  type UploadPartWriteClaim,
  type UploadSessionStatus,
} from './upload-session-types';

export type {
  UploadCompletionClaim,
  UploadPartWriteClaim,
  UploadSession,
  UploadSessionPart,
  UploadSessionStatus,
} from './upload-session-types';

@Injectable()
export class UploadSessionsRepository {
  private readonly completion: UploadSessionCompletionStore;
  private readonly lifecycle: UploadSessionLifecycleStore;
  private readonly parts: UploadSessionPartsStore;

  constructor(private readonly prisma: PrismaService) {
    this.completion = new UploadSessionCompletionStore(prisma);
    this.lifecycle = new UploadSessionLifecycleStore(prisma);
    this.parts = new UploadSessionPartsStore(prisma);
  }

  async create(input: {
    chunkSizeBytes: number;
    fileName: string;
    mimeType: string;
    multipartUploadId?: string | null;
    objectKey: string;
    ownerUserId?: string | null;
    parentNodeId?: string | null;
    resumeKey?: string | null;
    sizeBytes: number;
    spaceScope?: 'workspace' | 'personal';
    conflictStrategy: 'overwrite' | 'rename' | 'skip' | 'version';
    expiresAt: Date;
    transferId: string;
    workspaceId: string;
  }) {
    const id = `upload_session_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.uploadSession.create({
      data: {
        id,
        transferId: input.transferId,
        nodeId: null,
        ownerUserId: input.ownerUserId ?? null,
        workspaceId: input.workspaceId,
        spaceScope: input.spaceScope ?? 'workspace',
        conflictStrategy: input.conflictStrategy,
        objectKey: input.objectKey,
        multipartUploadId: input.multipartUploadId ?? null,
        resumeKey: input.resumeKey ?? null,
        fileName: input.fileName,
        parentNodeId: input.parentNodeId ?? null,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        chunkSizeBytes: input.chunkSizeBytes,
        status: 'running',
        failureCode: null,
        expiresAt: input.expiresAt,
        completionToken: null,
        completionStartedAt: null,
        storageFinalizedAt: null,
      },
    });
    return mapUploadSession(row);
  }

  async findReusable(input: {
    fileName: string;
    parentNodeId?: string | null;
    ownerUserId?: string | null;
    resumeKey: string;
    sizeBytes: number;
    spaceScope?: 'workspace' | 'personal';
    conflictStrategy: 'overwrite' | 'rename' | 'skip' | 'version';
    workspaceId: string;
  }) {
    const now = new Date();
    const row = await this.prisma.uploadSession.findFirst({
      where: {
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId ?? null,
        spaceScope: input.spaceScope ?? 'workspace',
        conflictStrategy: input.conflictStrategy,
        resumeKey: input.resumeKey,
        fileName: input.fileName,
        parentNodeId: input.parentNodeId ?? null,
        sizeBytes: BigInt(input.sizeBytes),
        status: { in: ['running', 'paused', 'failed'] },
        completionToken: null,
        storageFinalizedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapUploadSession(row) : null;
  }

  async findById(id: string) {
    const row = await this.prisma.uploadSession.findUnique({ where: { id } });
    return row ? mapUploadSession(row) : null;
  }

  listParts(sessionId: string) {
    return this.parts.list(sessionId);
  }

  upsertPart(input: UploadPartInput) {
    return this.parts.upsert(input);
  }

  claimPartWrite(id: string): Promise<UploadPartWriteClaim | null> {
    return this.parts.claimWrite(id);
  }

  commitPartWrite(writeToken: string, input: UploadPartInput) {
    return this.parts.commitWrite(writeToken, input);
  }

  releasePartWrite(id: string, writeToken: string) {
    return this.parts.releaseWrite(id, writeToken);
  }

  setLegacyExpiry(id: string, expiresAt: Date) {
    return this.lifecycle.setLegacyExpiry(id, expiresAt);
  }

  updateStatus(
    id: string,
    status: UploadSessionStatus,
    options: {
      expiresAt?: Date;
      expectedStatus?: UploadSessionStatus;
      failureCode?: TransferTaskFailureCode | null;
      nodeId?: string | null;
    } = {},
  ) {
    return this.lifecycle.updateStatus(id, status, options);
  }

  resumeSession(
    id: string,
    expectedStatus: UploadSessionStatus,
    progress: number,
  ) {
    return this.lifecycle.resume(id, expectedStatus, progress);
  }

  claimCompletion(
    id: string,
    expectedStatus: Extract<UploadSessionStatus, 'running' | 'failed'>,
  ): Promise<UploadCompletionClaim | null> {
    return this.completion.claim(id, expectedStatus);
  }

  refreshCompletionClaim(id: string, completionToken: string) {
    return this.completion.refresh(id, completionToken);
  }

  markStorageFinalized(id: string, completionToken: string) {
    return this.completion.markStorageFinalized(id, completionToken);
  }

  persistCompletionNode(id: string, completionToken: string, nodeId: string) {
    return this.completion.persistNode(id, completionToken, nodeId);
  }

  completeCompletionClaim(
    id: string,
    completionToken: string,
    nodeId: string,
    auditMetadata: Record<string, unknown> = {},
  ) {
    return this.completion.complete(id, completionToken, nodeId, auditMetadata);
  }

  transitionFailureState(
    id: string,
    status: Extract<UploadSessionStatus, 'failed' | 'expired'>,
    options: {
      auditMetadata?: Record<string, unknown>;
      failureCode?: TransferTaskFailureCode;
    } = {},
  ) {
    return this.lifecycle.transitionFailure(id, status, options);
  }

  failCompletionClaim(
    id: string,
    completionToken: string,
    failureCode: TransferTaskFailureCode = 'UPLOAD_FAILED',
    auditMetadata: Record<string, unknown> = {},
  ) {
    return this.completion.fail(
      id,
      completionToken,
      failureCode,
      auditMetadata,
    );
  }

  cancelSession(
    id: string,
    expectedStatus: UploadSessionStatus,
    auditMetadata: Record<string, unknown> = {},
  ) {
    return this.lifecycle.cancel(id, expectedStatus, auditMetadata);
  }
}
