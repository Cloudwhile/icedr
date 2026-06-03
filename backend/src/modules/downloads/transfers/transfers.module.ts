import { Module } from '@nestjs/common';
import { AuthCoreModule } from '../../auth/core/auth-core.module';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransfersService } from './transfers.service';

@Module({
  imports: [AuthCoreModule],
  controllers: [TransfersController],
  providers: [TransfersRepository, TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
