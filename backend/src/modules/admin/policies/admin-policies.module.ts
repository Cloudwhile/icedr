import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { AuthModule } from '../../auth/core/auth.module';
import { StorageModule } from '../../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminPoliciesController } from './admin-policies.controller';
import { AdminPoliciesService } from './admin-policies.service';

@Module({
  imports: [AuthCoreModule, AuthModule, SettingsModule, StorageModule],
  controllers: [AdminPoliciesController],
  providers: [AdminPoliciesService],
})
export class AdminPoliciesModule {}
