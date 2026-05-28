import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type AnonymousAccessPolicy = 'blocked' | 'email-required' | 'public';
export type EmailRule = 'any' | 'domains';

export class WorkspaceShareAuditSettingsDto {
  @IsBoolean()
  ip!: boolean;

  @IsBoolean()
  userAgent!: boolean;

  @IsBoolean()
  downloads!: boolean;

  @IsBoolean()
  anomaly!: boolean;

  @IsBoolean()
  alerts!: boolean;
}

export class UpdateWorkspaceShareSettingsDto {
  @IsIn(['blocked', 'email-required', 'public'])
  @IsOptional()
  anonymousAccess?: AnonymousAccessPolicy;

  @IsIn(['any', 'domains'])
  @IsOptional()
  emailRule?: EmailRule;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedDomains?: string[];

  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  defaultExpiresDays?: number;

  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  maxExpiresDays?: number;

  @IsBoolean()
  @IsOptional()
  allowPermanent?: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceShareAuditSettingsDto)
  @IsOptional()
  audit?: WorkspaceShareAuditSettingsDto;
}

export type WorkspaceShareSettings = {
  workspaceId: string;
  anonymousAccess: AnonymousAccessPolicy;
  emailRule: EmailRule;
  allowedDomains: string[];
  defaultExpiresDays: number;
  maxExpiresDays: number;
  allowPermanent: boolean;
  audit: WorkspaceShareAuditSettingsDto;
  updatedAt: string;
};
