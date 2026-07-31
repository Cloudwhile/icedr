import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthRepository } from '../../modules/auth/core/auth.repository';
import { BootstrapStateService } from '../../modules/admin/setup/bootstrap-state.service';
import {
  canAccessResource,
  formatPermission,
  type PermissionAction,
  type PermissionResource,
} from './permission-policy';
import {
  AUTH_UNAUTHORIZED_CODES,
  createAuthUnauthorizedError,
} from './auth-unauthorized-error';

@Injectable()
export class AdminGuardService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly bootstrapState: BootstrapStateService,
  ) {}

  async requireAdminSession(authorization?: string) {
    return this.requirePermission(authorization, 'settings', 'manage');
  }

  async requirePermission(
    authorization: string | undefined,
    resource: PermissionResource,
    action: PermissionAction,
  ) {
    const session = await this.requireSession(authorization);
    if (action !== 'read') {
      const status = await this.authRepository.getAuthenticationMethodStatus(
        session.user.id,
      );
      if (!status.compliant) {
        throw new ForbiddenException({
          code: 'AUTH_METHOD_POLICY_REQUIRED',
          message:
            'Add another authentication method before continuing this operation',
          methodCount: status.methodCount,
          minimumAuthenticationMethods: status.minimumAuthenticationMethods,
        });
      }
    }
    if (!canAccessResource(session.user.role, resource, action)) {
      throw new ForbiddenException(
        `${formatPermission(resource, action)} permission is required`,
      );
    }
    return session;
  }

  async requireSession(authorization?: string) {
    await this.bootstrapState.requireCompleted();
    const token = this.extractBearerToken(authorization);
    if (!token) {
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.SESSION_REQUIRED,
      );
    }
    const session = await this.authRepository.findSessionByTokenHash(
      this.hashToken(token),
    );
    if (!session) {
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.SESSION_INVALID,
      );
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.authRepository.deleteSessionByTokenHash(session.tokenHash);
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.SESSION_EXPIRED,
      );
    }
    return session;
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) return null;
    const [type, token] = authorization.split(/\s+/, 2);
    if (type?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
