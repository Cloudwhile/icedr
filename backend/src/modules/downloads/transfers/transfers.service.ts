import { Injectable, NotFoundException } from '@nestjs/common';
import { TransferStatus } from './transfers.dto';
import {
  TransfersRepository,
  type TransferAuditMetadata,
} from './transfers.repository';

@Injectable()
export class TransfersService {
  private readonly staleRunningTransferMs = 5 * 60 * 1000;

  constructor(private readonly transfersRepository: TransfersRepository) {}

  async listTransfers(filters: { workspaceId?: string; limit?: number } = {}) {
    await this.transfersRepository.failStaleRunning(
      new Date(Date.now() - this.staleRunningTransferMs),
      filters.workspaceId,
    );
    return this.transfersRepository.list(filters.workspaceId, filters.limit);
  }

  createUploadTransfer(input: {
    workspaceId: string;
    objectKey: string;
    name: string;
    auditMetadata?: TransferAuditMetadata;
  }) {
    return this.transfersRepository.create({
      workspaceId: input.workspaceId,
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
    auditMetadata?: TransferAuditMetadata;
  }) {
    const transfer = await this.transfersRepository.update(input.transferId, {
      status: 'completed',
      progress: 100,
      nodeId: input.nodeId,
      auditMetadata: input.auditMetadata,
    });
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
  ) {
    const transfer = await this.transfersRepository.update(id, input);
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  async deleteTransfer(id: string, auditMetadata: TransferAuditMetadata = {}) {
    const deleted = await this.transfersRepository.delete(id, auditMetadata);
    if (!deleted) throw new NotFoundException('Transfer not found');
    return { ok: true };
  }
}
