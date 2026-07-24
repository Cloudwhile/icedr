import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import {
  isUploadSessionConflict,
  mapUploadSession,
  mapUploadSessionPart,
  type UploadPartInput,
  type UploadPartWriteClaim,
  uploadCompletionClaimLeaseMs,
  UploadSessionStateConflictError,
  UploadTransferStateConflictError,
} from './upload-session-types';

export class UploadSessionPartsStore {
  constructor(private readonly prisma: PrismaService) {}

  async list(sessionId: string) {
    const rows = await this.prisma.uploadSessionPart.findMany({
      where: { sessionId },
      orderBy: { partIndex: 'asc' },
    });
    return rows.map(mapUploadSessionPart);
  }

  async upsert(input: UploadPartInput) {
    const row = await this.prisma.uploadSessionPart.upsert({
      where: {
        sessionId_partIndex: {
          sessionId: input.sessionId,
          partIndex: input.partIndex,
        },
      },
      create: {
        sessionId: input.sessionId,
        partIndex: input.partIndex,
        startByte: BigInt(input.startByte),
        endByte: BigInt(input.endByte),
        sizeBytes: BigInt(input.sizeBytes),
        eTag: input.eTag ?? null,
      },
      update: {
        startByte: BigInt(input.startByte),
        endByte: BigInt(input.endByte),
        sizeBytes: BigInt(input.sizeBytes),
        eTag: input.eTag ?? null,
        updatedAt: new Date(),
      },
    });
    await this.touchSession(input.sessionId);
    return mapUploadSessionPart(row);
  }

  async claimWrite(id: string): Promise<UploadPartWriteClaim | null> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - uploadCompletionClaimLeaseMs);
    const writeToken = `part_${randomBytes(24).toString('base64url')}`;
    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
      select: { transferId: true },
    });
    if (!session) return null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const transfer = await tx.transferTask.updateMany({
          where: {
            id: session.transferId,
            transferType: 'upload',
            status: 'running',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: { updatedAt: now },
        });
        if (transfer.count !== 1) {
          throw new UploadTransferStateConflictError();
        }
        const rows = await tx.uploadSession.updateManyAndReturn({
          where: {
            id,
            status: 'running',
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
              {
                OR: [
                  { completionToken: null },
                  { completionStartedAt: null },
                  { completionStartedAt: { lte: staleBefore } },
                ],
              },
            ],
          },
          data: {
            completionToken: writeToken,
            completionStartedAt: now,
            updatedAt: now,
          },
        });
        const row = rows[0];
        if (rows.length !== 1 || row.completionToken !== writeToken) {
          throw new UploadSessionStateConflictError();
        }
        return { ...mapUploadSession(row), writeToken };
      });
    } catch (error) {
      if (isUploadSessionConflict(error)) return null;
      throw error;
    }
  }

  async commitWrite(writeToken: string, input: UploadPartInput) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const ownedRows = await tx.uploadSession.updateManyAndReturn({
        where: {
          id: input.sessionId,
          status: 'running',
          completionToken: writeToken,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: { completionStartedAt: now, updatedAt: now },
      });
      if (ownedRows.length !== 1) return null;

      await tx.uploadSessionPart.upsert({
        where: {
          sessionId_partIndex: {
            sessionId: input.sessionId,
            partIndex: input.partIndex,
          },
        },
        create: {
          sessionId: input.sessionId,
          partIndex: input.partIndex,
          startByte: BigInt(input.startByte),
          endByte: BigInt(input.endByte),
          sizeBytes: BigInt(input.sizeBytes),
          eTag: input.eTag ?? null,
        },
        update: {
          startByte: BigInt(input.startByte),
          endByte: BigInt(input.endByte),
          sizeBytes: BigInt(input.sizeBytes),
          eTag: input.eTag ?? null,
          updatedAt: now,
        },
      });

      const releasedRows = await tx.uploadSession.updateManyAndReturn({
        where: {
          id: input.sessionId,
          status: 'running',
          completionToken: writeToken,
        },
        data: {
          completionToken: null,
          completionStartedAt: null,
          updatedAt: now,
        },
      });
      if (releasedRows.length !== 1) {
        throw new Error('Upload part write claim changed during commit');
      }
      return mapUploadSession(releasedRows[0]);
    });
  }

  async releaseWrite(id: string, writeToken: string) {
    const result = await this.prisma.uploadSession.updateMany({
      where: { id, status: 'running', completionToken: writeToken },
      data: {
        completionToken: null,
        completionStartedAt: null,
        updatedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  private async touchSession(id: string) {
    await this.prisma.uploadSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }
}
