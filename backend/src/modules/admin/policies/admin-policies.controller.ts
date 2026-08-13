import { Body, Controller, Headers, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import {
  UpdateAdminAuthPolicyDto,
  UpdateAdminStoragePolicyDto,
} from './admin-policies.dto';
import { AdminPoliciesService } from './admin-policies.service';

@ApiTags('admin')
@Controller('admin')
export class AdminPoliciesController {
  constructor(
    private readonly policies: AdminPoliciesService,
    private readonly adminGuard: AdminGuardService,
  ) {}

  @Put('storage-policy')
  async updateStoragePolicy(
    @Body() dto: UpdateAdminStoragePolicyDto,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requirePermission(
      authorization,
      'storage',
      'manage',
    );
    return this.policies.updateStoragePolicy(dto, session.user.id);
  }

  @Put('auth-policy')
  async updateAuthPolicy(
    @Body() dto: UpdateAdminAuthPolicyDto,
    @Headers('authorization') authorization?: string,
  ) {
    const session = await this.adminGuard.requireAdminSession(authorization);
    return this.policies.updateAuthPolicy(dto, session.user.id);
  }
}
