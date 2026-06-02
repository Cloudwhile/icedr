import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { QueueService } from '../../downloads/queue/queue.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  async getHealth() {
    const databaseReachable = await this.checkDatabase();
    const storageConfigured = await this.storage.configured();
    const queueProfile = this.queue.getProfile();
    const production = Boolean(this.config.get<boolean>('app.production'));
    const ok =
      databaseReachable &&
      storageConfigured &&
      (!production || queueProfile.configured);

    return {
      status: ok ? 'ok' : 'degraded',
      service: 'icedr-api',
      env: this.config.get<string>('app.env'),
      dependencies: {
        identity: Boolean(this.config.get<string>('identity.issuerUrl')),
        database: {
          configured: true,
          reachable: databaseReachable,
        },
        redis: {
          configured: queueProfile.configured,
        },
        storage: {
          configured: storageConfigured,
          endpoint: Boolean(this.config.get<string>('storage.endpoint')),
          bucket: Boolean(this.config.get<string>('storage.bucket')),
        },
      },
    };
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`select 1`;
      return true;
    } catch {
      return false;
    }
  }
}
