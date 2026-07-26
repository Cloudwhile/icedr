import { Module } from '@nestjs/common';
import { SetupAuthorizationService } from './setup-authorization.service';

@Module({
  providers: [SetupAuthorizationService],
  exports: [SetupAuthorizationService],
})
export class SetupAuthorizationModule {}
