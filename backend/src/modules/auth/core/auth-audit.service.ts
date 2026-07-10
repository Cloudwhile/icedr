import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createRequestAuditMetadata } from '../../../common/security/audit-metadata';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { createAuditEvent } from '../../logs/audit-events';
import type { AuthUserResponse } from './auth.dto';

export type AuthAuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.registered'
  | 'auth.password_reset_completed'
  | 'auth.passkey_added'
  | 'auth.passkey_removed'
  | 'auth.passkey_renamed'
  | 'auth.reauthentication_succeeded'
  | 'auth.reauthentication_failed'
  | 'auth.recovery_codes_generated'
  | 'auth.recovery_code_used'
  | 'auth.method_policy_blocked';

export type AuthAuditMethod =
  | 'local'
  | 'oauth'
  | 'passkey'
  | 'recovery'
  | 'setup';

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
    return this.record(action, user, {
      ...options,
      result: 'success',
    });
  }

  async record(
    action: AuthAuditAction,
    user: AuthUserResponse | null,
    options: {
      method: AuthAuditMethod;
      result: 'failure' | 'success';
      request?: Request;
      metadata?: Record<string, unknown>;
      target?: string;
    },
  ) {
    const event = createAuditEvent({
      action,
      actor: user ? 'account' : 'visitor',
      target: options.target ?? 'account',
      metadata: {
        ...createRequestAuditMetadata(user ? { user } : null, options.request),
        authMethod: options.method,
        result: options.result,
        source: 'auth-service',
        ...(options.metadata ?? {}),
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
