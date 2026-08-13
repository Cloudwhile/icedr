import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import type { OverviewQuery } from './overview.dto';
import { OverviewService } from './overview.service';

@ApiTags('admin-overview')
@Controller('admin/overview')
export class OverviewController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async getOverview(
    @Headers('authorization') authorization?: string,
    @Query() query: OverviewQuery = {},
  ) {
    await this.adminGuard.requirePermission(authorization, 'settings', 'read');
    return this.overviewService.getOverview(query);
  }
}
