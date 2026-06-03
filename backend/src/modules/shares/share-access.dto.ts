import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import type { ShareDownloadPolicyDecision } from './share-download-policy';

export class SendShareEmailCodeDto {
  @IsEmail()
  email!: string;
}

export class VerifyShareEmailCodeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code!: string;
}

export type ShareAccessIdentityType =
  | 'anonymous'
  | 'email'
  | 'ica'
  | 'workspace';

export type ShareAccessSession = {
  sessionId: string;
  shareToken: string;
  identityType: ShareAccessIdentityType;
  email?: string;
  availableAt: string;
  waitSeconds: number;
  downloadLimit: string;
  speedLimit: { value: number; unit: 'KB/s' | 'MB/s' } | null;
  policyDecision: ShareDownloadPolicyDecision;
  expiresAt: string;
};
