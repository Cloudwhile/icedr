import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../auth/core/auth-core.module';
import { StorageController } from './storage.controller';
import { StorageObjectService } from './storage-object.service';
import { StorageReconcileRunner } from './storage-reconcile-runner.service';
import { StorageReconcileRepository } from './storage-reconcile.repository';
import { StorageSettingsUsageService } from './storage-settings-usage.service';
import { StorageSettingsRepository } from './storage-settings.repository';
import { StorageService } from './storage.service';
import { StorageIntegrityService } from './storage-integrity.service';
import { StorageIntegrityTaskRepository } from './storage-integrity-task.repository';
import { StorageIntegrityTaskRunner } from './storage-integrity-task-runner.service';
import { StorageIntegrityTaskService } from './storage-integrity-task.service';
import { StorageIntegrityAcknowledgementRepository } from './storage-integrity-acknowledgement.repository';
import { StorageIntegrityAcknowledgementService } from './storage-integrity-acknowledgement.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [StorageController],
  providers: [
    StorageReconcileRepository,
    StorageReconcileRunner,
    StorageObjectService,
    StorageIntegrityService,
    StorageIntegrityAcknowledgementRepository,
    StorageIntegrityAcknowledgementService,
    StorageIntegrityTaskRepository,
    StorageIntegrityTaskRunner,
    StorageIntegrityTaskService,
    StorageSettingsRepository,
    StorageSettingsUsageService,
    StorageService,
  ],
  exports: [
    StorageIntegrityService,
    StorageIntegrityAcknowledgementService,
    StorageIntegrityTaskService,
    StorageService,
  ],
})
export class StorageModule {}
