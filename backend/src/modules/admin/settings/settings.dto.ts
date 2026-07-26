import {
  ArrayMaxSize,
  IsArray,
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
import {
  UpdateStorageSettingsDto,
  type StorageSettingsResponse,
} from '../../storage/storage-settings.dto';

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

export type OAuthProviderProfile = 'oidc' | 'oauth2' | 'icetowne-blog';
export type OAuthProviderKey =
  | 'google'
  | 'github'
  | 'microsoft'
  | 'gitlab'
  | 'oidc'
  | 'icetowne-blog';

export type OAuthSettings = {
  id: string;
  enabled: boolean;
  providerKey: OAuthProviderKey;
  displayName: string;
  providerProfile: OAuthProviderProfile;
  issuerUrl: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret?: string;
  audience: string;
  scopes: string;
  redirectUri: string;
  allowSignup: boolean;
  linkByVerifiedEmail: boolean;
  requireVerifiedEmail: boolean;
  allowedEmailDomains: string[];
  createdAt: string;
  updatedAt: string;
};

export type OAuthProviderMode = 'standard' | 'compatibility';

export type OAuthSettingsResponse = Omit<OAuthSettings, 'clientSecret'> & {
  clientSecretConfigured: boolean;
  configured: boolean;
  providerMode: OAuthProviderMode;
};

export type OAuthProviderListResponse = {
  activeProvider: OAuthSettingsResponse | null;
  configured: boolean;
  providers: OAuthSettingsResponse[];
};

export type PasskeySettings = {
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

type SetupStatusBase = {
  databaseAvailable: boolean;
};

export type SetupAccessState =
  | { authorized: false; configured: boolean }
  | { authorized: true; configured: true };

export type SetupStatusResponse =
  | (SetupStatusBase & {
      needsSetup: false;
      bootstrapCompleted: true;
    })
  | (SetupStatusBase & {
      needsSetup: true;
      bootstrapCompleted: false;
      setupAccess: SetupAccessState & { authorized: false };
    })
  | (SetupStatusBase & {
      needsSetup: true;
      bootstrapCompleted: false;
      setupAccess: SetupAccessState & {
        authorized: true;
        configured: true;
      };
      databaseProfile: DatabaseProfile;
      site: PublicSiteSettings;
      oauth: OAuthSettingsResponse;
      passkey: PasskeySettings;
      mail: MailSettingsResponse;
      storage: StorageSettingsResponse;
    });

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
  @IsString()
  @Length(1, 80)
  @IsOptional()
  id?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsIn(['google', 'github', 'microsoft', 'gitlab', 'oidc', 'icetowne-blog'])
  @IsOptional()
  providerKey?: OAuthSettings['providerKey'];

  @IsString()
  @Length(1, 120)
  @IsOptional()
  displayName?: string;

  @IsIn(['oidc', 'oauth2', 'icetowne-blog'])
  @IsOptional()
  providerProfile?: OAuthSettings['providerProfile'];

  @IsString()
  @IsOptional()
  issuerUrl?: string;

  @IsString()
  @IsOptional()
  authorizationUrl?: string;

  @IsString()
  @IsOptional()
  tokenUrl?: string;

  @IsString()
  @IsOptional()
  userinfoUrl?: string;

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

  @IsBoolean()
  @IsOptional()
  allowSignup?: boolean;

  @IsBoolean()
  @IsOptional()
  linkByVerifiedEmail?: boolean;

  @IsBoolean()
  @IsOptional()
  requireVerifiedEmail?: boolean;

  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @IsOptional()
  allowedEmailDomains?: string[];
}

export class UpdatePasskeySettingsDto {
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
  @Type(() => UpdateStorageSettingsDto)
  @IsOptional()
  storage?: UpdateStorageSettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SetupSharePolicyDto)
  sharePolicy!: SetupSharePolicyDto;
}
