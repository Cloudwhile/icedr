import { createHash, timingSafeEqual } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SetupAccessState } from '../settings/settings.dto';

export const setupTokenHeader = 'x-setup-token';
export const setupAuthorizationErrorCode = {
  invalid: 'SETUP_BOOTSTRAP_INVALID',
  required: 'SETUP_BOOTSTRAP_REQUIRED',
  unavailable: 'SETUP_BOOTSTRAP_UNAVAILABLE',
} as const;

@Injectable()
export class SetupAuthorizationService {
  constructor(private readonly config: ConfigService) {}

  requireToken(candidate?: string) {
    const configuredToken = this.readConfiguredToken();
    this.assertCandidate(candidate, configuredToken);
  }

  inspectToken(candidate?: string): SetupAccessState {
    const configuredToken = this.readConfiguredToken(false);
    if (!configuredToken) {
      return { authorized: false, configured: false };
    }
    if (!candidate) {
      return { authorized: false, configured: true };
    }
    return {
      authorized: this.matchesToken(candidate, configuredToken),
      configured: true,
    };
  }

  private readConfiguredToken(): string;
  private readConfiguredToken(required: true): string;
  private readConfiguredToken(required: false): string | null;
  private readConfiguredToken(required = true) {
    const token = this.config.get<string>('setup.bootstrapToken')?.trim();
    if (!token) {
      if (!required) return null;
      throw new ServiceUnavailableException({
        code: setupAuthorizationErrorCode.unavailable,
        message: 'Setup bootstrap token is not configured',
      });
    }
    if (Buffer.byteLength(token, 'utf8') < 32) {
      if (!required) return null;
      throw new ServiceUnavailableException({
        code: setupAuthorizationErrorCode.unavailable,
        message: 'Setup bootstrap token must contain at least 32 bytes',
      });
    }
    return token;
  }

  private assertCandidate(
    candidate: string | undefined,
    configuredToken: string,
  ) {
    if (!candidate) {
      throw new UnauthorizedException({
        code: setupAuthorizationErrorCode.required,
        message: 'Setup bootstrap token is required',
      });
    }
    if (!this.matchesToken(candidate, configuredToken)) {
      throw new ForbiddenException({
        code: setupAuthorizationErrorCode.invalid,
        message: 'Setup bootstrap token is invalid',
      });
    }
  }

  private matchesToken(candidate: string, configuredToken: string) {
    return timingSafeEqual(
      this.hashToken(candidate),
      this.hashToken(configuredToken),
    );
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest();
  }
}
