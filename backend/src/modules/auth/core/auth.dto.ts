import {
  IsBoolean,
  IsEmail,
  IsIn,
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
  minimumAuthenticationMethods: number;
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

  @IsOptional()
  @IsIn([1, 2])
  minimumAuthenticationMethods?: number;
}

export class UpdateCurrentUserDto {
  @IsString()
  @Length(1, 80)
  @IsOptional()
  displayName?: string;

  @IsString()
  @Length(0, 200000)
  @IsOptional()
  avatarUrl?: string | null;

  @IsString()
  @Length(1, 32)
  @IsOptional()
  locale?: string | null;

  @IsIn(['system', 'dark', 'light'])
  @IsOptional()
  theme?: string | null;

  @IsString()
  @Length(1, 80)
  @IsOptional()
  timezone?: string | null;
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
