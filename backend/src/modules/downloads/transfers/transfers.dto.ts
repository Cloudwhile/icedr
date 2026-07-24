import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  transferTaskFailureCodes,
  transferTaskStatuses,
  type TransferTaskFailureCode,
  type TransferTaskLifecycle,
  type TransferTaskStatus,
} from '../../../common/transfers/transfer-task-state';

export type TransferType = 'upload';
export type TransferStatus = TransferTaskStatus;

export class ListTransfersQueryDto {
  @IsString()
  @IsOptional()
  workspaceId?: string;

  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}

export class UpdateTransferDto {
  @IsIn(['running', 'paused', 'failed', 'canceled'])
  status!: TransferStatus;

  @IsIn(transferTaskStatuses)
  @IsOptional()
  expectedStatus?: TransferTaskStatus;

  @IsIn(transferTaskFailureCodes)
  @IsOptional()
  failureCode?: TransferTaskFailureCode;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  @IsOptional()
  progress?: number;
}

export type TransferResponse = {
  id: string;
  workspaceId: string;
  ownerUserId: string | null;
  nodeId: string | null;
  objectKey: string | null;
  name: string;
  type: TransferType;
  progress: number;
  status: TransferStatus;
  failureCode: TransferTaskFailureCode | null;
  expiresAt: string | null;
  lifecycle: TransferTaskLifecycle;
  createdAt: string;
  updatedAt: string;
};

export type PublicTransferResponse = Omit<
  TransferResponse,
  'objectKey' | 'ownerUserId'
> & {
  hasContent: boolean;
};
