import { Module } from '@nestjs/common';
import { AuditModule } from '../../logs/audit.module';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { IdentityModule } from '../../auth/identity/identity.module';
import { QueueModule } from '../../downloads/queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { MailModule } from '../mail/mail.module';
import { AdminHealthController } from './admin-health.controller';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    AuthCoreModule,
    IdentityModule,
    StorageModule,
    QueueModule,
    AuditModule,
    SettingsModule,
    MailModule,
  ],
  controllers: [HealthController, AdminHealthController],
  providers: [HealthService],
})
export class HealthModule {}
