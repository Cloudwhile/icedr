import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkerService {
  constructor(private readonly config: ConfigService) {}

  getCapabilities() {
    const queueConfigured = Boolean(
      this.config.get<boolean>('redis.configured'),
    );
    const storageConfigured = Boolean(
      this.config.get<string>('storage.endpoint'),
    );

    return {
      configured: queueConfigured && storageConfigured,
      tasks:
        queueConfigured && storageConfigured
          ? ['thumbnail', 'scan', 'cleanup']
          : [],
      consumesFrom: 'Redis',
      processesObjectsIn: 'MinIO / S3 / R2',
    };
  }
}
