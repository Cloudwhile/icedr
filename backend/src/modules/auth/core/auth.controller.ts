import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  LoginDto,
  OAuthCallbackDto,
  OAuthExchangeDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PasswordResetVerifyDto,
  RegisterDto,
  UpdateAuthSettingsDto,
  UpdateCurrentUserDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import {
  PasskeyAuthenticationVerificationDto,
  PasskeyDeleteDto,
  PasskeyOAuthStepUpExchangeDto,
  PasskeyRecoveryCodeDto,
  PasskeyRecoveryCodeGenerateDto,
  PasskeyRegistrationOptionsDto,
  PasskeyRegistrationVerificationDto,
  PasskeyRenameDto,
  PasskeyStepUpPasswordDto,
  PasskeyStepUpVerificationDto,
} from './passkey.dto';
import { PasskeyService } from './passkey.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passkeyService: PasskeyService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.authService.getSettings();
  }

  @Patch('settings')
  updateSettings(
    @Body() dto: UpdateAuthSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.updateSettings(dto, authorization);
  }

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, request);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, request);
  }

  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    return this.authService.logout(authorization);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.authService.getCurrentUser(authorization);
  }

  @Patch('me')
  updateMe(
    @Body() dto: UpdateCurrentUserDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.updateCurrentUser(dto, authorization);
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('password-reset/verify')
  verifyPasswordReset(@Body() dto: PasswordResetVerifyDto) {
    return this.authService.verifyPasswordReset(dto);
  }

  @Post('password-reset/confirm')
  confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
    @Req() request: Request,
  ) {
    return this.authService.confirmPasswordReset(dto, request);
  }

  @Get('oauth/start')
  startOAuth(@Query('providerId') providerId?: string) {
    return this.authService.startOAuthLogin(providerId);
  }

  @Get('oauth/callback')
  async oauthCallback(@Req() request: Request, @Res() response: Response) {
    const result = await this.authService.handleOAuthCallback(
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    );
    const target = this.authService.buildOAuthFrontendCallbackUrl(
      result.code,
      result.flow,
    );
    response.redirect(302, target);
  }

  @Post('oauth/callback')
  completeFrontendOAuthCallback(
    @Body() dto: OAuthCallbackDto,
    @Req() request: Request,
  ) {
    return this.authService.completeFrontendOAuthCallback(
      dto.callbackUrl,
      request,
    );
  }

  @Post('oauth/exchange')
  exchangeOAuth(@Body() dto: OAuthExchangeDto, @Req() request: Request) {
    return this.authService.exchangeOAuthCode(dto, request);
  }

  @Post('passkeys/registration-options')
  createPasskeyRegistrationOptions(
    @Body() dto: PasskeyRegistrationOptionsDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.createRegistrationOptions(
      dto,
      authorization,
      request,
    );
  }

  @Post('passkeys/registration-verification')
  verifyPasskeyRegistration(
    @Body() dto: PasskeyRegistrationVerificationDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.verifyRegistration(dto, authorization, request);
  }

  @Post('security/reauth/oauth-start')
  startOAuthStepUp(
    @Query('providerId') providerId?: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.startOAuthStepUp(providerId, authorization);
  }

  @Post('security/reauth/oauth-exchange')
  exchangeOAuthStepUp(
    @Body() dto: PasskeyOAuthStepUpExchangeDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.authService.exchangeOAuthStepUpCode(
      dto,
      authorization,
      request,
    );
  }

  @Post('passkeys/authentication-options')
  createPasskeyAuthenticationOptions(@Req() request: Request) {
    return this.passkeyService.createAuthenticationOptions(request);
  }

  @Post('passkeys/authentication-verification')
  verifyPasskeyAuthentication(
    @Body() dto: PasskeyAuthenticationVerificationDto,
    @Req() request: Request,
  ) {
    return this.passkeyService.verifyAuthentication(dto, request);
  }

  @Get('passkeys')
  listPasskeys(@Headers('authorization') authorization?: string) {
    return this.passkeyService.listPasskeys(authorization);
  }

  @Patch('passkeys/:id')
  renamePasskey(
    @Param('id') id: string,
    @Body() dto: PasskeyRenameDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.passkeyService.renamePasskey(id, dto, authorization);
  }

  @Delete('passkeys/:id')
  deletePasskey(
    @Param('id') id: string,
    @Body() dto: PasskeyDeleteDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.deletePasskey(id, dto, authorization, request);
  }

  @Get('security/methods')
  getAuthenticationMethodStatus(
    @Headers('authorization') authorization?: string,
  ) {
    return this.passkeyService.getAuthenticationMethodStatus(authorization);
  }

  @Post('security/reauth/password')
  reauthenticateWithPassword(
    @Body() dto: PasskeyStepUpPasswordDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.reauthenticateWithPassword(
      dto,
      authorization,
      request,
    );
  }

  @Post('security/reauth/passkey-options')
  createPasskeyStepUpOptions(
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.createPasskeyStepUpOptions(
      authorization,
      request,
    );
  }

  @Post('security/reauth/passkey-verification')
  verifyPasskeyStepUp(
    @Body() dto: PasskeyStepUpVerificationDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.verifyPasskeyStepUp(dto, authorization, request);
  }

  @Post('security/reauth/recovery-code')
  reauthenticateWithRecoveryCode(
    @Body() dto: PasskeyRecoveryCodeDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.reauthenticateWithRecoveryCode(
      dto,
      authorization,
      request,
    );
  }

  @Post('security/recovery-codes')
  generateRecoveryCodes(
    @Body() dto: PasskeyRecoveryCodeGenerateDto,
    @Headers('authorization') authorization?: string,
    @Req() request?: Request,
  ) {
    return this.passkeyService.generateRecoveryCodes(
      dto,
      authorization,
      request,
    );
  }
}
