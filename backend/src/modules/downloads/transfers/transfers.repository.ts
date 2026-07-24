import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { createAuditEvent, type AuditActor } from '../../logs/audit-events';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma, type TransferTask } from '../../../generated/prisma/client';
import {
  canTransitionTransferTask,
  createTransferTaskLifecycle,
  getTransferTaskTransitionSources,
  isTerminalTransferTaskStatus,
  normalizeTransferTaskStatus,
  type TransferTaskFailureCode,
} from '../../../common/transfers/transfer-task-state';
import {
  TransferResponse,
  TransferStatus,
  TransferType,
} from './transfers.dto';

export type TransferAuditAction =
  | 'transfer.created'
  | 'transfer.completed'
  | 'transfer.failed'
  | 'transfer.paused'
  | 'transfer.canceled'
  | 'transfer.expired'
  | 'transfer.deleted';

export type TransferAuditMetadata = Record<string, unknown>;

type TransferUpdateInput = {
  status?: TransferStatus;
  expectedStatus?: TransferStatus;
  failureCode?: TransferTaskFailureCode | null;
  progress?: number;
  nodeId?: string;
  auditMetadata?: TransferAuditMetadata;
};

type TransferDataClient = Pick<Prisma.TransactionClient, 'transferTask'>;
type TransferAuditClient = Pick<Prisma.TransactionClient, 'auditEvent'>;
type UploadGuardClient = Pick<
  Prisma.TransactionClient,
  'transferTask' | 'uploadSession'
>;

class ActiveUploadOperationError extends Error {}

export class TransferStateConflictError extends Error {
  readonly code = 'TRANSFER_STATE_CONFLICT';

  constructor(
    message = 'Transfer and upload session statuses changed concurrently',
  ) {
    super(message);
    this.name = 'TransferStateConflictError';
  }
}

@Injectable()
export class TransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    workspaceId: string;
    ownerUserId?: string | null;
    nodeId?: string | null;
    objectKey?: string | null;
    name: string;
    type: TransferType;
    progress?: number;
    status?: TransferStatus;
    expiresAt?: Date | null;
    auditMetadata?: TransferAuditMetadata;
  }) {
    const id = `transfer_${randomBytes(12).toString('base64url')}`;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.transferTask.create({
        data: {
          id,
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId ?? null,
          nodeId: input.nodeId ?? null,
          objectKey: input.objectKey ?? null,
          name: input.name,
          transferType: input.type,
          progress: this.toPrismaProgress(input.progress ?? 0),
          status: input.status ?? 'running',
          failureCode: null,
          expiresAt: input.expiresAt ?? null,
        },
      });
      const transfer = this.mapRow(row);
      await this.recordAudit(
        'transfer.created',
        transfer,
        input.auditMetadata,
        {},
        tx,
      );
      return transfer;
    });
  }

  async update(id: string, input: TransferUpdateInput, ownerUserId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const mutation = { changed: false };
      const transfer = await this.updateWithClient(
        tx,
        id,
        input,
        ownerUserId,
        mutation,
      );
      if (mutation.changed) {
        await this.recordTransferUpdateAudit(transfer, input, tx);
      }
      return transfer;
    });
  }

  async updateUserControlled(
    id: string,
    input: TransferUpdateInput,
    ownerUserId?: string,
  ) {
    try {
      const mutation = { changed: false };
      return await this.prisma.$transaction(async (tx) => {
        const updated = await this.updateWithClient(
          tx,
          id,
          input,
          ownerUserId,
          mutation,
        );
        if (!updated) return null;
        if (mutation.changed) {
          await this.assertNoActiveUploadOperation(tx, id);
          await this.syncUploadSessionStatus(tx, id, input);
          await this.recordTransferUpdateAudit(updated, input, tx);
        }
        return updated;
      });
    } catch (error) {
      if (error instanceof ActiveUploadOperationError) return null;
      throw error;
    }
  }

  private async updateWithClient(
    client: TransferDataClient,
    id: string,
    input: TransferUpdateInput,
    ownerUserId?: string,
    mutation?: { changed: boolean },
  ): Promise<TransferResponse | null> {
    if (
      input.status &&
      input.expectedStatus &&
      !canTransitionTransferTask(input.expectedStatus, input.status)
    ) {
      return null;
    }
    if (input.status && isTerminalTransferTaskStatus(input.status)) {
      const current = await this.findRowByIdWithClient(client, id, ownerUserId);
      if (
        current &&
        normalizeTransferTaskStatus(current.status) === input.status
      ) {
        return this.mapRow(current);
      }
      if (input.expectedStatus === input.status) return null;
    }
    const now = new Date();
    const requestedProgress =
      input.progress === undefined
        ? null
        : this.toPrismaProgress(input.progress);
    const requestedFailureCode = input.status
      ? input.status === 'failed'
        ? (input.failureCode ?? 'TRANSFER_FAILED')
        : input.status === 'expired'
          ? (input.failureCode ?? 'TRANSFER_EXPIRED')
          : null
      : undefined;
    const data: Prisma.TransferTaskUpdateManyMutationInput = {
      updatedAt: now,
    };
    if (input.status) data.status = input.status;
    if (input.status) data.failureCode = requestedFailureCode;
    if (requestedProgress !== null) data.progress = requestedProgress;
    if (input.nodeId !== undefined) data.nodeId = input.nodeId;
    const hasUpdate =
      input.status !== undefined ||
      input.progress !== undefined ||
      input.nodeId !== undefined;
    if (!hasUpdate) return this.findByIdWithClient(client, id, ownerUserId);

    const where: Prisma.TransferTaskWhereInput = {
      id,
      transferType: 'upload',
      NOT: {
        ...(input.status !== undefined
          ? { status: input.status, failureCode: requestedFailureCode }
          : {}),
        ...(requestedProgress !== null ? { progress: requestedProgress } : {}),
        ...(input.nodeId !== undefined ? { nodeId: input.nodeId } : {}),
      },
      ...(requestedProgress !== null
        ? { progress: { lte: requestedProgress } }
        : {}),
      status: input.expectedStatus
        ? input.expectedStatus
        : input.status
          ? {
              in:
                input.status === 'running'
                  ? ['pending', 'running']
                  : getTransferTaskTransitionSources(input.status).filter(
                      (source) =>
                        source !== input.status ||
                        !isTerminalTransferTaskStatus(input.status),
                    ),
            }
          : { in: ['pending', 'running', 'paused', 'failed'] },
      ...(input.status === 'expired'
        ? {}
        : {
            AND: [
              {
                OR: [
                  ...(input.status === 'completed' ||
                  input.status === 'canceled'
                    ? [{ status: input.status }]
                    : []),
                  { expiresAt: null },
                  { expiresAt: { gt: now } },
                ],
              },
            ],
          }),
      ...(ownerUserId ? { ownerUserId } : {}),
    };

    const rows = await client.transferTask.updateManyAndReturn({
      where,
      data,
    });
    if (rows.length !== 1) {
      const currentRow = await this.findRowByIdWithClient(
        client,
        id,
        ownerUserId,
      );
      if (currentRow && this.isNoopUpdate(currentRow, input)) {
        return this.mapRow(currentRow);
      }
      const current = currentRow ? this.mapRow(currentRow) : null;
      const progressOnly =
        input.progress !== undefined &&
        input.status === undefined &&
        input.nodeId === undefined;
      if (progressOnly) {
        if (
          current &&
          input.progress !== undefined &&
          current.progress >= this.normalizeProgress(input.progress) &&
          ['pending', 'running', 'paused', 'failed'].includes(current.status)
        ) {
          return current;
        }
      }
      if (input.progress !== undefined && input.status !== undefined) {
        if (
          current &&
          current.progress > this.normalizeProgress(input.progress)
        ) {
          return this.updateWithClient(
            client,
            id,
            { ...input, progress: undefined },
            ownerUserId,
            mutation,
          );
        }
      }
      return null;
    }
    const [row] = rows;
    if (input.status && row.status !== input.status) return null;

    if (mutation) mutation.changed = true;
    return this.mapRow(row);
  }

  async delete(
    id: string,
    auditMetadata: TransferAuditMetadata = {},
    ownerUserId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const transfer = await this.findByIdWithClient(tx, id, ownerUserId);
      if (!transfer) return false;
      const deleted = await tx.transferTask.deleteMany({
        where: {
          id,
          transferType: 'upload',
          ...(ownerUserId ? { ownerUserId } : {}),
        },
      });
      if (deleted.count === 0) return false;
      await this.recordAudit(
        'transfer.deleted',
        transfer,
        auditMetadata,
        {},
        tx,
      );
      return true;
    });
  }

  async deleteUserControlled(
    id: string,
    auditMetadata: TransferAuditMetadata = {},
    ownerUserId?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await this.findByIdWithClient(tx, id, ownerUserId);
        if (!current) return false;
        const deleted = await tx.transferTask.deleteMany({
          where: {
            id,
            transferType: 'upload',
            ...(ownerUserId ? { ownerUserId } : {}),
          },
        });
        if (deleted.count !== 1) return false;
        await this.assertNoActiveUploadOperation(tx, id);
        await this.assertNoNonTerminalUploadSession(tx, id);
        await this.recordAudit(
          'transfer.deleted',
          current,
          auditMetadata,
          {},
          tx,
        );
        return true;
      });
    } catch (error) {
      if (error instanceof ActiveUploadOperationError) return null;
      throw error;
    }
  }

  async failStaleRunning(
    cutoff: Date,
    workspaceId?: string,
    ownerUserId?: string,
  ) {
    const now = new Date();
    const activeOperationCutoff = new Date(now.getTime() - 15 * 60 * 1000);
    return this.prisma.$transaction(async (tx) => {
      const activeOperations = await tx.uploadSession.findMany({
        where: {
          completionToken: { not: null },
          completionStartedAt: { gt: activeOperationCutoff },
        },
        select: { transferId: true },
      });
      const activeTransferIds = activeOperations.map((row) => row.transferId);
      const where: Prisma.TransferTaskWhereInput = {
        ...(activeTransferIds.length > 0
          ? { id: { notIn: activeTransferIds } }
          : {}),
        status: 'running',
        transferType: 'upload',
        updatedAt: { lt: cutoff },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
      if (workspaceId) where.workspaceId = workspaceId;
      if (ownerUserId) where.ownerUserId = ownerUserId;

      const rows = await tx.transferTask.updateManyAndReturn({
        where,
        data: {
          status: 'failed',
          failureCode: 'TRANSFER_STALLED',
          updatedAt: now,
        },
      });
      if (rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      const synchronizedSessions = await tx.uploadSession.updateMany({
        where: {
          transferId: { in: ids },
          status: {
            in: getTransferTaskTransitionSources('failed'),
          },
        },
        data: {
          status: 'failed',
          failureCode: 'TRANSFER_STALLED',
          completionToken: null,
          completionStartedAt: null,
          updatedAt: now,
        },
      });
      if (synchronizedSessions.count !== ids.length) {
        throw new TransferStateConflictError(
          'A stale transfer could not be synchronized with its upload session',
        );
      }

      const transfers = rows.map((row) => this.mapRow(row));
      for (const transfer of transfers) {
        await this.recordAudit(
          'transfer.failed',
          transfer,
          { actorName: 'System', result: 'failed' },
          { actor: 'system' },
          tx,
        );
      }
      return transfers;
    });
  }

  async findById(id: string, ownerUserId?: string) {
    return this.findByIdWithClient(this.prisma, id, ownerUserId);
  }

  private async findByIdWithClient(
    client: TransferDataClient,
    id: string,
    ownerUserId?: string,
  ) {
    const row = await this.findRowByIdWithClient(client, id, ownerUserId);
    return row ? this.mapRow(row) : null;
  }

  private findRowByIdWithClient(
    client: TransferDataClient,
    id: string,
    ownerUserId?: string,
  ) {
    return client.transferTask.findFirst({
      where: {
        id,
        transferType: 'upload',
        ...(ownerUserId ? { ownerUserId } : {}),
      },
    });
  }

  async list(workspaceId?: string, limit = 100, ownerUserId?: string) {
    const rows = await this.prisma.transferTask.findMany({
      where: {
        transferType: 'upload',
        ...(workspaceId ? { workspaceId } : {}),
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit), 1), 500),
    });
    return rows.map((row) => this.mapRow(row));
  }

  private async assertNoActiveUploadOperation(
    client: UploadGuardClient,
    transferId: string,
  ) {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    const activeSession = await client.uploadSession.findFirst({
      where: {
        transferId,
        completionToken: { not: null },
        completionStartedAt: { gt: staleBefore },
      },
      select: { id: true },
    });
    if (activeSession) throw new ActiveUploadOperationError();
  }

  private async assertNoNonTerminalUploadSession(
    client: UploadGuardClient,
    transferId: string,
  ) {
    const activeSession = await client.uploadSession.findFirst({
      where: {
        transferId,
        status: { notIn: ['completed', 'expired', 'canceled'] },
      },
      select: { id: true },
    });
    if (activeSession) throw new ActiveUploadOperationError();
  }

  private async syncUploadSessionStatus(
    client: UploadGuardClient,
    transferId: string,
    input: TransferUpdateInput,
  ) {
    const status = input.status;
    if (!status || status === 'completed') return;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
    const sourceStatuses =
      status === 'running'
        ? ['pending', 'running', 'paused', 'failed']
        : getTransferTaskTransitionSources(status).filter(
            (source) =>
              source !== status || !isTerminalTransferTaskStatus(status),
          );
    const synchronizedSessions = await client.uploadSession.updateMany({
      where: {
        transferId,
        status: { in: sourceStatuses },
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
        status,
        failureCode:
          status === 'failed'
            ? (input.failureCode ?? 'UPLOAD_FAILED')
            : status === 'expired'
              ? (input.failureCode ?? 'UPLOAD_SESSION_EXPIRED')
              : null,
        completionToken: null,
        completionStartedAt: null,
        updatedAt: now,
      },
    });
    if (synchronizedSessions.count !== 1) {
      throw new TransferStateConflictError(
        'Transfer status changed without a matching upload session transition',
      );
    }
  }

  private async recordTransferUpdateAudit(
    transfer: TransferResponse | null,
    input: TransferUpdateInput,
    client: TransferAuditClient = this.prisma,
  ) {
    if (!transfer) return;
    const action = this.getStatusAuditAction(input.status);
    if (action) {
      await this.recordAudit(action, transfer, input.auditMetadata, {}, client);
    }
  }

  private isNoopUpdate(row: TransferTask, input: TransferUpdateInput) {
    const current = this.mapRow(row);
    if (input.status !== undefined) {
      if (row.status !== input.status || current.status !== input.status) {
        return false;
      }
      const requestedFailureCode =
        input.status === 'failed'
          ? (input.failureCode ?? 'TRANSFER_FAILED')
          : input.status === 'expired'
            ? (input.failureCode ?? 'TRANSFER_EXPIRED')
            : null;
      if (current.failureCode !== requestedFailureCode) return false;
    } else if (isTerminalTransferTaskStatus(current.status)) {
      return false;
    }
    if (
      input.progress !== undefined &&
      current.progress !== this.normalizeProgress(input.progress)
    ) {
      return false;
    }
    if (input.nodeId !== undefined && current.nodeId !== input.nodeId) {
      return false;
    }
    return true;
  }

  private async recordAudit(
    action: TransferAuditAction,
    transfer: TransferResponse,
    metadata: TransferAuditMetadata = {},
    options: { actor?: AuditActor } = {},
    client: TransferAuditClient = this.prisma,
  ) {
    const event = createAuditEvent({
      action,
      actor: options.actor ?? 'workspace',
      target: transfer.id,
      workspaceId: transfer.workspaceId,
      nodeId: transfer.nodeId,
      metadata: {
        source: 'transfers-service',
        transferType: transfer.type,
        hasContent: Boolean(transfer.objectKey),
        status: transfer.status,
        failureCode: transfer.failureCode,
        result: action === 'transfer.failed' ? 'failed' : 'success',
        ...metadata,
      },
    });

    await client.auditEvent.create({
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

  private mapRow(row: TransferTask): TransferResponse {
    const lifecycle = createTransferTaskLifecycle({
      status: row.status,
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
    });
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      ownerUserId: row.ownerUserId,
      nodeId: row.nodeId,
      objectKey: row.objectKey,
      name: row.name,
      type: row.transferType as TransferType,
      progress: Number(row.progress),
      status: lifecycle.status,
      failureCode: lifecycle.errorCode,
      expiresAt: lifecycle.expiresAt,
      lifecycle,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private getStatusAuditAction(
    status?: TransferStatus,
  ): TransferAuditAction | null {
    if (status === 'completed') return 'transfer.completed';
    if (status === 'failed') return 'transfer.failed';
    if (status === 'paused') return 'transfer.paused';
    if (status === 'canceled') return 'transfer.canceled';
    if (status === 'expired') return 'transfer.expired';
    return null;
  }

  private normalizeProgress(value: number) {
    const finiteValue = Number.isFinite(value) ? value : 0;
    return Math.min(100, Math.max(0, Math.round(finiteValue * 10) / 10));
  }

  private toPrismaProgress(value: number) {
    return new Prisma.Decimal(this.normalizeProgress(value).toFixed(1));
  }
}
