import {
  IsInt,
  Max,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateAuthSettingsDto } from '../../auth/core/auth.dto';
import { UpdatePasskeySettingsDto } from '../settings/settings.dto';

export class UpdateAdminStoragePolicyDto {
  @IsString()
  workspaceId!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  @Type(() => Number)
  @IsOptional()
  quotaBytes?: number | null;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  @Type(() => Number)
  @IsOptional()
  defaultUserQuotaBytes?: number | null;
}

export class UpdateAdminAuthPolicyDto {
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateAuthSettingsDto)
  auth!: UpdateAuthSettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UpdatePasskeySettingsDto)
  @IsOptional()
  passkey?: UpdatePasskeySettingsDto;
}
