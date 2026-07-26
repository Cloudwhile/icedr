import { Injectable } from '@nestjs/common';
import { UpdateWorkspaceShareSettingsDto } from './share-settings.dto';
import { WorkspaceShareSettingsRepository } from './workspace-share-settings.repository';
import { WorkspacesRepository } from './workspaces.repository';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly shareSettingsRepository: WorkspaceShareSettingsRepository,
    private readonly workspacesRepository: WorkspacesRepository,
  ) {}

  listWorkspaces() {
    return this.workspacesRepository.list();
  }

  getShareSettings(workspaceId: string) {
    return this.shareSettingsRepository.get(workspaceId);
  }

  updateShareSettings(
    workspaceId: string,
    dto: UpdateWorkspaceShareSettingsDto,
  ) {
    return this.shareSettingsRepository.upsert(workspaceId, dto);
  }

  validateShareSettings(
    workspaceId: string,
    dto: UpdateWorkspaceShareSettingsDto,
  ) {
    return this.shareSettingsRepository.validateUpdate(workspaceId, dto);
  }
}
