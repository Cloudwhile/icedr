import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { StorageModule } from '../../storage/storage.module';
import { StorageIntegrityController } from './storage-integrity.controller';

@Module({
  imports: [AuthCoreModule, StorageModule],
  controllers: [StorageIntegrityController],
})
export class StorageIntegrityModule {}
