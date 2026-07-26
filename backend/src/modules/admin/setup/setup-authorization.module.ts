import { Module } from '@nestjs/common';
import { SetupAuthorizationService } from './setup-authorization.service';
import { SetupOperationService } from './setup-operation.service';

@Module({
  providers: [SetupAuthorizationService, SetupOperationService],
  exports: [SetupAuthorizationService, SetupOperationService],
})
export class SetupAuthorizationModule {}
