import type { ConfigService } from '@nestjs/config';

type ConfigReader = Pick<ConfigService, 'get'>;

export function resolveShareVisitorHashSecret(config: ConfigReader) {
  const secret = config.get<string>('share.visitorHashSecret')?.trim();
  if (!secret) {
    throw new Error('share.visitorHashSecret is not configured');
  }
  return secret;
}
