import { Injectable, NotFoundException } from '@nestjs/common';
import { TransferStatus } from './transfers.dto';
import { TransfersRepository } from './transfers.repository';

@Injectable()
export class TransfersService {
  constructor(private readonly transfersRepository: TransfersRepository) {}

  listTransfers(filters: { workspaceId?: string; limit?: number } = {}) {
    return this.transfersRepository.list(filters.workspaceId, filters.limit);
  }

  createUploadTransfer(input: {
    workspaceId: string;
    objectKey: string;
    name: string;
  }) {
    return this.transfersRepository.create({
      workspaceId: input.workspaceId,
      objectKey: input.objectKey,
      name: input.name,
      type: 'upload',
      progress: 5,
      status: 'running',
    });
  }

  async completeTransfer(input: { transferId: string; nodeId: string }) {
    const transfer = await this.transfersRepository.update(input.transferId, {
      status: 'completed',
      progress: 100,
      nodeId: input.nodeId,
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  async updateTransfer(
    id: string,
    input: { status: TransferStatus; progress?: number },
  ) {
    const transfer = await this.transfersRepository.update(id, input);
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }
}
