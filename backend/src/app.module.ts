import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './modules/logs/audit.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthCoreModule } from './modules/auth/core/auth-core.module';
import { AuthModule } from './modules/auth/core/auth.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { FileNodesModule } from './modules/files/file-nodes.module';
import { HealthModule } from './modules/admin/health/health.module';
import { IdentityModule } from './modules/auth/identity/identity.module';
import { MailModule } from './modules/admin/mail/mail.module';
import { QueueModule } from './modules/downloads/queue/queue.module';
import { SharesModule } from './modules/shares/shares.module';
import { SettingsModule } from './modules/admin/settings/settings.module';
import { SetupModule } from './modules/admin/setup/setup.module';
import { BootstrapStateModule } from './modules/admin/setup/bootstrap-state.module';
import { StorageModule } from './modules/storage/storage.module';
import { TransfersModule } from './modules/downloads/transfers/transfers.module';
import { WorkerModule } from './modules/downloads/worker/worker.module';
import { WorkspacesModule } from './modules/admin/workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env', '../.env'],
    }),
    DatabaseModule,
    BootstrapStateModule,
    AuthCoreModule,
    SettingsModule,
    SetupModule,
    MailModule,
    IdentityModule,
    AuthModule,
    WorkspacesModule,
    FileNodesModule,
    SharesModule,
    AuditModule,
    StorageModule,
    TransfersModule,
    QueueModule,
    WorkerModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
