import { Body, Controller, Get, Headers, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { UpdateWorkspaceShareSettingsDto } from './share-settings.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  listWorkspaces() {
    return this.workspacesService.listWorkspaces();
  }

  @Get(':workspaceId/share-settings')
  getShareSettings(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.getShareSettings(workspaceId);
  }

  @Patch(':workspaceId/share-settings')
  async updateShareSettings(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceShareSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requireAdminSession(authorization);
    return this.workspacesService.updateShareSettings(workspaceId, dto);
  }
}
