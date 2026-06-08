import { Controller, Get, Headers } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from './common/security/admin-guard.service';
import { AppService } from './app.service';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Get()
  getServiceIndex() {
    return this.appService.getServiceIndex();
  }

  @Get('system/overview')
  async getSystemOverview(@Headers('authorization') authorization?: string) {
    await this.adminGuard.requirePermission(authorization, 'settings', 'read');
    return this.appService.getSystemOverview();
  }
}
