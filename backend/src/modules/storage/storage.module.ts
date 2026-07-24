import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../auth/core/auth-core.module';
import { StorageController } from './storage.controller';
import { StorageObjectService } from './storage-object.service';
import { StorageReconcileRunner } from './storage-reconcile-runner.service';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { StorageSettingsUsageService } from './storage-settings-usage.service';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [StorageController],
  providers: [
    StorageReconcileRepository,
    StorageReconcileRunner,
    StorageObjectService,
    StorageSettingsRepository,
    StorageSettingsUsageService,
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
