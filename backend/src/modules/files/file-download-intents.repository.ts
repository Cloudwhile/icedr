import { createHmac, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAuditEvent, type AuditActor } from '../logs/audit-events';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type FileDownloadIntent } from '../../generated/prisma/client';
import { resolveShareVisitorHashSecret } from '../../common/security/share-visitor-hash-secret';
import {
  createTransferTaskLifecycle,
  type TransferTaskFailureCode,
} from '../../common/transfers/transfer-task-state';
import type {
  DownloadIntentPurpose,
  DownloadIntentResponse,
} from './file-nodes.dto';

const downloadIntentClaimLeaseMs = 30 * 1000;

type DownloadIntentLookup = {
  downloadId: string;
  nodeId: string;
  versionId?: string | null;
  visitor?: { ip?: string; userAgent?: string };
};

type DownloadIntentAudit = {
  action: 'file.download_started' | 'file.version_downloaded';
  metadata?: Record<string, unknown>;
  nodeId: string;
  target: string;
  workspaceId: string;
};

@Injectable()
export class FileDownloadIntentsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createDownloadIntent(input: {
    actorUserId?: string | null;
    auditMetadata?: Record<string, unknown>;
    filename: string;
    method: DownloadIntentResponse['method'];
    nodeId: string;
    purpose: DownloadIntentPurpose;
    versionId?: string | null;
    visitor?: { ip?: string; userAgent?: string };
  }) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const id = `fdl_${randomBytes(12).toString('base64url')}`;
    const row = await this.prisma.fileDownloadIntent.create({
      data: {
        id,
        nodeId: input.nodeId,
        actorUserId: input.actorUserId ?? null,
        versionId: input.versionId ?? null,
        filename: input.filename,
        method: input.method,
        purpose: input.purpose,
        claimToken: null,
        claimedAt: null,
        failureCode: null,
        auditMetadata: (input.auditMetadata ?? {}) as Prisma.InputJsonValue,
        expiresAt: new Date(expiresAt),
        requestIpHash: this.hashVisitorValue(input.visitor?.ip),
        userAgentHash: this.hashVisitorValue(input.visitor?.userAgent),
        updatedAt: now,
      },
    });
    return this.mapDownloadIntent(row);
  }

  async findAvailableDownloadIntent(input: DownloadIntentLookup) {
    const row = await this.findAvailableDownloadIntentRow(input, new Date());
    return row ? this.mapDownloadIntent(row) : null;
  }

  async claimDownloadIntent(input: DownloadIntentLookup) {
    const now = new Date();
    const row = await this.findAvailableDownloadIntentRow(input, now);
    if (!row) return null;
    const claimToken = `fdlc_${randomBytes(18).toString('base64url')}`;
    const claimedRows =
      await this.prisma.fileDownloadIntent.updateManyAndReturn({
        where: {
          id: row.id,
          claimToken: row.claimToken,
          claimedAt: row.claimedAt,
          consumedAt: null,
          expiresAt: { gt: now },
          failureCode: row.failureCode,
          updatedAt: row.updatedAt,
          useCount: row.useCount,
        },
        data: {
          claimedAt: now,
          claimToken,
          failureCode: null,
          updatedAt: now,
        },
      });
    const claimedRow = claimedRows[0];
    if (!claimedRow) return null;
    return {
      claimToken,
      intent: this.mapDownloadIntent(claimedRow),
    };
  }

  async commitDownloadIntent(input: {
    audit?: DownloadIntentAudit;
    claimToken: string;
    downloadId: string;
    purpose: DownloadIntentPurpose;
  }) {
    const commit = async (
      client: Pick<
        Prisma.TransactionClient,
        'auditEvent' | 'fileDownloadIntent'
      >,
    ) => {
      const now = new Date();
      const committedRows = await client.fileDownloadIntent.updateManyAndReturn(
        {
          where: {
            id: input.downloadId,
            claimToken: input.claimToken,
            consumedAt: null,
            expiresAt: { gt: now },
            purpose: input.purpose,
            useCount: {
              lt: this.getDownloadIntentUseLimit(input.purpose),
            },
          },
          data: {
            claimToken: null,
            claimedAt: null,
            consumedAt: input.purpose === 'download' ? now : undefined,
            failureCode: null,
            updatedAt: now,
            useCount: { increment: 1 },
          },
        },
      );
      const committedRow = committedRows[0];
      if (!committedRow) return null;
      if (input.audit) {
        const event = createAuditEvent({
          action: input.audit.action,
          actor: this.resolveAuditActor(input.audit.metadata),
          target: input.audit.target,
          workspaceId: input.audit.workspaceId,
          nodeId: input.audit.nodeId,
          metadata: {
            source: 'file-nodes-service',
            ...input.audit.metadata,
          },
        });
        await client.auditEvent.create({
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
      return this.mapDownloadIntent(committedRow);
    };
    return input.audit
      ? this.prisma.$transaction((tx) => commit(tx))
      : commit(this.prisma);
  }

  async failDownloadIntent(input: {
    claimToken: string;
    downloadId: string;
    failureCode?: Extract<TransferTaskFailureCode, 'DOWNLOAD_FAILED'>;
  }) {
    const now = new Date();
    const result = await this.prisma.fileDownloadIntent.updateMany({
      where: {
        id: input.downloadId,
        claimToken: input.claimToken,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        claimToken: null,
        claimedAt: null,
        failureCode: input.failureCode ?? 'DOWNLOAD_FAILED',
        updatedAt: now,
      },
    });
    return result.count === 1;
  }

  private async findAvailableDownloadIntentRow(
    input: DownloadIntentLookup,
    now: Date,
  ) {
    const row = await this.prisma.fileDownloadIntent.findUnique({
      where: { id: input.downloadId },
    });
    if (!row) return null;
    const purpose = row.purpose as DownloadIntentPurpose;
    const claimLeaseCutoff = now.getTime() - downloadIntentClaimLeaseMs;
    const hasActiveClaim =
      Boolean(row.claimToken) &&
      (row.claimedAt?.getTime() ?? Number.NEGATIVE_INFINITY) > claimLeaseCutoff;
    if (
      row.nodeId !== input.nodeId ||
      row.versionId !== (input.versionId ?? null) ||
      row.expiresAt.getTime() <= now.getTime() ||
      row.consumedAt !== null ||
      (purpose !== 'download' && purpose !== 'preview') ||
      row.useCount >= this.getDownloadIntentUseLimit(purpose) ||
      hasActiveClaim ||
      !this.matchesVisitorFingerprint(row, input.visitor)
    ) {
      return null;
    }
    return row;
  }

  private mapDownloadIntent(row: FileDownloadIntent) {
    const purpose = row.purpose as DownloadIntentPurpose;
    const useLimit = this.getDownloadIntentUseLimit(purpose);
    const now = Date.now();
    const activeClaim =
      Boolean(row.claimToken) &&
      (row.claimedAt?.getTime() ?? Number.NEGATIVE_INFINITY) >
        now - downloadIntentClaimLeaseMs;
    const stalledClaim = Boolean(row.claimToken) && !activeClaim;
    const completed =
      (purpose === 'download' && Boolean(row.consumedAt)) ||
      (purpose === 'preview' && row.useCount >= useLimit);
    const expired = !completed && row.expiresAt.getTime() <= now;
    const status = completed
      ? 'completed'
      : expired
        ? 'expired'
        : activeClaim
          ? 'running'
          : stalledClaim
            ? 'failed'
            : row.failureCode
              ? 'failed'
              : purpose === 'preview' && row.useCount > 0
                ? 'running'
                : 'pending';
    const lifecycle = createTransferTaskLifecycle({
      status,
      failureCode: expired
        ? 'DOWNLOAD_INTENT_EXPIRED'
        : stalledClaim
          ? 'TRANSFER_STALLED'
          : row.failureCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.consumedAt ?? row.createdAt,
      expiresAt: row.expiresAt,
    });
    return {
      downloadId: row.id,
      nodeId: row.nodeId,
      versionId: row.versionId,
      filename: row.filename,
      method: row.method as DownloadIntentResponse['method'],
      purpose,
      auditMetadata: this.parseJsonRecord(row.auditMetadata),
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt?.toISOString() ?? null,
      useCount: row.useCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: lifecycle.updatedAt,
      actorUserId: row.actorUserId,
      lifecycle,
    };
  }

  private getDownloadIntentUseLimit(purpose: DownloadIntentPurpose) {
    return purpose === 'preview' ? 64 : 1;
  }

  private matchesVisitorFingerprint(
    row: Pick<FileDownloadIntent, 'requestIpHash' | 'userAgentHash'>,
    visitor?: { ip?: string; userAgent?: string },
  ) {
    const requestIpHash = this.hashVisitorValue(visitor?.ip);
    const userAgentHash = this.hashVisitorValue(visitor?.userAgent);
    return (
      (!row.requestIpHash || row.requestIpHash === requestIpHash) &&
      (!row.userAgentHash || row.userAgentHash === userAgentHash)
    );
  }

  private hashVisitorValue(value: string | undefined) {
    const normalized = value?.trim();
    if (!normalized) return null;
    return createHmac('sha256', resolveShareVisitorHashSecret(this.config))
      .update(normalized)
      .digest('hex');
  }

  private parseJsonRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return {};
  }

  private resolveAuditActor(
    metadata: Record<string, unknown> = {},
  ): AuditActor {
    if (typeof metadata.actorUserId === 'string' && metadata.actorUserId) {
      return 'account';
    }
    return 'workspace';
  }
}
