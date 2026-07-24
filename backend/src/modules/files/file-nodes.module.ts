import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../auth/core/auth-core.module';
import { StorageModule } from '../storage/storage.module';
import { TransfersModule } from '../downloads/transfers/transfers.module';
import { FileNodesController } from './file-nodes.controller';
import { FileDownloadIntentsRepository } from './file-download-intents.repository';
import { FileDownloadPreviewService } from './file-download-preview.service';
import { FileNodeVersionsRepository } from './file-node-versions.repository';
import { FileNodesRepository } from './file-nodes.repository';
import { FilePreviewArtifactsRepository } from './file-preview-artifacts.repository';
import { FileNodesService } from './file-nodes.service';
import { FileStorageUsageRepository } from './file-storage-usage.repository';
import { FileUploadPolicyService } from './file-upload-policy.service';
import { FileUploadService } from './file-upload.service';
import { UploadSessionsRepository } from './upload-sessions.repository';

@Module({
  imports: [AuthCoreModule, StorageModule, TransfersModule],
  controllers: [FileNodesController],
  providers: [
    FileDownloadIntentsRepository,
    FileNodeVersionsRepository,
    FilePreviewArtifactsRepository,
    FileStorageUsageRepository,
    FileNodesRepository,
    UploadSessionsRepository,
    FileUploadPolicyService,
    FileUploadService,
    FileDownloadPreviewService,
    FileNodesService,
  ],
  exports: [FileNodesService],
})
export class FileNodesModule {}
