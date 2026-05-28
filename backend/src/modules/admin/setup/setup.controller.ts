import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompleteSetupDto } from '../settings/settings.dto';
import { SetupService } from './setup.service';

@ApiTags('setup')
@Controller('setup')
export class SetupCompleteController {
  constructor(private readonly setupService: SetupService) {}

  @Post('complete')
  complete(@Body() dto: CompleteSetupDto) {
    return this.setupService.complete(dto);
  }
}
