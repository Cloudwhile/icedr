import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkerService } from './worker.service';

@ApiTags('worker')
@Controller('worker')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Get('capabilities')
  getCapabilities() {
    return this.workerService.getCapabilities();
  }
}
