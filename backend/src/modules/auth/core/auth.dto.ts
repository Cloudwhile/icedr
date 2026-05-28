import {
  IsBoolean,
  IsDefined,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export type AuthLocale = 'en' | 'zh';

export type AuthSettings = {
  localEnabled: boolean;
  oauthEnabled: boolean;
  passkeyEnabled: boolean;
  updatedAt: string;
};

export type AuthSettingsResponse = AuthSettings & {
  oauthConfigured: boolean;
  passkeyConfigured: boolean;
};

export type AuthUserResponse = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  avatarUrl: string | null;
  locale: string | null;
  theme: string | null;
  timezone: string | null;
  createdAt: string;
};

export type AuthSessionResponse = {
  token: string;
  expiresAt: string;
  user: AuthUserResponse;
};

export type PasswordResetRequestResponse = {
  configured: boolean;
  delivery: 'email';
  expiresAt: string;
};

export type PasswordResetVerifyResponse = {
  verified: true;
  expiresAt: string;
};

export type PasswordResetConfirmResponse = AuthSessionResponse;

export type OAuthStartResponse = {
  authorizationUrl: string;
};

export type OAuthExchangeResponse = AuthSessionResponse;

export type PasskeyResponse = {
  id: string;
  name: string;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export class UpdateAuthSettingsDto {
  @IsBoolean()
  @IsOptional()
  localEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  oauthEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  passkeyEnabled?: boolean;
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}

export class PasswordResetRequestDto {
  @IsEmail()
  email!: string;

  @IsIn(['en', 'zh'])
  @IsOptional()
  locale?: AuthLocale;
}

export class PasswordResetConfirmDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Za-z0-9]{6}$/)
  code!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}

export class PasswordResetVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Za-z0-9]{6}$/)
  code!: string;
}

export class OAuthExchangeDto {
  @IsString()
  @Length(16, 256)
  code!: string;
}

export class OAuthCallbackDto {
  @IsString()
  @Length(1, 2048)
  callbackUrl!: string;
}

export class PasskeyRegistrationVerificationDto {
  @IsString()
  @Length(1, 80)
  @IsOptional()
  name?: string;

  @IsDefined()
  @IsObject()
  response!: unknown;
}

export class PasskeyAuthenticationOptionsDto {
  @IsEmail()
  email!: string;
}

export class PasskeyAuthenticationVerificationDto {
  @IsEmail()
  email!: string;

  @IsDefined()
  @IsObject()
  response!: unknown;
}
