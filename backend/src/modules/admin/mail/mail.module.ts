import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { SettingsModule } from '../settings/settings.module';
import { MailSettingsController, SetupMailController } from './mail.controller';
import { MailService } from './mail.service';

@Module({
  imports: [AuthCoreModule, SettingsModule],
  controllers: [MailSettingsController, SetupMailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
