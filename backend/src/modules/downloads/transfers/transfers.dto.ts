import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export type TransferType = 'upload' | 'download';
export type TransferStatus = 'running' | 'completed' | 'failed';

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
  @IsIn(['running', 'completed', 'failed'])
  status!: TransferStatus;

  @IsInt()
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
