import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type JsonRecord = Record<string, unknown>;

export type DatabaseProfile = {
  provider: 'sqlite' | 'postgresql';
  host: string;
  port: number;
  dbName: string;
  user: string;
  passwordProvided: boolean;
  passwordSource: 'env' | 'setup' | 'local';
  verified: boolean;
  verifiedAt: string | null;
};

export type PublicSiteSettings = {
  siteName: string;
  authLogoDataUrl: string | null;
};

export type TranslationBundle = {
  code: string;
  content: string;
  language: string;
  updatedAt: string;
};

export type TranslationSettings = {
  bundles: TranslationBundle[];
};

export type OAuthSettings = {
  enabled: boolean;
  providerProfile: 'oidc' | 'icetowne-blog';
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  audience: string;
  scopes: string;
  redirectUri: string;
};

export type OAuthProviderMode = 'standard' | 'compatibility';

export type OAuthSettingsResponse = Omit<OAuthSettings, 'clientSecret'> & {
  clientSecretConfigured: boolean;
  providerMode: OAuthProviderMode;
};

export type PasskeySettings = {
  enabled: boolean;
  rpName: string;
  rpId: string;
  origin: string;
};

export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  verifiedAt: string | null;
};

export type MailSettingsResponse = Omit<MailSettings, 'password'> & {
  configured: boolean;
  passwordConfigured: boolean;
};

export type SetupStatusResponse = {
  databaseAvailable: boolean;
  needsSetup: boolean;
  bootstrapCompleted: boolean;
  databaseProfile: DatabaseProfile;
  site: PublicSiteSettings;
  oauth: OAuthSettingsResponse;
  passkey: PasskeySettings;
  mail: MailSettingsResponse;
};

export type AdminSettingsResponse = {
  site: PublicSiteSettings;
  databaseProfile: DatabaseProfile;
  oauth: OAuthSettingsResponse;
  passkey: PasskeySettings;
  mail: MailSettingsResponse;
  bootstrapCompleted: boolean;
};

export class UpsertTranslationBundleDto {
  @IsString()
  @Length(2, 32)
  code!: string;

  @IsString()
  content!: string;
}

export class UpdateSiteSettingsDto {
  @IsString()
  @Length(1, 80)
  @IsOptional()
  siteName?: string;

  @IsString()
  @IsOptional()
  authLogoDataUrl?: string | null;
}

export class UpdateOAuthSettingsDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsIn(['oidc', 'icetowne-blog'])
  @IsOptional()
  providerProfile?: OAuthSettings['providerProfile'];

  @IsString()
  @IsOptional()
  issuerUrl?: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsString()
  @IsOptional()
  audience?: string;

  @IsString()
  @IsOptional()
  scopes?: string;

  @IsString()
  @IsOptional()
  redirectUri?: string;
}

export class UpdatePasskeySettingsDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @Length(1, 80)
  @IsOptional()
  rpName?: string;

  @IsString()
  @IsOptional()
  rpId?: string;

  @IsString()
  @IsOptional()
  origin?: string;
}

export class UpdateMailSettingsDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  host?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  fromName?: string;

  @IsEmail()
  @IsOptional()
  fromEmail?: string;

  @IsEmail()
  @IsOptional()
  replyTo?: string;
}

export class TestMailSettingsDto {
  @IsEmail()
  recipientEmail!: string;
}

export class VerifyDatabaseDto {
  @IsIn(['postgresql'])
  @IsOptional()
  provider?: 'postgresql';

  @IsString()
  @IsOptional()
  host?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  dbName?: string;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsBoolean()
  @IsOptional()
  confirm?: boolean;
}

export class SetupAdminDto {
  @IsString()
  @Length(1, 80)
  displayName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}

class SetupSharePolicyAuditDto {
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

export class SetupSharePolicyDto {
  @IsIn(['blocked', 'email-required', 'public'])
  anonymousAccess!: 'blocked' | 'email-required' | 'public';

  @IsIn(['any', 'domains'])
  emailRule!: 'any' | 'domains';

  @IsOptional()
  allowedDomains?: string[];

  @IsInt()
  @Min(1)
  @Max(365)
  defaultExpiresDays!: number;

  @IsInt()
  @Min(1)
  @Max(365)
  maxExpiresDays!: number;

  @IsBoolean()
  allowPermanent!: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => SetupSharePolicyAuditDto)
  audit!: SetupSharePolicyAuditDto;
}

export class CompleteSetupDto {
  @IsObject()
  @ValidateNested()
  @Type(() => SetupAdminDto)
  admin!: SetupAdminDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UpdateSiteSettingsDto)
  site!: UpdateSiteSettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UpdateOAuthSettingsDto)
  @IsOptional()
  oauth?: UpdateOAuthSettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UpdatePasskeySettingsDto)
  @IsOptional()
  passkey?: UpdatePasskeySettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => UpdateMailSettingsDto)
  @IsOptional()
  mail?: UpdateMailSettingsDto;

  @IsBoolean()
  localEnabled!: boolean;

  @IsBoolean()
  oauthEnabled!: boolean;

  @IsBoolean()
  passkeyEnabled!: boolean;

  @IsBoolean()
  distributedStorageEnabled!: boolean;

  @IsObject()
  @ValidateNested()
  @Type(() => SetupSharePolicyDto)
  sharePolicy!: SetupSharePolicyDto;
}
