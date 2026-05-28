import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('events')
  listEvents(
    @Query('workspaceId') workspaceId?: string,
    @Query('shareToken') shareToken?: string,
    @Query('nodeId') nodeId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.listEvents({
      workspaceId,
      shareToken,
      nodeId,
      action,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
