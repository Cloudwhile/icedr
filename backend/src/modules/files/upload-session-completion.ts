import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import type { TransferTask } from '../../generated/prisma/client';
import {
  canTransitionTransferTask,
  getTransferTaskTransitionSources,
  type TransferTaskFailureCode,
} from '../../common/transfers/transfer-task-state';
import { recordUploadTransferAudit } from './upload-session-audit';
import {
  isUploadSessionConflict,
  mapUploadSession,
  type UploadCompletionClaim,
  type UploadSessionStatus,
  uploadCompletionClaimLeaseMs,
  UploadSessionStateConflictError,
  UploadTransferStateConflictError,
} from './upload-session-types';

export class UploadSessionCompletionStore {
  constructor(private readonly prisma: PrismaService) {}

  async claim(
    id: string,
    expectedStatus: Extract<UploadSessionStatus, 'running' | 'failed'>,
  ): Promise<UploadCompletionClaim | null> {
    if (!canTransitionTransferTask(expectedStatus, 'running')) return null;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - uploadCompletionClaimLeaseMs);
    const leaseExpiresAt = new Date(
      now.getTime() + uploadCompletionClaimLeaseMs,
    );
    const completionToken = randomBytes(24).toString('base64url');
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { transferId: true, expiresAt: true },
    });
    if (!session) return null;
    const extendedExpiresAt =
      session.expiresAt &&
      session.expiresAt.getTime() < leaseExpiresAt.getTime()
        ? leaseExpiresAt
        : session.expiresAt;
    const extendsExpiry = extendedExpiresAt !== session.expiresAt;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const transfer = await tx.transferTask.updateMany({
          where: {
            id: session.transferId,
            transferType: 'upload',
            status: { in: ['pending', 'running', 'failed'] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: {
            status: 'running',
            failureCode: null,
            ...(extendsExpiry ? { expiresAt: extendedExpiresAt } : {}),
            updatedAt: now,
          },
        });
        if (transfer.count !== 1) {
          throw new UploadTransferStateConflictError();
        }
        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            status: expectedStatus,
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              {
                OR: [
                  { completionToken: null },
                  { completionStartedAt: null },
                  { completionStartedAt: { lte: staleBefore } },
                ],
              },
            ],
          },
          data: {
            status: 'running',
            failureCode: null,
            completionToken,
            completionStartedAt: now,
            ...(extendsExpiry ? { expiresAt: extendedExpiresAt } : {}),
            updatedAt: now,
          },
        });
        const row = rows[0];
        if (
          rows.length !== 1 ||
          row.status !== 'running' ||
          row.completionToken !== completionToken
        ) {
          throw new UploadSessionStateConflictError();
        }
        return { ...mapUploadSession(row), completionToken };
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async refresh(id: string, completionToken: string) {
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + uploadCompletionClaimLeaseMs,
    );
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { expiresAt: true, transferId: true },
    });
    if (!session) return null;
    const transfer = await this.prisma.transferTask.findUnique({
      where: { id: session.transferId },
      select: { expiresAt: true },
    });
    if (!transfer) return null;
    const sessionExpiresAt =
      session.expiresAt === null
        ? null
        : session.expiresAt > leaseExpiresAt
          ? session.expiresAt
          : leaseExpiresAt;
    const transferExpiresAt =
      transfer.expiresAt === null
        ? null
        : transfer.expiresAt > leaseExpiresAt
          ? transfer.expiresAt
          : leaseExpiresAt;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const refreshedTransfer = await tx.transferTask.updateMany({
          where: {
            id: session.transferId,
            status: 'running',
            transferType: 'upload',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: {
            expiresAt: transferExpiresAt,
            updatedAt: now,
          },
        });
        if (refreshedTransfer.count !== 1) {
          throw new UploadTransferStateConflictError();
        }
        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            completionToken,
            status: 'running',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: {
            completionStartedAt: now,
            expiresAt: sessionExpiresAt,
            updatedAt: now,
          },
        });
        const row = rows[0];
        if (
          rows.length !== 1 ||
          row.completionToken !== completionToken ||
          row.status !== 'running'
        ) {
          throw new UploadSessionStateConflictError();
        }
        return mapUploadSession(row);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async markStorageFinalized(id: string, completionToken: string) {
    const now = new Date();
    const rows = await this.prisma.uploadSession.updateManyAndReturn({
      where: {
        id,
        status: 'running',
        completionToken,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        storageFinalizedAt: now,
        completionStartedAt: now,
        updatedAt: now,
      },
    });
    if (rows.length !== 1 || !rows[0].storageFinalizedAt) return null;
    return mapUploadSession(rows[0]);
  }

  async persistNode(id: string, completionToken: string, nodeId: string) {
    const now = new Date();
    const rows = await this.prisma.uploadSession.updateManyAndReturn({
      where: {
        id,
        status: 'running',
        completionToken,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        nodeId,
        completionStartedAt: now,
        updatedAt: now,
      },
    });
    if (rows.length !== 1 || rows[0].nodeId !== nodeId) return null;
    return mapUploadSession(rows[0]);
  }

  async complete(
    id: string,
    completionToken: string,
    nodeId: string,
    auditMetadata: Record<string, unknown> = {},
  ) {
    const now = new Date();
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { transferId: true },
    });
    if (!session) return null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const transferRows = await tx.transferTask.updateManyAndReturn({
          where: {
            id: session.transferId,
            transferType: 'upload',
            status: {
              in: getTransferTaskTransitionSources('completed').filter(
                (source) => source !== 'completed',
              ),
            },
          },
          data: {
            status: 'completed',
            failureCode: null,
            progress: 100,
            nodeId,
            updatedAt: now,
          },
        });
        let completedTransfer: TransferTask | null = transferRows[0] ?? null;
        if (transferRows.length !== 1) {
          const completed = await tx.transferTask.findFirst({
            where: {
              id: session.transferId,
              transferType: 'upload',
              status: 'completed',
              nodeId,
            },
            select: { id: true },
          });
          if (!completed) throw new UploadTransferStateConflictError();
          completedTransfer = null;
        }
        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            status: 'running',
            completionToken,
            nodeId,
          },
          data: {
            status: 'completed',
            failureCode: null,
            completionToken: null,
            completionStartedAt: null,
            updatedAt: now,
          },
        });
        if (rows.length !== 1 || rows[0].status !== 'completed') {
          throw new UploadSessionStateConflictError();
        }
        if (completedTransfer) {
          await recordUploadTransferAudit(
            tx,
            'transfer.completed',
            completedTransfer,
            auditMetadata,
          );
        }
        return mapUploadSession(rows[0]);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async fail(
    id: string,
    completionToken: string,
    failureCode: TransferTaskFailureCode = 'UPLOAD_FAILED',
    auditMetadata: Record<string, unknown> = {},
  ) {
    const now = new Date();
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { transferId: true, expiresAt: true },
    });
    if (!session) return null;
    const expired = Boolean(
      session.expiresAt && session.expiresAt.getTime() <= now.getTime(),
    );
    const status: Extract<UploadSessionStatus, 'failed' | 'expired'> = expired
      ? 'expired'
      : 'failed';
    const resolvedFailureCode: TransferTaskFailureCode = expired
      ? 'UPLOAD_SESSION_EXPIRED'
      : failureCode;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const transferRows = await tx.transferTask.updateManyAndReturn({
          where: {
            id: session.transferId,
            transferType: 'upload',
            status: {
              in: getTransferTaskTransitionSources(status).filter(
                (source) => source !== status,
              ),
            },
            ...(expired
              ? {}
              : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
          },
          data: {
            status,
            failureCode: resolvedFailureCode,
            updatedAt: now,
          },
        });
        let changedTransfer: TransferTask | null = transferRows[0] ?? null;
        if (transferRows.length !== 1) {
          const unchanged = await tx.transferTask.findFirst({
            where: {
              id: session.transferId,
              transferType: 'upload',
              status,
              failureCode: resolvedFailureCode,
            },
            select: { id: true },
          });
          if (!unchanged) throw new UploadTransferStateConflictError();
          changedTransfer = null;
        }
        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            status: 'running',
            completionToken,
            ...(expired
              ? { expiresAt: { lte: now } }
              : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
          },
          data: {
            status,
            failureCode: resolvedFailureCode,
            completionToken: null,
            completionStartedAt: null,
            updatedAt: now,
          },
        });
        if (rows.length !== 1 || rows[0].status !== status) {
          throw new UploadSessionStateConflictError();
        }
        if (changedTransfer) {
          await recordUploadTransferAudit(
            tx,
            status === 'expired' ? 'transfer.expired' : 'transfer.failed',
            changedTransfer,
            auditMetadata,
          );
        }
        return mapUploadSession(rows[0]);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }
}
