import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import {
  UpdateOAuthSettingsDto,
  UpdatePasskeySettingsDto,
  UpdateSiteSettingsDto,
  UpsertTranslationBundleDto,
  VerifyDatabaseDto,
} from './settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('site')
@Controller('site/settings')
export class SiteSettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get('public')
  getPublicSettings() {
    return this.settingsService.getPublicSiteSettings();
  }

  @Get('public/translations')
  getPublicTranslations() {
    return this.settingsService.getTranslationSettings();
  }

  @Get()
  async getSettings(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.getAdminSettings();
  }

  @Patch()
  async updateSettings(
    @Body() dto: UpdateSiteSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.updateSiteSettings(dto);
  }

  @Get('translations')
  async getTranslations(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.getTranslationSettings();
  }

  @Post('translations')
  async upsertTranslation(
    @Body() dto: UpsertTranslationBundleDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.upsertTranslationBundle(dto);
  }
}

@ApiTags('setup')
@Controller('setup')
export class SetupController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('status')
  getStatus() {
    return this.settingsService.getSetupStatus();
  }

  @Post('verify-database')
  verifyDatabase(@Body() dto: VerifyDatabaseDto) {
    void dto;
    return this.settingsService.verifyDatabase();
  }
}

@ApiTags('identity')
@Controller('identity/oauth/settings')
export class OAuthSettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async getSettings(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.toOAuthResponse(
      await this.settingsService.getOAuthSettings(),
    );
  }

  @Patch()
  async updateSettings(
    @Body() dto: UpdateOAuthSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.updateOAuthSettings(dto);
  }
}

@ApiTags('auth')
@Controller('auth/passkeys/settings')
export class PasskeySettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async getSettings(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.getPasskeySettings();
  }

  @Patch()
  async updateSettings(
    @Body() dto: UpdatePasskeySettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.settingsService.updatePasskeySettings(dto);
  }
}
