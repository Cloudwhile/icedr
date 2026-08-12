import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { AuditModule } from '../../logs/audit.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [AuthCoreModule, AuditModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
