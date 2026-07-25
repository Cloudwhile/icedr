import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { FileNodeSpaceScope } from './file-nodes.dto';

export type FileNodeSpaceFilter = {
  ownerUserId?: string | null;
  spaceScope?: FileNodeSpaceScope;
};

@Injectable()
export class FileStorageUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getStorageUsage(workspaceId: string, filter: FileNodeSpaceFilter = {}) {
    const scopedWhere: Prisma.FileNodeWhereInput = {
      workspaceId,
      spaceScope: filter.spaceScope ?? 'workspace',
      ...(filter.ownerUserId !== undefined
        ? { ownerUserId: filter.ownerUserId }
        : {}),
    };
    const [activeStats, trashStats, folderCount, versionStats, workspace] =
      await Promise.all([
        this.prisma.fileNode.aggregate({
          where: {
            archivedAt: null,
            sizeBytes: { not: null },
            ...scopedWhere,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.fileNode.aggregate({
          where: {
            archivedAt: { not: null },
            sizeBytes: { not: null },
            ...scopedWhere,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.fileNode.count({
          where: {
            archivedAt: null,
            sizeBytes: null,
            ...scopedWhere,
          },
        }),
        this.prisma.fileVersion.aggregate({
          where: {
            node: scopedWhere,
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        this.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      ]);
    const trashBytes = Number(trashStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    const activeBytes = Number(activeStats._sum.sizeBytes ?? 0);
    return {
      activeBytes,
      defaultUserQuotaBytes:
        workspace?.defaultUserQuotaBytes !== null &&
        workspace?.defaultUserQuotaBytes !== undefined
          ? Number(workspace.defaultUserQuotaBytes)
          : null,
      fileCount: activeStats._count._all,
      folderCount,
      quotaBytes:
        workspace?.quotaBytes !== null && workspace?.quotaBytes !== undefined
          ? Number(workspace.quotaBytes)
          : null,
      trashBytes,
      trashFileCount: trashStats._count._all,
      usedBytes: activeBytes + trashBytes + versionBytes,
      versionBytes,
      versionCount: versionStats._count._all,
    };
  }

  async getUserStorageUsage(workspaceId: string, userId: string) {
    const [fileStats, versionStats, user, workspace] = await Promise.all([
      this.prisma.fileNode.aggregate({
        where: {
          ownerUserId: userId,
          sizeBytes: { not: null },
          spaceScope: 'personal',
          workspaceId,
        },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileVersion.aggregate({
        where: {
          node: {
            ownerUserId: userId,
            spaceScope: 'personal',
            workspaceId,
          },
        },
        _sum: { sizeBytes: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { storageQuotaBytes: true },
      }),
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultUserQuotaBytes: true },
      }),
    ]);
    const fileBytes = Number(fileStats._sum.sizeBytes ?? 0);
    const versionBytes = Number(versionStats._sum.sizeBytes ?? 0);
    const userQuotaBytes =
      user?.storageQuotaBytes !== null && user?.storageQuotaBytes !== undefined
        ? Number(user.storageQuotaBytes)
        : null;
    const defaultUserQuotaBytes =
      workspace?.defaultUserQuotaBytes !== null &&
      workspace?.defaultUserQuotaBytes !== undefined
        ? Number(workspace.defaultUserQuotaBytes)
        : null;
    return {
      defaultUserQuotaBytes,
      quotaBytes: userQuotaBytes ?? defaultUserQuotaBytes,
      usedBytes: fileBytes + versionBytes,
      userId,
      workspaceId,
    };
  }

  async getWorkspaceQuota(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { quotaBytes: true },
    });
    return workspace?.quotaBytes !== null && workspace?.quotaBytes !== undefined
      ? Number(workspace.quotaBytes)
      : null;
  }

  async updateWorkspaceQuota(input: {
    workspaceId: string;
    quotaBytes?: number | null;
    defaultUserQuotaBytes?: number | null;
  }) {
    const row = await this.prisma.workspace.update({
      where: { id: input.workspaceId },
      data: {
        ...(input.quotaBytes !== undefined
          ? {
              quotaBytes:
                input.quotaBytes === null ? null : BigInt(input.quotaBytes),
            }
          : {}),
        ...(input.defaultUserQuotaBytes !== undefined
          ? {
              defaultUserQuotaBytes:
                input.defaultUserQuotaBytes === null
                  ? null
                  : BigInt(input.defaultUserQuotaBytes),
            }
          : {}),
        updatedAt: new Date(),
      },
    });
    return {
      defaultUserQuotaBytes:
        row.defaultUserQuotaBytes !== null &&
        row.defaultUserQuotaBytes !== undefined
          ? Number(row.defaultUserQuotaBytes)
          : null,
      quotaBytes:
        row.quotaBytes !== null && row.quotaBytes !== undefined
          ? Number(row.quotaBytes)
          : null,
      workspaceId: row.id,
    };
  }
}
