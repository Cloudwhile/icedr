import { Module } from '@nestjs/common';
import { AuditModule } from '../../logs/audit.module';
import { DatabaseModule } from '../../../database/database.module';
import { IdentityModule } from '../../auth/identity/identity.module';
import { QueueModule } from '../../downloads/queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    DatabaseModule,
    IdentityModule,
    StorageModule,
    QueueModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
