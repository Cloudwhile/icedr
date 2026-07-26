import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CompleteSetupDto } from '../settings/settings.dto';
import {
  setupTokenHeader,
  SetupAuthorizationService,
} from './setup-authorization.service';
import { SetupRateLimitService } from './setup-rate-limit.service';
import { SetupService } from './setup.service';

@ApiTags('setup')
@Controller('setup')
export class SetupCompleteController {
  constructor(
    private readonly setupService: SetupService,
    private readonly setupAuthorization: SetupAuthorizationService,
    private readonly setupRateLimit: SetupRateLimitService,
  ) {}

  @Post('complete')
  async complete(
    @Body() dto: CompleteSetupDto,
    @Req() request: Request,
    @Headers(setupTokenHeader) setupToken?: string,
  ) {
    await this.setupRateLimit.assertAllowed(request);
    this.setupAuthorization.requireToken(setupToken);
    return this.setupService.complete(dto, request);
  }
}
