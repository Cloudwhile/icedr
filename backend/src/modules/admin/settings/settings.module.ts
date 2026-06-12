import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { StorageModule } from '../../storage/storage.module';
import {
  OAuthSettingsController,
  PasskeySettingsController,
  SetupController,
  SiteSettingsController,
} from './settings.controller';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthCoreModule, StorageModule],
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
