import { Controller, Get, Headers } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { HealthService } from './health.service';

@ApiTags('admin-health')
@Controller('admin/health')
export class AdminHealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  async getAdminHealth(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requirePermission(authorization, 'settings', 'read');
    return this.healthService.getAdminHealth();
  }
}
