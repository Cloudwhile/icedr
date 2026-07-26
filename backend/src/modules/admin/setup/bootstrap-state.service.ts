import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  bootstrapMeta,
  settingsParentMeta,
} from '../settings/settings.repository';

export const setupRequiredErrorCode = 'SETUP_REQUIRED';

@Injectable()
export class BootstrapStateService {
  private readonly logger = new Logger(BootstrapStateService.name);
  private completed = false;

  constructor(private readonly prisma: PrismaService) {}

  async isCompleted() {
    if (this.completed) {
      return true;
    }

    try {
      const row = await this.prisma.setting.findUnique({
        where: {
          parentMeta_meta: {
            parentMeta: settingsParentMeta,
            meta: bootstrapMeta,
          },
        },
        select: { value: true },
      });
      this.completed = this.readCompleted(row?.value);
      return this.completed;
    } catch (error) {
      this.logger.warn(
        'Bootstrap completion lookup failed; treating setup as incomplete',
        error,
      );
      return false;
    }
  }

  async requireCompleted() {
    if (!(await this.isCompleted())) {
      throw new ServiceUnavailableException({
        code: setupRequiredErrorCode,
        message:
          'Initial setup must be completed before this operation is available',
      });
    }
  }

  private readCompleted(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    return (value as Record<string, unknown>).completed === true;
  }
}
