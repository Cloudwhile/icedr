import { Module } from '@nestjs/common';
import { MailModule } from '../../admin/mail/mail.module';
import { SettingsModule } from '../../admin/settings/settings.module';
import { AuthCoreModule } from './auth-core.module';
import { AuthAuditService } from './auth-audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AuthCoreModule, SettingsModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthAuditService],
  exports: [AuthService],
})
export class AuthModule {}
