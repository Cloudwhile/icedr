import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthRepository } from '../../modules/auth/core/auth.repository';

@Injectable()
export class AdminGuardService {
  constructor(private readonly authRepository: AuthRepository) {}

  async requireAdminSession(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (!token) throw new UnauthorizedException('Authentication is required');
    const session = await this.authRepository.findSessionByTokenHash(
      this.hashToken(token),
    );
    if (!session) throw new UnauthorizedException('Session is invalid');
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.authRepository.deleteSessionByTokenHash(session.tokenHash);
      throw new UnauthorizedException('Session has expired');
    }
    if (session.user.role !== 'admin') {
      throw new ForbiddenException('Administrator access is required');
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
