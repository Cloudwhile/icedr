import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorageIntegrityAcknowledgementRepository } from './storage-integrity-acknowledgement.repository';

@Injectable()
export class StorageIntegrityAcknowledgementService {
  constructor(
    private readonly repository: StorageIntegrityAcknowledgementRepository,
  ) {}

  async acknowledgeResult(resultId: string, actorUserId: string) {
    const outcome = await this.repository.acknowledgeResult(
      resultId.trim(),
      actorUserId.trim(),
    );
    if (!outcome) throw new NotFoundException('完整性巡检结果不存在');
    if (outcome.kind === 'invalid-status') {
      throw new BadRequestException('只有异常或失败的完整性结果可以确认');
    }
    return outcome.result;
  }
}
