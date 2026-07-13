import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export type PasskeyCeremonyResponse<TOptions> = {
  ceremonyId: string;
  expectedOrigin: string;
  options: TOptions;
};

export class PasskeyRegistrationOptionsDto {
  @IsString()
  @Length(16, 512)
  stepUpToken!: string;
}

export class PasskeyRegistrationVerificationDto {
  @IsString()
  @Length(16, 256)
  ceremonyId!: string;

  @IsString()
  @Length(1, 80)
  @IsOptional()
  name?: string;

  @IsDefined()
  @IsObject()
  response!: unknown;
}

export class PasskeyAuthenticationVerificationDto {
  @IsString()
  @Length(16, 256)
  ceremonyId!: string;

  @IsDefined()
  @IsObject()
  response!: unknown;
}

export class PasskeyStepUpPasswordDto {
  @IsString()
  @Length(8, 128)
  password!: string;
}

export class PasskeyStepUpVerificationDto extends PasskeyAuthenticationVerificationDto {}

export class PasskeyOAuthStepUpExchangeDto {
  @IsString()
  @Length(16, 256)
  code!: string;
}

export class PasskeyRecoveryCodeDto {
  @IsString()
  @Length(12, 32)
  @Matches(/^[A-Za-z0-9-]+$/)
  code!: string;
}

export class PasskeyRecoveryCodeGenerateDto {
  @IsString()
  @Length(16, 512)
  stepUpToken!: string;
}

export class PasskeyRenameDto {
  @IsString()
  @Length(1, 80)
  name!: string;
}

export class PasskeyDeleteDto {
  @IsString()
  @Length(16, 512)
  stepUpToken!: string;
}
