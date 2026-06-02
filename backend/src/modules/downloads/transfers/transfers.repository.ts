import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { createAuditEvent } from '../../logs/audit-events';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma, type TransferTask } from '../../../generated/prisma/client';
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
  | 'transfer.deleted';

@Injectable()
export class TransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    workspaceId: string;
    nodeId?: string | null;
    objectKey?: string | null;
    name: string;
    type: TransferType;
    progress?: number;
    status?: TransferStatus;
  }) {
    const id = `transfer_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.transferTask.create({
      data: {
        id,
        workspaceId: input.workspaceId,
        nodeId: input.nodeId ?? null,
        objectKey: input.objectKey ?? null,
        name: input.name,
        transferType: input.type,
        progress: this.toPrismaProgress(input.progress ?? 0),
        status: input.status ?? 'running',
      },
    });
    const transfer = this.mapRow(row);
    await this.recordAudit('transfer.created', transfer);
    return transfer;
  }

  async update(
    id: string,
    input: { status?: TransferStatus; progress?: number; nodeId?: string },
  ) {
    const data: Prisma.TransferTaskUpdateInput = {
      updatedAt: new Date(),
    };
    if (input.status) data.status = input.status;
    if (input.progress !== undefined) {
      data.progress = this.toPrismaProgress(input.progress);
    }
    if (input.nodeId !== undefined) data.nodeId = input.nodeId;
    const hasUpdate =
      input.status !== undefined ||
      input.progress !== undefined ||
      input.nodeId !== undefined;
    if (!hasUpdate) return this.findById(id);

    const existing = await this.prisma.transferTask.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;

    const row = await this.prisma.transferTask.update({
      where: { id },
      data,
    });
    const transfer = this.mapRow(row);
    if (transfer) {
      const action = this.getStatusAuditAction(input.status);
      if (action) await this.recordAudit(action, transfer);
    }
    return transfer;
  }

  async delete(id: string) {
    const transfer = await this.findById(id);
    if (!transfer) return false;
    await this.prisma.transferTask.delete({ where: { id } });
    await this.recordAudit('transfer.deleted', transfer);
    return true;
  }

  async failStaleRunning(cutoff: Date, workspaceId?: string) {
    const where: Prisma.TransferTaskWhereInput = {
      status: 'running',
      updatedAt: { lt: cutoff },
    };
    if (workspaceId) where.workspaceId = workspaceId;

    const staleRows = await this.prisma.transferTask.findMany({
      where,
      select: { id: true },
    });
    if (staleRows.length === 0) return [];

    const ids = staleRows.map((row) => row.id);
    await this.prisma.transferTask.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'failed',
        updatedAt: new Date(),
      },
    });
    const rows = await this.prisma.transferTask.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'desc' },
    });
    const transfers = rows.map((row) => this.mapRow(row));
    for (const transfer of transfers) {
      await this.recordAudit('transfer.failed', transfer);
    }
    return transfers;
  }

  async findById(id: string) {
    const row = await this.prisma.transferTask.findUnique({ where: { id } });
    return row ? this.mapRow(row) : null;
  }

  async list(workspaceId?: string, limit = 100) {
    const rows = await this.prisma.transferTask.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit), 1), 500),
    });
    return rows.map((row) => this.mapRow(row));
  }

  private async recordAudit(
    action: TransferAuditAction,
    transfer: TransferResponse,
  ) {
    const event = createAuditEvent({
      action,
      actor: 'workspace',
      target: transfer.id,
      workspaceId: transfer.workspaceId,
      nodeId: transfer.nodeId,
      metadata: {
        source: 'transfers-service',
        transferType: transfer.type,
        objectKey: transfer.objectKey,
        status: transfer.status,
      },
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

  private mapRow(row: TransferTask): TransferResponse {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      nodeId: row.nodeId,
      objectKey: row.objectKey,
      name: row.name,
      type: row.transferType as TransferType,
      progress: Number(row.progress),
      status: row.status as TransferStatus,
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
