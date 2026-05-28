import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import {
  OAuthSettingsController,
  PasskeySettingsController,
  SetupController,
  SiteSettingsController,
} from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [
    SiteSettingsController,
    SetupController,
    OAuthSettingsController,
    PasskeySettingsController,
  ],
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
