import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get('events')
  async listEvents(
    @Headers('authorization') authorization?: string,
    @Query('workspaceId') workspaceId?: string,
    @Query('shareToken') shareToken?: string,
    @Query('nodeId') nodeId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.adminGuard.requirePermission(authorization, 'audit', 'read');
    return this.auditService.listEvents({
      workspaceId,
      shareToken,
      nodeId,
      action,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
