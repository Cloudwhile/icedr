import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  bootstrapMeta,
  settingsParentMeta,
} from '../settings/settings.repository';

export const setupRequiredErrorCode = 'SETUP_REQUIRED';

@Injectable()
export class BootstrapStateService {
  constructor(private readonly prisma: PrismaService) {}

  async isCompleted() {
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
      return this.readCompleted(row?.value);
    } catch {
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
