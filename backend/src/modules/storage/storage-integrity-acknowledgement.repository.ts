import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { recordStorageIntegrityAudit } from './storage-integrity-audit';
import { mapStorageIntegrityResult } from './storage-integrity-result';

type AcknowledgementTransaction = Pick<
  Prisma.TransactionClient,
  'auditEvent' | 'blobIntegrityResult' | 'fileNode' | 'fileVersion'
>;

export type StorageIntegrityAcknowledgementOutcome =
  | {
      kind: 'acknowledged' | 'already-acknowledged';
      result: ReturnType<typeof mapStorageIntegrityResult>;
    }
  | { kind: 'invalid-status' };

@Injectable()
export class StorageIntegrityAcknowledgementRepository {
  constructor(private readonly prisma: PrismaService) {}

  acknowledgeResult(
    resultId: string,
    actorUserId: string,
  ): Promise<StorageIntegrityAcknowledgementOutcome | null> {
    return this.prisma.$transaction((tx) =>
      this.acknowledgeInTransaction(tx, resultId, actorUserId),
    );
  }

  private async acknowledgeInTransaction(
    tx: AcknowledgementTransaction,
    resultId: string,
    actorUserId: string,
  ): Promise<StorageIntegrityAcknowledgementOutcome | null> {
    const finding = await tx.blobIntegrityResult.findUnique({
      where: { id: resultId },
    });
    if (!finding) return null;
    if (finding.acknowledgedAt) {
      return {
        kind: 'already-acknowledged',
        result: mapStorageIntegrityResult(finding),
      };
    }
    if (finding.status !== 'mismatch' && finding.status !== 'failed') {
      return { kind: 'invalid-status' };
    }

    const acknowledgedAt = new Date();
    const claimed = await tx.blobIntegrityResult.updateMany({
      data: { acknowledgedAt, acknowledgedBy: actorUserId },
      where: {
        acknowledgedAt: null,
        checkedAt: finding.checkedAt,
        id: finding.id,
        nodeId: finding.nodeId,
        objectKey: finding.objectKey,
        status: finding.status,
        versionId: finding.versionId,
      },
    });
    if (claimed.count !== 1) {
      const concurrent = await tx.blobIntegrityResult.findUnique({
        where: { id: finding.id },
      });
      if (!concurrent) return null;
      if (concurrent.acknowledgedAt) {
        return {
          kind: 'already-acknowledged',
          result: mapStorageIntegrityResult(concurrent),
        };
      }
      return { kind: 'invalid-status' };
    }

    const acknowledgement = {
      integrityAcknowledgedAt: acknowledgedAt,
      integrityAcknowledgedBy: actorUserId,
    };
    if (finding.versionId) {
      await tx.fileVersion.updateMany({
        data: acknowledgement,
        where: {
          id: finding.versionId,
          integrityStatus: finding.status,
          lastVerifiedAt: finding.checkedAt,
          nodeId: finding.nodeId ?? undefined,
          objectKey: finding.objectKey,
          node: { workspaceId: finding.workspaceId },
        },
      });
    } else if (finding.nodeId) {
      const node = await tx.fileNode.updateMany({
        data: acknowledgement,
        where: {
          id: finding.nodeId,
          integrityStatus: finding.status,
          lastVerifiedAt: finding.checkedAt,
          objectKey: finding.objectKey,
          workspaceId: finding.workspaceId,
        },
      });
      if (node.count === 0) {
        const movedVersion = await tx.fileVersion.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
          where: {
            integrityStatus: finding.status,
            lastVerifiedAt: finding.checkedAt,
            nodeId: finding.nodeId,
            objectKey: finding.objectKey,
            node: { workspaceId: finding.workspaceId },
          },
        });
        if (movedVersion) {
          await tx.fileVersion.updateMany({
            data: acknowledgement,
            where: {
              id: movedVersion.id,
              integrityStatus: finding.status,
              lastVerifiedAt: finding.checkedAt,
              nodeId: finding.nodeId,
              objectKey: finding.objectKey,
            },
          });
        }
      }
    }

    const updated = await tx.blobIntegrityResult.findUnique({
      where: { id: finding.id },
    });
    if (!updated) throw new Error('Acknowledged integrity result disappeared');
    await recordStorageIntegrityAudit(tx, {
      action: 'system.storage_integrity_result_acknowledged',
      actorUserId,
      nodeId: finding.nodeId,
      result: 'success',
      resultId: finding.id,
      status: finding.status,
      taskId: finding.taskId,
      versionId: finding.versionId,
      workspaceId: finding.workspaceId,
    });
    return {
      kind: 'acknowledged',
      result: mapStorageIntegrityResult(updated),
    };
  }
}
