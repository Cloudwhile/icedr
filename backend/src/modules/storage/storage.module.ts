import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../auth/core/auth-core.module';
import { StorageController } from './storage.controller';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [StorageController],
  providers: [
    StorageReconcileRepository,
    StorageSettingsRepository,
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
