import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CompleteSetupDto } from '../settings/settings.dto';
import { SetupService } from './setup.service';

@ApiTags('setup')
@Controller('setup')
export class SetupCompleteController {
  constructor(private readonly setupService: SetupService) {}

  @Post('complete')
  complete(@Body() dto: CompleteSetupDto, @Req() request: Request) {
    return this.setupService.complete(dto, request);
  }
}
