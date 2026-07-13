import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransferStatus } from './transfers.dto';
import {
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
    await this.transfersRepository.failStaleRunning(
      new Date(Date.now() - this.staleRunningTransferMs),
      filters.workspaceId,
      ownerUserId,
    );
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
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  async updateTransfer(
    id: string,
    input: {
      status: TransferStatus;
      progress?: number;
      auditMetadata?: TransferAuditMetadata;
    },
    access: TransferAccess,
  ) {
    const transfer = await this.transfersRepository.update(
      id,
      input,
      this.getOwnerFilter(access),
    );
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  async updateTransferInternal(
    id: string,
    input: {
      status: TransferStatus;
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
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  async deleteTransfer(
    id: string,
    auditMetadata: TransferAuditMetadata = {},
    access: TransferAccess,
  ) {
    const deleted = await this.transfersRepository.delete(
      id,
      auditMetadata,
      this.getOwnerFilter(access),
    );
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
}
