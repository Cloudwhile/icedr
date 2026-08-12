import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import type {
  AuditActor,
  AuditResourceType,
  AuditResult,
  AuditSortBy,
  AuditSortDirection,
} from './audit-events';
import { AuditService } from './audit.service';

type AuditEventsQuery = {
  scope?: 'all' | 'system' | 'workspace';
  workspaceId?: string;
  shareToken?: string;
  nodeId?: string;
  actor?: AuditActor;
  action?: string;
  result?: AuditResult;
  resourceType?: AuditResourceType;
  ipAddress?: string;
  query?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: AuditSortBy;
  sortDirection?: AuditSortDirection;
  limit?: string;
  offset?: string;
};

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
    @Query() query: AuditEventsQuery = {},
  ) {
    await this.adminGuard.requirePermission(authorization, 'audit', 'read');
    return this.auditService.listEvents({
      ...query,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
  }
}
