import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Readable } from 'stream';
import type { TransferTaskFailureCode } from '../../common/transfers/transfer-task-state';
import { uploadSessionLifetimeMs } from '../../common/transfers/upload-session-policy';
import type { TransferStatus } from '../downloads/transfers/transfers.dto';
import { TransfersService } from '../downloads/transfers/transfers.service';
import { StorageService } from '../storage/storage.service';
import {
  type CompleteUploadPartDto,
  type CompleteUploadDto,
  type CreateUploadIntentDto,
  type UploadChunkResponse,
  type UploadIntentResponse,
  type UploadPartIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import { FileUploadPolicyService } from './file-upload-policy.service';
import {
  assertUploadSessionComplete,
  assertWritableUploadSession,
  canReuseUploadSession,
  getExpectedPartRange,
  getUploadedSessionState,
  toUploadIntent,
} from './file-upload-session.helper';
import {
  type UploadCompletionClaim,
  type UploadSession,
  type UploadSessionPart,
  UploadSessionsRepository,
} from './upload-sessions.repository';

type AuditMetadata = Record<string, unknown>;

@Injectable()
export class FileUploadService {
  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
    private readonly transfersService: TransfersService,
    private readonly uploadSessionsRepository: UploadSessionsRepository,
    private readonly uploadPolicy: FileUploadPolicyService,
  ) {}

  async createUploadIntent(
    dto: CreateUploadIntentDto,
    options: {
      actorRole?: string;
      auditMetadata?: AuditMetadata;
      ownerUserId?: string;
    } = {},
  ): Promise<UploadIntentResponse> {
    const fileName = this.uploadPolicy.normalizeNodeName(dto.fileName);
    const conflictStrategy = this.uploadPolicy.normalizeUploadConflictStrategy(
      dto.conflictStrategy,
    );
    const distributedStorage =
      await this.storageService.distributedStorageEnabled();
    const sizeBytes = Math.max(0, Math.trunc(dto.fileSizeBytes ?? 0));
    const spaceScope = this.uploadPolicy.normalizeSpaceScope(dto.spaceScope);
    await this.uploadPolicy.assertValidParent(
      dto.workspaceId,
      dto.parentNodeId ?? null,
      spaceScope,
      { actorRole: options.actorRole, actorUserId: options.ownerUserId },
    );
    const resolvedConflict = await this.uploadPolicy.resolveUploadConflict({
      allowRename: true,
      conflictStrategy,
      explicitConflictStrategy: Boolean(dto.conflictStrategy),
      fileName,
      ownerUserId: options.ownerUserId,
      parentNodeId: dto.parentNodeId ?? null,
      spaceScope,
      workspaceId: dto.workspaceId,
    });
    const quotaIncomingBytes =
      resolvedConflict.strategy === 'overwrite' &&
      resolvedConflict.target?.sizeBytes
        ? Math.max(0, sizeBytes - resolvedConflict.target.sizeBytes)
        : sizeBytes;
    await this.uploadPolicy.assertWithinWorkspaceQuota(
      dto.workspaceId,
      quotaIncomingBytes,
      spaceScope,
      options.ownerUserId,
      options.auditMetadata,
    );
    const chunkSizeBytes = this.uploadPolicy.normalizeChunkSize(
      dto.chunkSizeBytes,
      { distributedStorage },
    );
    const resumeKey = dto.resumeKey?.trim() || undefined;
    if (resumeKey && dto.fileSizeBytes !== undefined) {
      let reusable = await this.uploadSessionsRepository.findReusable({
        workspaceId: dto.workspaceId,
        ownerUserId: options.ownerUserId ?? null,
        spaceScope,
        conflictStrategy: resolvedConflict.strategy,
        resumeKey,
        fileName: resolvedConflict.fileName,
        parentNodeId: dto.parentNodeId ?? null,
        sizeBytes,
      });
      if (reusable) {
        reusable = await this.ensureUploadSessionExpiry(reusable);
        if (reusable.status === 'expired') {
          // Keep the fixed historical deadline; a new intent is created below.
        } else if (!canReuseUploadSession(reusable, distributedStorage)) {
          await this.cancelUploadSession(reusable.id, {
            auditMetadata: options.auditMetadata,
          });
        } else {
          const parts = await this.uploadSessionsRepository.listParts(
            reusable.id,
          );
          const uploaded = getUploadedSessionState(reusable, parts);
          const resumed = await this.uploadSessionsRepository.resumeSession(
            reusable.id,
            reusable.status,
            uploaded.progress,
          );
          if (!resumed) {
            const current = await this.uploadSessionsRepository.findById(
              reusable.id,
            );
            if (!current) {
              throw new NotFoundException('Upload session not found');
            }
            throw new ConflictException({
              code: 'UPLOAD_SESSION_STATE_CONFLICT',
              message:
                'Upload session status changed before the update was applied',
              currentStatus: current.status,
            });
          }
          return toUploadIntent(resumed, parts, resolvedConflict.strategy);
        }
      }
    }

    const objectKey = this.uploadPolicy.createUploadObjectKey(
      { ...dto, fileName: resolvedConflict.fileName, spaceScope },
      distributedStorage,
    );
    const expiresAt = new Date(Date.now() + uploadSessionLifetimeMs);
    const transfer = await this.transfersService.createUploadTransfer({
      auditMetadata: options.auditMetadata,
      workspaceId: dto.workspaceId,
      ownerUserId: options.ownerUserId,
      objectKey,
      name: resolvedConflict.fileName,
      expiresAt,
    });
    let multipartUpload: { uploadId: string } | null = null;
    let session: UploadSession | null = null;
    try {
      multipartUpload = distributedStorage
        ? await this.storageService.createMultipartUpload(
            objectKey,
            dto.mimeType ?? 'application/octet-stream',
          )
        : null;
      session = await this.uploadSessionsRepository.create({
        workspaceId: dto.workspaceId,
        ownerUserId: options.ownerUserId ?? null,
        spaceScope,
        conflictStrategy: resolvedConflict.strategy,
        transferId: transfer.id,
        objectKey,
        multipartUploadId: multipartUpload?.uploadId ?? null,
        resumeKey: resumeKey ?? null,
        fileName: resolvedConflict.fileName,
        parentNodeId: dto.parentNodeId ?? null,
        mimeType: dto.mimeType ?? 'application/octet-stream',
        sizeBytes,
        chunkSizeBytes,
        expiresAt,
      });
      await this.fileNodesRepository.recordAudit(
        'file.upload_intent_created',
        objectKey,
        {
          metadata: {
            ...options.auditMetadata,
            conflictStrategy: resolvedConflict.strategy,
            requestedFileName: fileName,
            resolvedFileName: resolvedConflict.fileName,
            targetNodeId: resolvedConflict.target?.id ?? null,
          },
        },
      );
      return toUploadIntent(session, [], resolvedConflict.strategy);
    } catch (error) {
      if (!session && multipartUpload?.uploadId) {
        await this.storageService
          .abortMultipartUpload({
            objectKey,
            uploadId: multipartUpload.uploadId,
          })
          .catch(() => undefined);
      }
      await this.markUploadFailure({
        sessionId: session?.id,
        transferId: transfer.id,
        ownerUserId: options.ownerUserId ?? null,
      });
      throw error;
    }
  }

  async createUploadPartIntent(
    sessionId: string,
    partIndex: number,
    ownerUserId?: string,
  ): Promise<UploadPartIntentResponse> {
    const session = await this.requireUploadSession(sessionId, ownerUserId);
    assertWritableUploadSession(session);
    if (!session.multipartUploadId) {
      throw new BadRequestException(
        'Upload session does not use object storage multipart upload',
      );
    }
    const normalizedPartIndex = Math.trunc(partIndex);
    getExpectedPartRange(session, normalizedPartIndex);
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
    ownerUserId?: string,
  ): Promise<UploadChunkResponse> {
    const session = await this.requireUploadSession(sessionId, ownerUserId);
    assertWritableUploadSession(session);
    if (!session.multipartUploadId) {
      throw new BadRequestException(
        'Upload session does not use object storage multipart upload',
      );
    }
    const normalizedPartIndex = Math.trunc(partIndex);
    const expected = getExpectedPartRange(session, normalizedPartIndex);
    const writeClaim =
      (await this.uploadSessionsRepository.claimPartWrite(session.id)) ??
      (await this.throwUploadPartWriteClaimConflict(session.id));
    let runningSession: UploadSession;
    try {
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
        throw new BadRequestException(
          'Upload chunk size does not match session',
        );
      }
      runningSession =
        (await this.uploadSessionsRepository.commitPartWrite(
          writeClaim.writeToken,
          {
            sessionId: session.id,
            partIndex: normalizedPartIndex,
            startByte: expected.startByte,
            endByte: expected.endByte,
            sizeBytes,
            eTag,
          },
        )) ?? (await this.throwUploadPartWriteClaimConflict(session.id));
    } catch (error) {
      await this.uploadSessionsRepository
        .releasePartWrite(session.id, writeClaim.writeToken)
        .catch(() => false);
      throw error;
    }
    const parts = await this.uploadSessionsRepository.listParts(session.id);
    const uploaded = getUploadedSessionState(runningSession, parts);
    await this.syncUploadTransferProgress(
      runningSession.transferId,
      uploaded.progress,
      runningSession.ownerUserId,
    );
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
    ownerUserId?: string,
  ): Promise<UploadChunkResponse> {
    const session = await this.requireUploadSession(sessionId, ownerUserId);
    assertWritableUploadSession(session);
    if (session.multipartUploadId) {
      throw new BadRequestException(
        'Upload session uses object storage multipart upload',
      );
    }
    const normalizedPartIndex = Math.trunc(partIndex);
    const expected = getExpectedPartRange(session, normalizedPartIndex);
    const writeClaim =
      (await this.uploadSessionsRepository.claimPartWrite(session.id)) ??
      (await this.throwUploadPartWriteClaimConflict(session.id));
    let runningSession: UploadSession;
    try {
      const written = await this.storageService.writeUploadSessionPart(
        session.id,
        normalizedPartIndex,
        stream,
      );
      if (written.sizeBytes !== expected.sizeBytes) {
        throw new BadRequestException(
          'Upload chunk size does not match session',
        );
      }
      runningSession =
        (await this.uploadSessionsRepository.commitPartWrite(
          writeClaim.writeToken,
          {
            sessionId: session.id,
            partIndex: normalizedPartIndex,
            startByte: expected.startByte,
            endByte: expected.endByte,
            sizeBytes: written.sizeBytes,
          },
        )) ?? (await this.throwUploadPartWriteClaimConflict(session.id));
    } catch (error) {
      await this.uploadSessionsRepository
        .releasePartWrite(session.id, writeClaim.writeToken)
        .catch(() => false);
      throw error;
    }
    const parts = await this.uploadSessionsRepository.listParts(session.id);
    const uploaded = getUploadedSessionState(runningSession, parts);
    await this.syncUploadTransferProgress(
      runningSession.transferId,
      uploaded.progress,
      runningSession.ownerUserId,
    );
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
    options: { auditMetadata?: AuditMetadata; ownerUserId?: string } = {},
  ) {
    const session = await this.requireUploadSession(
      sessionId,
      options.ownerUserId,
    );
    if (session.status === 'completed' || session.status === 'expired') {
      throw new BadRequestException('Upload session cannot be canceled');
    }
    await this.transitionUploadSession(session, 'canceled', {
      auditMetadata: options.auditMetadata,
    });
    if (session.multipartUploadId) {
      await this.storageService.abortMultipartUpload({
        objectKey: session.objectKey,
        uploadId: session.multipartUploadId,
      });
    } else {
      await this.storageService.deleteUploadSessionParts(session.id);
    }
    return { ok: true };
  }

  async completeUpload(
    dto: CompleteUploadDto,
    options: {
      actorRole?: string;
      auditMetadata?: AuditMetadata;
      ownerUserId?: string;
    } = {},
  ) {
    const fileName = this.uploadPolicy.normalizeNodeName(dto.fileName);
    const conflictStrategy = this.uploadPolicy.normalizeUploadConflictStrategy(
      dto.conflictStrategy,
    );
    const spaceScope = this.uploadPolicy.normalizeSpaceScope(dto.spaceScope);
    await this.uploadPolicy.assertValidParent(
      dto.workspaceId,
      dto.parentNodeId ?? null,
      spaceScope,
      { actorRole: options.actorRole, actorUserId: options.ownerUserId },
    );
    const resolvedConflict = await this.uploadPolicy.resolveUploadConflict({
      allowRename: false,
      conflictStrategy,
      explicitConflictStrategy: Boolean(dto.conflictStrategy),
      fileName,
      ownerUserId: options.ownerUserId,
      parentNodeId: dto.parentNodeId ?? null,
      spaceScope,
      workspaceId: dto.workspaceId,
    });
    const normalizedDto = { ...dto, fileName: resolvedConflict.fileName };
    this.uploadPolicy.assertUploadObjectKey(normalizedDto);
    if (!dto.uploadSessionId?.trim()) {
      throw new BadRequestException('Upload session is required');
    }
    const uploadSession = await this.requireCompletableUploadSession(
      normalizedDto,
      options.ownerUserId,
    );
    if (uploadSession.status === 'completed' && uploadSession.nodeId) {
      const completedNode = await this.requirePersistedUploadNode(
        uploadSession,
        normalizedDto,
      );
      await this.completeUploadTransfer({
        auditMetadata: options.auditMetadata,
        transferId: uploadSession.transferId,
        nodeId: completedNode.id,
        ownerUserId: uploadSession.ownerUserId,
      });
      return completedNode;
    }
    const candidateParts = await this.uploadSessionsRepository.listParts(
      uploadSession.id,
    );
    assertUploadSessionComplete(uploadSession, candidateParts);
    const completionClaim =
      (await this.uploadSessionsRepository.claimCompletion(
        uploadSession.id,
        uploadSession.status as 'running' | 'failed',
      )) ?? (await this.throwUploadCompletionClaimConflict(uploadSession.id));
    let node;
    let claimedSession = completionClaim;
    try {
      const parts = await this.uploadSessionsRepository.listParts(
        uploadSession.id,
      );
      assertUploadSessionComplete(claimedSession, parts);
      if (claimedSession.storageFinalizedAt) {
        await this.assertFinalizedUploadObject(
          claimedSession,
          normalizedDto.objectKey,
        );
      } else {
        const objectAlreadyFinalized = claimedSession.multipartUploadId
          ? await this.storageService.objectExists(normalizedDto.objectKey)
          : await this.storageService.objectExists(
              normalizedDto.objectKey,
              claimedSession.sizeBytes,
            );
        if (!objectAlreadyFinalized) {
          await this.finalizeUploadObject(claimedSession, parts, normalizedDto);
        }
        claimedSession = await this.requireUpdatedCompletionClaim(
          uploadSession.id,
          claimedSession.completionToken,
          this.uploadSessionsRepository.markStorageFinalized(
            uploadSession.id,
            claimedSession.completionToken,
          ),
        );
      }
      if (claimedSession.nodeId) {
        node = await this.requirePersistedUploadNode(
          claimedSession,
          normalizedDto,
        );
      } else {
        node = await this.fileNodesRepository.completeUpload(
          {
            ...normalizedDto,
            conflictStrategy: resolvedConflict.strategy,
            conflictTargetNodeId: resolvedConflict.target?.id,
            owner: dto.owner?.trim() || undefined,
            ownerUserId: options.ownerUserId,
            spaceScope,
          },
          {
            sessionId: uploadSession.id,
            completionToken: claimedSession.completionToken,
          },
        );
        claimedSession = { ...claimedSession, nodeId: node.id };
      }
      const completedSession =
        (await this.uploadSessionsRepository.completeCompletionClaim(
          uploadSession.id,
          claimedSession.completionToken,
          node.id,
          options.auditMetadata,
        )) ?? (await this.throwUploadCompletionClaimConflict(uploadSession.id));
      if (!completedSession.multipartUploadId) {
        await this.storageService
          .deleteUploadSessionParts(uploadSession.id)
          .catch(() => undefined);
      }
      claimedSession = {
        ...completedSession,
        completionToken: claimedSession.completionToken,
      };
    } catch (error) {
      await this.markUploadCompletionFailure({
        sessionId: uploadSession.id,
        completionToken: completionClaim.completionToken,
        auditMetadata: options.auditMetadata,
      });
      throw error;
    }

    await this.completeUploadTransfer({
      auditMetadata: options.auditMetadata,
      transferId: claimedSession.transferId,
      nodeId: node.id,
      ownerUserId: claimedSession.ownerUserId,
    });
    await this.deleteStoredObjects(
      await this.fileNodesRepository.pruneVersions(node.id),
    );
    if (
      resolvedConflict.strategy === 'overwrite' &&
      resolvedConflict.target?.objectKey
    ) {
      await this.deleteStoredObjects([resolvedConflict.target.objectKey]);
    }
    await this.fileNodesRepository.recordAudit(
      'file.upload_completed',
      node.id,
      {
        metadata: {
          ...options.auditMetadata,
          conflictStrategy: resolvedConflict.strategy,
          requestedFileName: fileName,
          resolvedFileName: resolvedConflict.fileName,
          targetNodeId: resolvedConflict.target?.id ?? null,
        },
      },
    );
    if (resolvedConflict.target && resolvedConflict.strategy === 'version') {
      await this.fileNodesRepository.recordAudit(
        'file.version_created',
        node.id,
        { metadata: options.auditMetadata },
      );
    }
    if (resolvedConflict.target && resolvedConflict.strategy === 'overwrite') {
      await this.fileNodesRepository.recordAudit(
        'file.upload_overwritten',
        node.id,
        { metadata: options.auditMetadata },
      );
    }
    return node;
  }

  getStorageUsage(workspaceId: string, quotaBytes: number | null) {
    return this.uploadPolicy.getStorageUsage(workspaceId, quotaBytes);
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
      expectedStatus?: TransferStatus;
      failureCode?: TransferTaskFailureCode | null;
      progress?: number;
      auditMetadata?: AuditMetadata;
    },
    ownerUserId?: string | null,
  ) {
    try {
      await this.transfersService.updateTransferInternal(
        transferId,
        input,
        ownerUserId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }

  private async finalizeUploadObject(
    session: UploadCompletionClaim,
    parts: UploadSessionPart[],
    dto: CompleteUploadDto,
  ) {
    const refreshCompletionLease = async () => {
      await this.requireUpdatedCompletionClaim(
        session.id,
        session.completionToken,
        this.uploadSessionsRepository.refreshCompletionClaim(
          session.id,
          session.completionToken,
        ),
      );
    };
    try {
      await refreshCompletionLease();
      if (session.multipartUploadId) {
        await this.storageService.completeMultipartUpload({
          objectKey: dto.objectKey,
          uploadId: session.multipartUploadId,
          parts: parts.map((part) => ({
            eTag: part.eTag ?? '',
            partIndex: part.partIndex,
          })),
        });
      } else {
        await this.storageService.composeUploadSessionParts({
          sessionId: session.id,
          operationId: session.completionToken,
          partIndexes: parts.map((part) => part.partIndex),
          objectKey: dto.objectKey,
          contentType: dto.mimeType ?? session.mimeType,
          expectedSize: session.sizeBytes,
          refreshOperationLease: refreshCompletionLease,
        });
      }
    } catch (finalizeError) {
      try {
        await this.assertFinalizedUploadObject(session, dto.objectKey);
        return;
      } catch {
        throw finalizeError;
      }
    }
    await this.assertFinalizedUploadObject(session, dto.objectKey);
  }

  private async assertFinalizedUploadObject(
    session: UploadSession,
    objectKey: string,
  ) {
    if (session.multipartUploadId) {
      await this.storageService.assertObjectExists(objectKey);
      return;
    }
    await this.storageService.assertObjectExists(objectKey, session.sizeBytes);
  }

  private async resumeUploadTransfer(
    transferId: string,
    progress: number,
    ownerUserId?: string | null,
  ) {
    try {
      await this.transfersService.resumeTransferInternal(
        transferId,
        progress,
        ownerUserId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }

  private async syncUploadTransferProgress(
    transferId: string,
    progress: number,
    ownerUserId?: string | null,
  ) {
    try {
      await this.transfersService.updateTransferProgressInternal(
        transferId,
        progress,
        ownerUserId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }

  private async markUploadFailure(input: {
    sessionId?: string;
    transferId: string;
    ownerUserId?: string | null;
  }) {
    if (input.sessionId) {
      await this.uploadSessionsRepository
        .transitionFailureState(input.sessionId, 'failed', {
          failureCode: 'UPLOAD_FAILED',
        })
        .catch(() => null);
      return;
    }
    await this.syncUploadTransfer(
      input.transferId,
      { failureCode: 'UPLOAD_FAILED', status: 'failed' },
      input.ownerUserId,
    ).catch(() => undefined);
  }

  private async markUploadCompletionFailure(input: {
    sessionId: string;
    completionToken: string;
    auditMetadata?: AuditMetadata;
  }) {
    try {
      await this.uploadSessionsRepository.failCompletionClaim(
        input.sessionId,
        input.completionToken,
        'UPLOAD_FAILED',
        input.auditMetadata,
      );
    } catch {
      return;
    }
  }

  private async requireUpdatedCompletionClaim(
    sessionId: string,
    completionToken: string,
    update: Promise<UploadSession | null>,
  ): Promise<UploadCompletionClaim> {
    const session =
      (await update) ??
      (await this.throwUploadCompletionClaimConflict(sessionId));
    return { ...session, completionToken };
  }

  private async throwUploadCompletionClaimConflict(
    sessionId: string,
  ): Promise<never> {
    const current = await this.uploadSessionsRepository.findById(sessionId);
    if (!current) throw new NotFoundException('Upload session not found');
    throw new ConflictException({
      code: 'UPLOAD_COMPLETION_CLAIM_CONFLICT',
      message: 'Upload completion is already running or was superseded',
      currentStatus: current.status,
    });
  }

  private async throwUploadPartWriteClaimConflict(
    sessionId: string,
  ): Promise<never> {
    const current = await this.uploadSessionsRepository.findById(sessionId);
    if (!current) throw new NotFoundException('Upload session not found');
    throw new ConflictException({
      code: 'UPLOAD_PART_WRITE_CLAIM_CONFLICT',
      message: 'Upload session is busy with another part or completion',
      currentStatus: current.status,
    });
  }

  private async requirePersistedUploadNode(
    session: UploadSession,
    dto: CompleteUploadDto,
  ) {
    const node = session.nodeId
      ? await this.fileNodesRepository.findById(session.nodeId)
      : null;
    if (
      !node ||
      node.workspaceId !== dto.workspaceId ||
      node.objectKey !== dto.objectKey ||
      node.name !== dto.fileName
    ) {
      throw new ConflictException({
        code: 'UPLOAD_COMPLETION_NODE_CONFLICT',
        message: 'Persisted upload node no longer matches the upload session',
      });
    }
    return node;
  }

  private async transitionUploadSession(
    session: Pick<UploadSession, 'id' | 'status'>,
    status: UploadSession['status'],
    options: NonNullable<
      Parameters<UploadSessionsRepository['updateStatus']>[2]
    > & { auditMetadata?: AuditMetadata } = {},
  ) {
    const { auditMetadata, ...statusOptions } = options;
    const expectedStatus = statusOptions.expectedStatus ?? session.status;
    const updated =
      status === 'canceled'
        ? await this.uploadSessionsRepository.cancelSession(
            session.id,
            expectedStatus,
            auditMetadata,
          )
        : await this.uploadSessionsRepository.updateStatus(session.id, status, {
            ...statusOptions,
            expectedStatus,
          });
    if (updated) return updated;
    const current = await this.uploadSessionsRepository.findById(session.id);
    if (!current) throw new NotFoundException('Upload session not found');
    throw new ConflictException({
      code: 'UPLOAD_SESSION_STATE_CONFLICT',
      message: 'Upload session status changed before the update was applied',
      currentStatus: current.status,
    });
  }

  private async completeUploadTransfer(input: {
    transferId: string;
    nodeId: string;
    ownerUserId?: string | null;
    auditMetadata?: AuditMetadata;
  }) {
    try {
      await this.transfersService.completeTransfer(input);
      return;
    } catch (error) {
      if (error instanceof NotFoundException) return;
      if (!(error instanceof ConflictException)) throw error;
    }
    await this.resumeUploadTransfer(input.transferId, 95, input.ownerUserId);
    try {
      await this.transfersService.completeTransfer(input);
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }

  private async requireUploadSession(sessionId: string, ownerUserId?: string) {
    let session = await this.uploadSessionsRepository.findById(sessionId);
    if (
      !session ||
      (ownerUserId !== undefined && session.ownerUserId !== ownerUserId)
    ) {
      throw new NotFoundException('Upload session not found');
    }
    session = await this.ensureUploadSessionExpiry(session);
    return session;
  }

  private async ensureUploadSessionExpiry(session: UploadSession) {
    if (!session.expiresAt) {
      const fixedExpiry = new Date(
        new Date(session.createdAt).getTime() + uploadSessionLifetimeMs,
      );
      const updated = await this.uploadSessionsRepository.setLegacyExpiry(
        session.id,
        fixedExpiry,
      );
      if (!updated) {
        throw new ConflictException({
          code: 'UPLOAD_SESSION_STATE_CONFLICT',
          message:
            'Upload session status changed before its deadline was persisted',
        });
      }
      session = updated;
    }
    if (session.status === 'expired') {
      const expired =
        await this.uploadSessionsRepository.transitionFailureState(
          session.id,
          'expired',
          { failureCode: 'UPLOAD_SESSION_EXPIRED' },
        );
      if (expired) {
        session = expired;
      } else {
        session =
          (await this.uploadSessionsRepository.findById(session.id)) ?? session;
      }
    }
    return session;
  }

  private async requireCompletableUploadSession(
    dto: CompleteUploadDto,
    ownerUserId?: string,
  ) {
    const session = await this.requireUploadSession(
      dto.uploadSessionId,
      ownerUserId,
    );
    if (
      session.workspaceId !== dto.workspaceId ||
      session.objectKey !== dto.objectKey ||
      session.fileName !== dto.fileName ||
      session.sizeBytes !== dto.sizeBytes ||
      session.mimeType !== (dto.mimeType ?? session.mimeType) ||
      session.spaceScope !==
        this.uploadPolicy.normalizeSpaceScope(dto.spaceScope) ||
      session.conflictStrategy !==
        this.uploadPolicy.normalizeUploadConflictStrategy(
          dto.conflictStrategy,
        ) ||
      (dto.transferId !== undefined && dto.transferId !== session.transferId) ||
      (session.parentNodeId ?? null) !== (dto.parentNodeId ?? null)
    ) {
      throw new BadRequestException(
        'Upload session does not match completion payload',
      );
    }
    if (
      session.status !== 'running' &&
      session.status !== 'failed' &&
      !(session.status === 'completed' && session.nodeId)
    ) {
      throw new BadRequestException('Upload session is not completable');
    }
    return session;
  }
}
