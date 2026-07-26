import { Global, Module } from '@nestjs/common';
import { BootstrapStateService } from './bootstrap-state.service';

@Global()
@Module({
  providers: [BootstrapStateService],
  exports: [BootstrapStateService],
})
export class BootstrapStateModule {}
