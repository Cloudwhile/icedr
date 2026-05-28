import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [TransfersController],
  providers: [TransfersRepository, TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
