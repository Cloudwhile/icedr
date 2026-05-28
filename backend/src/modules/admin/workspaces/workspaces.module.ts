import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { WorkspaceShareSettingsRepository } from './workspace-share-settings.repository';
import { WorkspacesRepository } from './workspaces.repository';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    WorkspaceShareSettingsRepository,
    WorkspacesRepository,
  ],
  exports: [
    WorkspacesService,
    WorkspaceShareSettingsRepository,
    WorkspacesRepository,
  ],
})
export class WorkspacesModule {}
