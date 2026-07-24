import type { ShareDownloadIntent } from '../../generated/prisma/client';
import {
  createTransferTaskLifecycle,
  type TransferTaskFailureCode,
  type TransferTaskLifecycle,
} from '../../common/transfers/transfer-task-state';
import type { DownloadIntentPurpose } from '../files/file-nodes.dto';
import type { ShareAccessIdentityType } from './share-access.dto';

export const shareDownloadIntentClaimLeaseMs = 30 * 1000;

export type ShareDownloadIntentRecord = {
  downloadId: string;
  token: string;
  nodeId: string;
  actorUserId: string | null;
  filename: string;
  expiresAt: string;
  method: 'stream' | 'manifest';
  purpose: DownloadIntentPurpose;
  identityType: ShareAccessIdentityType;
  email?: string;
  failureCode: TransferTaskFailureCode | null;
  consumedAt: string | null;
  useCount: number;
  lifecycle: TransferTaskLifecycle;
  createdAt: string;
  updatedAt: string;
};

export function mapShareDownloadIntentRecord(
  row: ShareDownloadIntent,
  now = new Date(),
): ShareDownloadIntentRecord {
  const purpose = row.purpose as DownloadIntentPurpose;
  const useLimit = purpose === 'preview' ? 64 : 1;
  const activeClaim =
    Boolean(row.claimToken) &&
    (row.claimedAt?.getTime() ?? Number.NEGATIVE_INFINITY) >
      now.getTime() - shareDownloadIntentClaimLeaseMs;
  const stalledClaim = Boolean(row.claimToken) && !activeClaim;
  const completed =
    (purpose === 'download' && Boolean(row.consumedAt)) ||
    (purpose === 'preview' && row.useCount >= useLimit);
  const expired = !completed && row.expiresAt.getTime() <= now.getTime();
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
  const lifecycle = createTransferTaskLifecycle(
    {
      status,
      failureCode: expired
        ? 'DOWNLOAD_INTENT_EXPIRED'
        : stalledClaim
          ? 'TRANSFER_STALLED'
          : row.failureCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.consumedAt ?? row.createdAt,
      expiresAt: row.expiresAt,
    },
    now,
  );
  return {
    downloadId: row.id,
    token: row.shareToken,
    nodeId: row.nodeId,
    actorUserId: row.actorUserId,
    filename: row.filename,
    method: row.method as ShareDownloadIntentRecord['method'],
    purpose,
    identityType: row.identityType as ShareAccessIdentityType,
    ...(row.email ? { email: row.email } : {}),
    failureCode: lifecycle.errorCode,
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
    useCount: row.useCount,
    lifecycle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: lifecycle.updatedAt,
  };
}
