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
import { ShareDownloadIntentRepository } from './share-download-intent.repository';
import { ShareDownloadService } from './share-download.service';
import { ShareContentRepository } from './share-content.repository';
import { ShareContentService } from './share-content.service';
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
    ShareContentRepository,
    ShareContentService,
    ShareDownloadCommitRepository,
    ShareDownloadIntentRepository,
    ShareDownloadService,
    ShareRateLimitRepository,
    SharesRepository,
    SharesService,
  ],
})
export class SharesModule {}
