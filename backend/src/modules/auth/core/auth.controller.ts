import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  LoginDto,
  OAuthCallbackDto,
  OAuthExchangeDto,
  PasskeyAuthenticationOptionsDto,
  PasskeyAuthenticationVerificationDto,
  PasskeyRegistrationVerificationDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PasswordResetVerifyDto,
  RegisterDto,
  UpdateAuthSettingsDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    return this.authService.logout(authorization);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    return this.authService.getCurrentUser(authorization);
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
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.confirmPasswordReset(dto);
  }

  @Get('oauth/start')
  startOAuth() {
    return this.authService.startOAuthLogin();
  }

  @Get('oauth/callback')
  async oauthCallback(@Req() request: Request, @Res() response: Response) {
    const result = await this.authService.handleOAuthCallback(
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    );
    if (result.flow === 'share') {
      response.redirect(302, '/');
      return;
    }
    const target = this.authService.buildOAuthFrontendCallbackUrl(result.code);
    response.redirect(302, target);
  }

  @Post('oauth/callback')
  completeFrontendOAuthCallback(@Body() dto: OAuthCallbackDto) {
    return this.authService.completeFrontendOAuthCallback(dto.callbackUrl);
  }

  @Post('oauth/exchange')
  exchangeOAuth(@Body() dto: OAuthExchangeDto) {
    return this.authService.exchangeOAuthCode(dto);
  }

  @Post('passkeys/registration-options')
  createPasskeyRegistrationOptions(
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.createPasskeyRegistrationOptions(authorization);
  }

  @Post('passkeys/registration-verification')
  verifyPasskeyRegistration(
    @Body() dto: PasskeyRegistrationVerificationDto,
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.verifyPasskeyRegistration(dto, authorization);
  }

  @Post('passkeys/authentication-options')
  createPasskeyAuthenticationOptions(
    @Body() dto: PasskeyAuthenticationOptionsDto,
  ) {
    return this.authService.createPasskeyAuthenticationOptions(dto);
  }

  @Post('passkeys/authentication-verification')
  verifyPasskeyAuthentication(
    @Body() dto: PasskeyAuthenticationVerificationDto,
  ) {
    return this.authService.verifyPasskeyAuthentication(dto);
  }

  @Get('passkeys')
  listPasskeys(@Headers('authorization') authorization?: string) {
    return this.authService.listPasskeys(authorization);
  }

  @Delete('passkeys/:id')
  deletePasskey(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.authService.deletePasskey(id, authorization);
  }
}
