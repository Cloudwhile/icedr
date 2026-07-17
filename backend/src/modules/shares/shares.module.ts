import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../auth/core/auth-core.module';
import { AuthModule } from '../auth/core/auth.module';
import { FileNodesModule } from '../files/file-nodes.module';
import { MailModule } from '../admin/mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../admin/workspaces/workspaces.module';
import { SharesController } from './shares.controller';
import { ShareAbuseProtectionService } from './share-abuse-protection.service';
import { ShareDownloadCommitRepository } from './share-download-commit.repository';
import { ShareRateLimitRepository } from './share-rate-limit.repository';
import { SharesRepository } from './shares.repository';
import { SharesService } from './shares.service';

@Module({
  imports: [
    AuthCoreModule,
    AuthModule,
    FileNodesModule,
    MailModule,
    StorageModule,
    WorkspacesModule,
  ],
  controllers: [SharesController],
  providers: [
    ShareAbuseProtectionService,
    ShareDownloadCommitRepository,
    ShareRateLimitRepository,
    SharesRepository,
    SharesService,
  ],
})
export class SharesModule {}
