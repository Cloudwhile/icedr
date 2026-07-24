import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { DownloadIntentPurpose } from '../files/file-nodes.dto';
import type { ShareAccessIdentityType } from './share-access.dto';
import {
  mapShareDownloadIntentRecord,
  shareDownloadIntentClaimLeaseMs,
  type ShareDownloadIntentRecord,
} from './share-download-intent.mapper';
import {
  hashShareVisitorValue,
  matchesShareVisitorFingerprint,
  type ShareVisitorFingerprint,
} from './share-visitor-fingerprint';

export type CreateShareDownloadIntentInput = {
  downloadId: string;
  token: string;
  nodeId: string;
  actorUserId?: string | null;
  filename: string;
  expiresAt: string;
  method: ShareDownloadIntentRecord['method'];
  purpose: DownloadIntentPurpose;
  identityType: ShareAccessIdentityType;
  email?: string;
  visitor?: ShareVisitorFingerprint;
};

export type OpenShareDownloadIntentInput = {
  downloadId: string;
  token: string;
  nodeId: string;
  visitor?: ShareVisitorFingerprint;
};

export type UpdateShareDownloadIntentClaimInput = {
  claimToken: string;
  downloadId: string;
  nodeId: string;
  token: string;
};

@Injectable()
export class ShareDownloadIntentRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(
    input: CreateShareDownloadIntentInput,
  ): Promise<ShareDownloadIntentRecord> {
    const now = new Date();
    const row = await this.prisma.shareDownloadIntent.create({
      data: {
        id: input.downloadId,
        shareToken: input.token,
        nodeId: input.nodeId,
        actorUserId: input.actorUserId?.trim() || null,
        filename: input.filename,
        method: input.method,
        purpose: input.purpose,
        identityType: input.identityType,
        email: input.email ? this.normalizeEmail(input.email) : null,
        claimToken: null,
        claimedAt: null,
        failureCode: null,
        expiresAt: new Date(input.expiresAt),
        requestIpHash: hashShareVisitorValue(this.config, input.visitor?.ip),
        userAgentHash: hashShareVisitorValue(
          this.config,
          input.visitor?.userAgent,
        ),
        updatedAt: now,
      },
    });
    return mapShareDownloadIntentRecord(row);
  }

  async find(input: OpenShareDownloadIntentInput) {
    const row = await this.findUsableRow(input, new Date());
    return row ? mapShareDownloadIntentRecord(row) : null;
  }

  async claim(input: OpenShareDownloadIntentInput) {
    const now = new Date();
    const row = await this.findUsableRow(input, now);
    if (!row) return null;

    const claimToken = `sdlc_${randomBytes(18).toString('base64url')}`;
    const claimedRows =
      await this.prisma.shareDownloadIntent.updateManyAndReturn({
        where: {
          id: row.id,
          shareToken: input.token,
          nodeId: input.nodeId,
          claimToken: row.claimToken,
          claimedAt: row.claimedAt,
          consumedAt: null,
          expiresAt: { gt: now },
          failureCode: row.failureCode,
          purpose: row.purpose,
          updatedAt: row.updatedAt,
          useCount: row.useCount,
        },
        data: {
          claimToken,
          claimedAt: now,
          failureCode: null,
          updatedAt: now,
        },
      });
    const claimedRow = claimedRows[0];
    if (!claimedRow) return null;
    return {
      claimToken,
      intent: mapShareDownloadIntentRecord(claimedRow),
    };
  }

  failClaim(input: UpdateShareDownloadIntentClaimInput) {
    return this.clearClaim(input, { failureCode: 'DOWNLOAD_FAILED' });
  }

  releaseClaim(input: UpdateShareDownloadIntentClaimInput) {
    return this.clearClaim(input, {});
  }

  async pruneExpired(now = new Date()) {
    const result = await this.prisma.shareDownloadIntent.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return result.count;
  }

  private async clearClaim(
    input: UpdateShareDownloadIntentClaimInput,
    data: { failureCode?: 'DOWNLOAD_FAILED' },
  ) {
    const now = new Date();
    const updated = await this.prisma.shareDownloadIntent.updateMany({
      where: {
        id: input.downloadId,
        shareToken: input.token,
        nodeId: input.nodeId,
        claimToken: input.claimToken,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        claimToken: null,
        claimedAt: null,
        ...data,
        updatedAt: now,
      },
    });
    return updated.count === 1;
  }

  private async findUsableRow(input: OpenShareDownloadIntentInput, now: Date) {
    const row = await this.prisma.shareDownloadIntent.findUnique({
      where: { id: input.downloadId },
    });
    if (!row) return null;
    const claimLeaseCutoff = now.getTime() - shareDownloadIntentClaimLeaseMs;
    const hasActiveClaim =
      Boolean(row.claimToken) &&
      (row.claimedAt?.getTime() ?? Number.NEGATIVE_INFINITY) > claimLeaseCutoff;
    if (
      row.shareToken !== input.token ||
      row.nodeId !== input.nodeId ||
      row.expiresAt.getTime() <= now.getTime() ||
      (row.purpose === 'download' && row.consumedAt) ||
      (row.purpose !== 'download' && row.purpose !== 'preview') ||
      row.useCount >= this.getUseLimit(row.purpose) ||
      hasActiveClaim ||
      !matchesShareVisitorFingerprint(this.config, row, input.visitor)
    ) {
      return null;
    }
    return row;
  }

  private getUseLimit(purpose: string) {
    return purpose === 'preview' ? 64 : 1;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
}
