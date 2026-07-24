import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { TransferTask } from '../../generated/prisma/client';
import {
  canTransitionTransferTask,
  getTransferTaskTransitionSources,
  isTerminalTransferTaskStatus,
  type TransferTaskFailureCode,
} from '../../common/transfers/transfer-task-state';
import { recordUploadTransferAudit } from './upload-session-audit';
import {
  isUploadSessionConflict,
  mapUploadSession,
  type UploadSessionStatus,
  uploadCompletionClaimLeaseMs,
  UploadSessionStateConflictError,
  UploadTransferStateConflictError,
} from './upload-session-types';

export class UploadSessionLifecycleStore {
  constructor(private readonly prisma: PrismaService) {}

  async setLegacyExpiry(id: string, expiresAt: Date) {
    const current = await this.prisma.uploadSession.findUnique({
      where: { id },
    });
    if (!current) return null;
    if (
      current.expiresAt &&
      current.expiresAt.getTime() !== expiresAt.getTime()
    ) {
      return null;
    }
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const transferRows = await tx.transferTask.updateManyAndReturn({
          where: {
            id: current.transferId,
            transferType: 'upload',
            status: current.status,
            expiresAt: null,
          },
          data: { expiresAt, updatedAt: now },
        });
        const transfer =
          transferRows.length === 1
            ? transferRows[0]
            : await tx.transferTask.findFirst({
                where: {
                  id: current.transferId,
                  transferType: 'upload',
                  status: current.status,
                  expiresAt,
                },
              });
        if (!transfer || transferRows.length > 1) {
          throw new UploadTransferStateConflictError();
        }

        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            transferId: current.transferId,
            status: transfer.status,
            completionToken: null,
            expiresAt: null,
          },
          data: { expiresAt, updatedAt: now },
        });
        const row =
          rows.length === 1
            ? rows[0]
            : await tx.uploadSession.findFirst({
                where: {
                  id,
                  transferId: current.transferId,
                  status: transfer.status,
                  expiresAt,
                },
              });
        if (!row || rows.length > 1) {
          throw new UploadSessionStateConflictError();
        }
        return mapUploadSession(row);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: UploadSessionStatus,
    options: {
      expiresAt?: Date;
      expectedStatus?: UploadSessionStatus;
      failureCode?: TransferTaskFailureCode | null;
      nodeId?: string | null;
    } = {},
  ) {
    if (
      options.expectedStatus &&
      !canTransitionTransferTask(options.expectedStatus, status)
    ) {
      return null;
    }
    if (isTerminalTransferTaskStatus(status)) {
      const current = await this.prisma.uploadSession.findUnique({
        where: { id },
      });
      if (!current) return null;
      if (current.status === status) return mapUploadSession(current);
    }
    const now = new Date();
    const staleBefore = new Date(now.getTime() - uploadCompletionClaimLeaseMs);
    const canRecoverStaleClaim =
      status === 'canceled' || status === 'expired' || status === 'failed';
    const failureCode =
      status === 'failed'
        ? (options.failureCode ?? 'UPLOAD_FAILED')
        : status === 'expired'
          ? (options.failureCode ?? 'UPLOAD_SESSION_EXPIRED')
          : null;
    const rows = await this.prisma.uploadSession.updateManyAndReturn({
      where: {
        id,
        ...(canRecoverStaleClaim
          ? {
              OR: [
                { completionToken: null },
                { completionStartedAt: null },
                { completionStartedAt: { lte: staleBefore } },
              ],
            }
          : { completionToken: null }),
        status: options.expectedStatus
          ? options.expectedStatus
          : {
              in:
                status === 'running'
                  ? ['pending', 'running']
                  : getTransferTaskTransitionSources(status).filter(
                      (source) =>
                        source !== status ||
                        !isTerminalTransferTaskStatus(status),
                    ),
            },
        ...(status === 'expired'
          ? {}
          : {
              AND: [
                {
                  OR: [
                    ...(status === 'completed' || status === 'canceled'
                      ? [{ status }]
                      : []),
                    { expiresAt: null },
                    { expiresAt: { gt: now } },
                  ],
                },
              ],
            }),
      },
      data: {
        status,
        failureCode,
        ...(options.expiresAt !== undefined
          ? { expiresAt: options.expiresAt }
          : {}),
        ...(options.nodeId !== undefined ? { nodeId: options.nodeId } : {}),
        ...(canRecoverStaleClaim
          ? { completionToken: null, completionStartedAt: null }
          : {}),
        updatedAt: now,
      },
    });
    if (rows.length !== 1 || rows[0].status !== status) return null;
    return mapUploadSession(rows[0]);
  }

  async resume(
    id: string,
    expectedStatus: UploadSessionStatus,
    progress: number,
  ) {
    if (
      !(['running', 'paused', 'failed'] as UploadSessionStatus[]).includes(
        expectedStatus,
      ) ||
      !canTransitionTransferTask(expectedStatus, 'running')
    ) {
      return null;
    }
    const now = new Date();
    const finiteProgress = Number.isFinite(progress) ? progress : 0;
    const normalizedProgress = new Prisma.Decimal(
      Math.min(100, Math.max(0, Math.round(finiteProgress * 10) / 10)).toFixed(
        1,
      ),
    );
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { transferId: true, expiresAt: true },
    });
    if (!session?.expiresAt || session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let transferRows = await tx.transferTask.updateManyAndReturn({
          where: {
            id: session.transferId,
            transferType: 'upload',
            status: { in: getTransferTaskTransitionSources('running') },
            progress: { lte: normalizedProgress },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: {
            status: 'running',
            progress: normalizedProgress,
            failureCode: null,
            expiresAt: session.expiresAt,
            updatedAt: now,
          },
        });
        if (transferRows.length === 0) {
          transferRows = await tx.transferTask.updateManyAndReturn({
            where: {
              id: session.transferId,
              transferType: 'upload',
              status: { in: getTransferTaskTransitionSources('running') },
              progress: { gt: normalizedProgress },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            data: {
              status: 'running',
              failureCode: null,
              expiresAt: session.expiresAt,
              updatedAt: now,
            },
          });
        }
        if (transferRows.length !== 1) {
          throw new UploadTransferStateConflictError();
        }

        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            status: expectedStatus,
            completionToken: null,
            storageFinalizedAt: null,
            expiresAt: session.expiresAt,
          },
          data: {
            status: 'running',
            failureCode: null,
            updatedAt: now,
          },
        });
        if (rows.length !== 1 || rows[0].status !== 'running') {
          throw new UploadSessionStateConflictError();
        }
        return mapUploadSession(rows[0]);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async transitionFailure(
    id: string,
    status: Extract<UploadSessionStatus, 'failed' | 'expired'>,
    options: {
      auditMetadata?: Record<string, unknown>;
      failureCode?: TransferTaskFailureCode;
    } = {},
  ) {
    const now = new Date();
    const current = await this.prisma.uploadSession.findUnique({
      where: { id },
    });
    if (!current) return null;
    const failureCode: TransferTaskFailureCode =
      status === 'expired'
        ? 'UPLOAD_SESSION_EXPIRED'
        : (options.failureCode ?? 'UPLOAD_FAILED');
    const sessionAlreadyChanged =
      current.status === status && current.failureCode === failureCode;
    if (
      !sessionAlreadyChanged &&
      !canTransitionTransferTask(current.status as UploadSessionStatus, status)
    ) {
      return null;
    }
    const elapsed = Boolean(
      current.expiresAt && current.expiresAt.getTime() <= now.getTime(),
    );
    if ((status === 'expired') !== elapsed) return null;
    const staleBefore = new Date(now.getTime() - uploadCompletionClaimLeaseMs);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const transferRows = await tx.transferTask.updateManyAndReturn({
          where: {
            id: current.transferId,
            transferType: 'upload',
            status: {
              in: getTransferTaskTransitionSources(status).filter(
                (source) => source !== status,
              ),
            },
            ...(status === 'failed'
              ? { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
              : {}),
          },
          data: { status, failureCode, updatedAt: now },
        });
        let changedTransfer: TransferTask | null = transferRows[0] ?? null;
        if (transferRows.length !== 1) {
          const unchanged = await tx.transferTask.findFirst({
            where: {
              id: current.transferId,
              transferType: 'upload',
              status,
              failureCode,
            },
            select: { id: true },
          });
          if (!unchanged) throw new UploadTransferStateConflictError();
          changedTransfer = null;
        }
        const row = sessionAlreadyChanged
          ? await tx.uploadSession.findFirst({
              where: { id, status, failureCode },
            })
          : (
              await tx.uploadSession.updateManyAndReturn({
                where: {
                  id,
                  status: current.status,
                  ...(status === 'expired'
                    ? { expiresAt: { lte: now } }
                    : {
                        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                      }),
                  AND: [
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
                  status,
                  failureCode,
                  completionToken: null,
                  completionStartedAt: null,
                  updatedAt: now,
                },
              })
            )[0];
        if (!row || row.status !== status) {
          throw new UploadSessionStateConflictError();
        }
        if (changedTransfer) {
          await recordUploadTransferAudit(
            tx,
            status === 'expired' ? 'transfer.expired' : 'transfer.failed',
            changedTransfer,
            options.auditMetadata,
          );
        }
        return mapUploadSession(row);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async cancel(
    id: string,
    expectedStatus: UploadSessionStatus,
    auditMetadata: Record<string, unknown> = {},
  ) {
    if (!canTransitionTransferTask(expectedStatus, 'canceled')) return null;
    const current = await this.prisma.uploadSession.findUnique({
      where: { id },
    });
    if (!current) return null;
    const sessionAlreadyCanceled = current.status === 'canceled';
    if (!sessionAlreadyCanceled && current.status !== expectedStatus) {
      return null;
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - uploadCompletionClaimLeaseMs);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const transferRows = await tx.transferTask.updateManyAndReturn({
          where: {
            id: current.transferId,
            transferType: 'upload',
            status: {
              in: getTransferTaskTransitionSources('canceled').filter(
                (source) => source !== 'canceled',
              ),
            },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: {
            status: 'canceled',
            failureCode: null,
            updatedAt: now,
          },
        });
        let changedTransfer: TransferTask | null = transferRows[0] ?? null;
        if (transferRows.length !== 1) {
          const canceled = await tx.transferTask.findFirst({
            where: {
              id: current.transferId,
              transferType: 'upload',
              status: 'canceled',
            },
            select: { id: true },
          });
          if (!canceled) throw new UploadTransferStateConflictError();
          changedTransfer = null;
        }
        const row = sessionAlreadyCanceled
          ? await tx.uploadSession.findFirst({
              where: { id, status: 'canceled', failureCode: null },
            })
          : (
              await tx.uploadSession.updateManyAndReturn({
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
                  status: 'canceled',
                  failureCode: null,
                  completionToken: null,
                  completionStartedAt: null,
                  updatedAt: now,
                },
              })
            )[0];
        if (!row || row.status !== 'canceled') {
          throw new UploadSessionStateConflictError();
        }
        if (changedTransfer) {
          await recordUploadTransferAudit(
            tx,
            'transfer.canceled',
            changedTransfer,
            auditMetadata,
          );
        }
        return mapUploadSession(row);
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }
}
