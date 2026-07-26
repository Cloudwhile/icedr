import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import {
  TestMailSettingsDto,
  UpdateMailSettingsDto,
} from '../settings/settings.dto';
import { SettingsService } from '../settings/settings.service';
import {
  setupTokenHeader,
  SetupAuthorizationService,
} from '../setup/setup-authorization.service';
import { MailService } from './mail.service';

@ApiTags('mail')
@Controller('mail/settings')
export class MailSettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async getSettings(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.toMailResponse(
      await this.settingsService.getMailSettings(),
    );
  }

  @Patch()
  async updateSettings(
    @Body() dto: UpdateMailSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.updateMailSettings(dto);
  }

  @Post('test')
  async testSettings(
    @Body() dto: TestMailSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.mailService.sendTestMessage(dto.recipientEmail);
  }
}

@ApiTags('setup')
@Controller('setup/mail')
export class SetupMailController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
    private readonly setupAuthorization: SetupAuthorizationService,
  ) {}

  @Get()
  async getSettings(@Headers(setupTokenHeader) setupToken?: string) {
    this.setupAuthorization.requireToken(setupToken);
    await this.settingsService.assertSetupOpen();
    return this.settingsService.toMailResponse(
      await this.settingsService.getMailSettings(),
    );
  }

  @Patch()
  async updateSettings(
    @Body() dto: UpdateMailSettingsDto,
    @Headers(setupTokenHeader) setupToken?: string,
  ) {
    this.setupAuthorization.requireToken(setupToken);
    await this.settingsService.assertSetupOpen();
    return this.settingsService.updateMailSettings(dto);
  }

  @Post('test')
  async testSettings(
    @Body() dto: TestMailSettingsDto,
    @Headers(setupTokenHeader) setupToken?: string,
  ) {
    this.setupAuthorization.requireToken(setupToken);
    await this.settingsService.assertSetupOpen();
    return this.mailService.sendTestMessage(dto.recipientEmail);
  }
}
