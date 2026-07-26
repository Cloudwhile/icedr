import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/core/auth.module';
import { MailModule } from '../mail/mail.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SetupCompleteController } from './setup.controller';
import { SetupAuthorizationModule } from './setup-authorization.module';
import { SetupRateLimitService } from './setup-rate-limit.service';
import { SetupService } from './setup.service';

@Module({
  imports: [
    AuthModule,
    MailModule,
    SettingsModule,
    SetupAuthorizationModule,
    StorageModule,
    WorkspacesModule,
  ],
  controllers: [SetupCompleteController],
  providers: [SetupRateLimitService, SetupService],
})
export class SetupModule {}
