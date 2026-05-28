import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QueueService {
  constructor(private readonly config: ConfigService) {}

  getProfile() {
    const configured = Boolean(this.config.get<boolean>('redis.configured'));
    return {
      provider: 'Redis',
      configured,
      connectionConfigured: configured,
      queues: configured ? ['thumbnail', 'scan', 'cleanup'] : [],
    };
  }
}
