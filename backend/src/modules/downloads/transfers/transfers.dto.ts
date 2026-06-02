import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export type TransferType = 'upload' | 'download';
export type TransferStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

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
  @IsIn(['running', 'paused', 'completed', 'failed', 'canceled'])
  status!: TransferStatus;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  @IsOptional()
  progress?: number;
}

export type TransferResponse = {
  id: string;
  workspaceId: string;
  nodeId: string | null;
  objectKey: string | null;
  name: string;
  type: TransferType;
  progress: number;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
};
