import { Module } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { AdminGuardService } from '../../../common/security/admin-guard.service';

@Module({
  providers: [AuthRepository, AdminGuardService],
  exports: [AuthRepository, AdminGuardService],
})
export class AuthCoreModule {}
