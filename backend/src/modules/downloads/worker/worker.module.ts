import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';

@Module({
  imports: [QueueModule],
  controllers: [WorkerController],
  providers: [WorkerService],
})
export class WorkerModule {}
