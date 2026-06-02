import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TransfersModule } from '../downloads/transfers/transfers.module';
import { FileNodesController } from './file-nodes.controller';
import { FileNodesRepository } from './file-nodes.repository';
import { FileNodesService } from './file-nodes.service';
import { UploadSessionsRepository } from './upload-sessions.repository';

@Module({
  imports: [StorageModule, TransfersModule],
  controllers: [FileNodesController],
  providers: [FileNodesRepository, UploadSessionsRepository, FileNodesService],
  exports: [FileNodesService],
})
export class FileNodesModule {}
