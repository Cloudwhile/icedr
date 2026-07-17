import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAuditEvent } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import {
  Prisma,
  type ShareDownloadIntent,
} from '../../generated/prisma/client';
import {
  matchesShareVisitorFingerprint,
  type ShareVisitorFingerprint,
} from './share-visitor-fingerprint';
import type { ShareDownloadIntentRecord } from './shares.repository';

const serializableTransactionMaxAttempts = 5;

type DownloadStartedMetadataFactory = (
  downloadCount: number,
) => Record<string, unknown> | null;

export type CommitShareDownloadIntentInput = {
  downloadId: string;
  metadataForDownloadCount: DownloadStartedMetadataFactory;
  nodeId: string;
  shareToken: string;
  visitor?: ShareVisitorFingerprint;
};

export type CommitShareDownloadIntentResult =
  | { status: 'committed'; intent: ShareDownloadIntentRecord }
  | { status: 'download-limit-reached' }
  | { status: 'intent-unavailable' }
  | { status: 'share-expired' }
  | { status: 'share-missing' }
  | { status: 'share-revoked' };

@Injectable()
export class ShareDownloadCommitRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async commit(
    input: CommitShareDownloadIntentInput,
  ): Promise<CommitShareDownloadIntentResult> {
    const now = new Date();
    return this.runSerializableTransaction(async (tx) => {
      const share = await tx.shareLink.findUnique({
        where: { token: input.shareToken },
        select: {
          createdAt: true,
          expiresDays: true,
          revokedAt: true,
          workspaceId: true,
        },
      });
      if (!share) return { status: 'share-missing' };
      if (share.revokedAt) return { status: 'share-revoked' };
      const expiresAt =
        share.createdAt.getTime() +
        Math.max(0, Math.trunc(Number(share.expiresDays))) * 86400000;
      if (expiresAt < now.getTime()) return { status: 'share-expired' };

      const intent = await tx.shareDownloadIntent.findUnique({
        where: { id: input.downloadId },
      });
      if (!this.isUsableIntent(intent, input, now)) {
        return { status: 'intent-unavailable' };
      }

      let auditMetadata: Record<string, unknown> | null = null;
      if (intent.purpose === 'download') {
        const downloadCount = await tx.auditEvent.count({
          where: {
            action: 'share.download_started',
            shareToken: input.shareToken,
          },
        });
        auditMetadata = input.metadataForDownloadCount(downloadCount);
        if (!auditMetadata) return { status: 'download-limit-reached' };
      }

      const consumedAt = intent.purpose === 'download' ? now : null;
      const useLimit = this.getUseLimit(intent.purpose);
      const claimed = await tx.shareDownloadIntent.updateMany({
        where: {
          id: intent.id,
          shareToken: input.shareToken,
          nodeId: input.nodeId,
          expiresAt: { gte: now },
          useCount: { lt: useLimit },
          ...(intent.purpose === 'download' ? { consumedAt: null } : {}),
        },
        data: {
          consumedAt: consumedAt ?? undefined,
          useCount: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return { status: 'intent-unavailable' };

      if (auditMetadata) {
        const event = createAuditEvent({
          action: 'share.download_started',
          actor:
            auditMetadata.identityType === 'ica' ||
            typeof auditMetadata.actorUserId === 'string'
              ? 'account'
              : 'visitor',
          target: input.shareToken,
          workspaceId: share.workspaceId,
          shareToken: input.shareToken,
          nodeId:
            typeof auditMetadata.nodeId === 'string'
              ? auditMetadata.nodeId
              : input.nodeId,
          metadata: { source: 'shares-service', ...auditMetadata },
        });
        await tx.auditEvent.create({
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

      return {
        status: 'committed',
        intent: this.mapIntent({
          ...intent,
          consumedAt,
          useCount: intent.useCount + 1,
        }),
      };
    });
  }

  private isUsableIntent(
    intent: ShareDownloadIntent | null,
    input: CommitShareDownloadIntentInput,
    now: Date,
  ): intent is ShareDownloadIntent {
    return Boolean(
      intent &&
      intent.shareToken === input.shareToken &&
      intent.nodeId === input.nodeId &&
      intent.expiresAt.getTime() >= now.getTime() &&
      (intent.purpose === 'download' || intent.purpose === 'preview') &&
      !(intent.purpose === 'download' && intent.consumedAt) &&
      intent.useCount < this.getUseLimit(intent.purpose) &&
      matchesShareVisitorFingerprint(this.config, intent, input.visitor),
    );
  }

  private getUseLimit(purpose: string) {
    return purpose === 'preview' ? 64 : 1;
  }

  private mapIntent(intent: ShareDownloadIntent): ShareDownloadIntentRecord {
    return {
      downloadId: intent.id,
      token: intent.shareToken,
      nodeId: intent.nodeId,
      filename: intent.filename,
      method: intent.method as ShareDownloadIntentRecord['method'],
      purpose: intent.purpose as ShareDownloadIntentRecord['purpose'],
      identityType:
        intent.identityType as ShareDownloadIntentRecord['identityType'],
      ...(intent.email ? { email: intent.email } : {}),
      expiresAt: intent.expiresAt.toISOString(),
      consumedAt: intent.consumedAt ? intent.consumedAt.toISOString() : null,
      useCount: intent.useCount,
    };
  }

  private async runSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !this.isSerializableConflict(error) ||
          attempt >= serializableTransactionMaxAttempts
        ) {
          throw error;
        }
      }
    }
  }

  private isSerializableConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }
}
