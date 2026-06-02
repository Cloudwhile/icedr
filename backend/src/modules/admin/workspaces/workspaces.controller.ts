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
  async listWorkspaces(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requirePermission(authorization, 'workspace', 'read');
    return this.workspacesService.listWorkspaces();
  }

  @Get(':workspaceId/share-settings')
  async getShareSettings(
    @Param('workspaceId') workspaceId: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'share', 'read');
    return this.workspacesService.getShareSettings(workspaceId);
  }

  @Patch(':workspaceId/share-settings')
  async updateShareSettings(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceShareSettingsDto,
    @Headers('authorization') authorization?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'share', 'manage');
    return this.workspacesService.updateShareSettings(workspaceId, dto);
  }
}
