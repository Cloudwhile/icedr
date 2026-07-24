import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TransferTaskFailureCode } from '../../../common/transfers/transfer-task-state';
import { TransferStatus } from './transfers.dto';
import {
  TransferStateConflictError,
  TransfersRepository,
  type TransferAuditMetadata,
} from './transfers.repository';

type TransferAccess = {
  actorRole: string;
  actorUserId: string;
};

@Injectable()
export class TransfersService {
  private readonly staleRunningTransferMs = 5 * 60 * 1000;

  constructor(private readonly transfersRepository: TransfersRepository) {}

  async listTransfers(
    filters: { workspaceId?: string; limit?: number } = {},
    access: TransferAccess,
  ) {
    const ownerUserId = this.getOwnerFilter(access);
    try {
      await this.transfersRepository.failStaleRunning(
        new Date(Date.now() - this.staleRunningTransferMs),
        filters.workspaceId,
        ownerUserId,
      );
    } catch (error) {
      this.rethrowTransferStateConflict(error);
    }
    return this.transfersRepository.list(
      filters.workspaceId,
      filters.limit,
      ownerUserId,
    );
  }

  createUploadTransfer(input: {
    workspaceId: string;
    ownerUserId?: string;
    objectKey: string;
    name: string;
    expiresAt?: Date | null;
    auditMetadata?: TransferAuditMetadata;
  }) {
    return this.transfersRepository.create({
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      objectKey: input.objectKey,
      name: input.name,
      type: 'upload',
      progress: 0,
      status: 'running',
      expiresAt: input.expiresAt,
      auditMetadata: input.auditMetadata,
    });
  }

  async completeTransfer(input: {
    transferId: string;
    nodeId: string;
    ownerUserId?: string | null;
    auditMetadata?: TransferAuditMetadata;
  }) {
    const transfer = await this.transfersRepository.update(
      input.transferId,
      {
        status: 'completed',
        progress: 100,
        nodeId: input.nodeId,
        auditMetadata: input.auditMetadata,
      },
      input.ownerUserId?.trim() || undefined,
    );
    if (!transfer) {
      return this.throwTransferUpdateFailure(
        input.transferId,
        input.ownerUserId?.trim() || undefined,
      );
    }
    return transfer;
  }

  async updateTransfer(
    id: string,
    input: {
      status: TransferStatus;
      expectedStatus?: TransferStatus;
      failureCode?: TransferTaskFailureCode | null;
      progress?: number;
      auditMetadata?: TransferAuditMetadata;
    },
    access: TransferAccess,
  ) {
    if (input.status === 'completed') {
      throw new BadRequestException(
        'Upload transfers can only be completed by the upload completion flow',
      );
    }
    const transfer = await this.transfersRepository
      .updateUserControlled(id, input, this.getOwnerFilter(access))
      .catch((error: unknown) => this.rethrowTransferStateConflict(error));
    if (!transfer) {
      return this.throwTransferUpdateFailure(id, this.getOwnerFilter(access));
    }
    return transfer;
  }

  async updateTransferInternal(
    id: string,
    input: {
      status: TransferStatus;
      expectedStatus?: TransferStatus;
      failureCode?: TransferTaskFailureCode | null;
      progress?: number;
      auditMetadata?: TransferAuditMetadata;
    },
    ownerUserId?: string | null,
  ) {
    const transfer = await this.transfersRepository.update(
      id,
      input,
      ownerUserId?.trim() || undefined,
    );
    if (!transfer) {
      return this.throwTransferUpdateFailure(
        id,
        ownerUserId?.trim() || undefined,
      );
    }
    return transfer;
  }

  async resumeTransferInternal(
    id: string,
    progress: number,
    ownerUserId?: string | null,
  ) {
    const ownerFilter = ownerUserId?.trim() || undefined;
    const current = await this.transfersRepository.findById(id, ownerFilter);
    if (!current) throw new NotFoundException('Transfer not found');
    const transfer = await this.transfersRepository.update(
      id,
      {
        expectedStatus: current.status,
        progress,
        status: 'running',
      },
      ownerFilter,
    );
    if (!transfer) {
      return this.throwTransferUpdateFailure(id, ownerFilter);
    }
    return transfer;
  }

  async updateTransferProgressInternal(
    id: string,
    progress: number,
    ownerUserId?: string | null,
  ) {
    const ownerFilter = ownerUserId?.trim() || undefined;
    const transfer = await this.transfersRepository.update(
      id,
      { progress },
      ownerFilter,
    );
    if (!transfer) {
      return this.throwTransferUpdateFailure(id, ownerFilter);
    }
    return transfer;
  }

  async deleteTransfer(
    id: string,
    auditMetadata: TransferAuditMetadata = {},
    access: TransferAccess,
  ) {
    const deleted = await this.transfersRepository.deleteUserControlled(
      id,
      auditMetadata,
      this.getOwnerFilter(access),
    );
    if (deleted === null) {
      throw new ConflictException({
        code: 'TRANSFER_OPERATION_IN_PROGRESS',
        message: 'Transfer has an upload operation in progress',
      });
    }
    if (!deleted) throw new NotFoundException('Transfer not found');
    return { ok: true };
  }

  private getOwnerFilter(access: TransferAccess) {
    if (access.actorRole === 'admin' || access.actorRole === 'owner') {
      return undefined;
    }
    const actorUserId = access.actorUserId.trim();
    if (!actorUserId) {
      throw new ForbiddenException('Transfer owner context is required');
    }
    return actorUserId;
  }

  private async throwTransferUpdateFailure(
    id: string,
    ownerUserId?: string,
  ): Promise<never> {
    const current = await this.transfersRepository.findById(id, ownerUserId);
    if (!current) throw new NotFoundException('Transfer not found');
    throw new ConflictException({
      code: 'TRANSFER_STATE_CONFLICT',
      message: 'Transfer status changed before the update was applied',
      currentStatus: current.status,
    });
  }

  private rethrowTransferStateConflict(error: unknown): never {
    if (error instanceof TransferStateConflictError) {
      throw new ConflictException({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}
