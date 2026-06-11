import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createRequestAuditMetadata } from '../../../common/security/audit-metadata';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { createAuditEvent } from '../../logs/audit-events';
import type { AuthUserResponse } from './auth.dto';

export type AuthAuditAction =
  | 'auth.login'
  | 'auth.registered'
  | 'auth.password_reset_completed';

export type AuthAuditMethod = 'local' | 'oauth' | 'passkey' | 'setup';

@Injectable()
export class AuthAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSuccess(
    action: AuthAuditAction,
    user: AuthUserResponse,
    options: {
      method: AuthAuditMethod;
      request?: Request;
    },
  ) {
    const event = createAuditEvent({
      action,
      actor: 'account',
      target: 'account',
      metadata: {
        ...createRequestAuditMetadata({ user }, options.request),
        authMethod: options.method,
        result: 'success',
        source: 'auth-service',
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        id: event.id,
        action: event.action,
        actor: event.actor,
        target: event.target,
        workspaceId: event.workspaceId,
        shareToken: event.shareToken,
        nodeId: event.nodeId,
        metadata: event.metadata as Prisma.InputJsonValue,
        createdAt: new Date(event.createdAt),
      },
    });
  }
}
