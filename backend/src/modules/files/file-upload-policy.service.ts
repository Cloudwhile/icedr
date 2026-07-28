import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createSuffixedFileName,
  getFileNameConflictKey,
  normalizeFileName,
} from '../../common/security/file-name-policy';
import { StorageService } from '../storage/storage.service';
import {
  createFileObjectKey,
  isUploadObjectKeyForPayload,
} from '../storage/storage-object-keys';
import type {
  CompleteUploadDto,
  CreateUploadIntentDto,
  FileNodeResponse,
  FileNodeSpaceScope,
  UploadConflictStrategy,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';

type AuditMetadata = Record<string, unknown>;

export type ResolvedUploadConflict = {
  fileName: string;
  strategy: UploadConflictStrategy;
  target: FileNodeResponse | null;
};

@Injectable()
export class FileUploadPolicyService {
  constructor(
    private readonly fileNodesRepository: FileNodesRepository,
    private readonly storageService: StorageService,
  ) {}

  normalizeNodeName(value: string) {
    return normalizeFileName(value);
  }

  normalizeSpaceScope(value?: string): FileNodeSpaceScope {
    return value === 'personal' ? 'personal' : 'workspace';
  }

  normalizeUploadConflictStrategy(
    value?: UploadConflictStrategy,
  ): UploadConflictStrategy {
    if (
      value === 'overwrite' ||
      value === 'rename' ||
      value === 'skip' ||
      value === 'version'
    ) {
      return value;
    }
    return 'version';
  }

  normalizeChunkSize(
    value: number | undefined,
    options: { distributedStorage: boolean },
  ) {
    const minimum = options.distributedStorage ? 5 * 1024 * 1024 : 64 * 1024;
    const fallback = options.distributedStorage
      ? 8 * 1024 * 1024
      : 4 * 1024 * 1024;
    const raw = Math.trunc(value ?? fallback);
    return Math.min(Math.max(raw, minimum), 32 * 1024 * 1024);
  }

  createUploadObjectKey(
    dto: CreateUploadIntentDto & { spaceScope: FileNodeSpaceScope },
    distributedStorage: boolean,
  ) {
    return createFileObjectKey({
      distributedStorage,
      fileName: dto.fileName,
      spaceScope: dto.spaceScope,
      workspaceId: dto.workspaceId,
    });
  }

  assertUploadObjectKey(dto: CompleteUploadDto) {
    if (!isUploadObjectKeyForPayload(dto)) {
      throw new BadRequestException(
        'Upload object key does not match a valid upload intent',
      );
    }
  }

  async assertValidParent(
    workspaceId: string,
    parentNodeId: string | null,
    spaceScope: FileNodeSpaceScope,
    access: { actorRole?: string; actorUserId?: string } = {},
  ) {
    if (!parentNodeId) return;
    const parent = await this.requireActiveNode(parentNodeId, access);
    if (parent.workspaceId !== workspaceId) {
      throw new BadRequestException(
        'Parent folder belongs to another workspace',
      );
    }
    if (parent.spaceScope !== spaceScope) {
      throw new BadRequestException('Parent folder belongs to another space');
    }
    if (parent.kind !== 'folder') {
      throw new BadRequestException('Parent node must be a folder');
    }
  }

  async resolveUploadConflict(input: {
    allowRename: boolean;
    conflictStrategy: UploadConflictStrategy;
    explicitConflictStrategy: boolean;
    fileName: string;
    ownerUserId?: string;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }): Promise<ResolvedUploadConflict> {
    const conflicts = await this.findSiblingNameConflicts({
      name: input.fileName,
      ownerUserId: input.ownerUserId,
      parentNodeId: input.parentNodeId,
      spaceScope: input.spaceScope,
      workspaceId: input.workspaceId,
    });
    if (conflicts.length === 0) {
      return {
        fileName: input.fileName,
        strategy: input.conflictStrategy,
        target: null,
      };
    }

    if (input.conflictStrategy === 'skip') {
      throw new ConflictException({
        code: 'UPLOAD_CONFLICT_SKIPPED',
        message: 'File upload skipped because a same-name item exists',
      });
    }

    if (input.conflictStrategy === 'rename' && input.allowRename) {
      const siblings = await this.listSiblingNodes(input);
      return {
        fileName: this.createAvailableSiblingFileName(input.fileName, siblings),
        strategy: input.conflictStrategy,
        target: null,
      };
    }

    const target = conflicts.length === 1 ? conflicts[0] : null;
    if (
      target?.objectKey &&
      (input.conflictStrategy === 'overwrite' ||
        input.conflictStrategy === 'version') &&
      (input.explicitConflictStrategy || target.name === input.fileName)
    ) {
      return {
        fileName: input.fileName,
        strategy: input.conflictStrategy,
        target,
      };
    }

    throw new ConflictException(
      'File node name conflicts with an existing item',
    );
  }

  async assertWithinWorkspaceQuota(
    workspaceId: string,
    incomingBytes: number,
    spaceScope: FileNodeSpaceScope,
    ownerUserId?: string,
    auditMetadata: AuditMetadata = {},
  ) {
    const storagePolicyQuotaBytes =
      await this.storageService.getConfiguredQuotaBytes();
    if (spaceScope === 'personal') {
      if (!ownerUserId) {
        throw new BadRequestException('Personal space requires a user');
      }
      const usage = await this.fileNodesRepository.getUserStorageUsage(
        workspaceId,
        ownerUserId,
      );
      const userQuotaBytes = usage.quotaBytes;
      const quotaBytes = resolveEffectiveQuotaBytes(
        userQuotaBytes,
        storagePolicyQuotaBytes,
      );
      const quotaScope =
        userQuotaBytes !== null &&
        userQuotaBytes !== undefined &&
        quotaBytes === userQuotaBytes
          ? 'user'
          : 'storage';
      if (
        quotaBytes &&
        quotaBytes > 0 &&
        usage.usedBytes + incomingBytes > quotaBytes
      ) {
        await this.fileNodesRepository.recordAudit(
          'file.quota_upload_rejected',
          workspaceId,
          {
            metadata: {
              ...auditMetadata,
              incomingBytes,
              quotaBytes,
              scope: quotaScope,
              spaceScope,
              usedBytes: usage.usedBytes,
              userId: ownerUserId,
            },
            nodeId: null,
            workspaceId,
          },
        );
        throw new BadRequestException('Storage space is insufficient');
      }
      return;
    }

    const usage = await this.fileNodesRepository.getStorageUsage(workspaceId, {
      spaceScope: 'workspace',
    });
    const workspaceQuotaBytes = usage.quotaBytes;
    const quotaBytes = resolveEffectiveQuotaBytes(
      workspaceQuotaBytes,
      storagePolicyQuotaBytes,
    );
    const quotaScope =
      workspaceQuotaBytes !== null &&
      workspaceQuotaBytes !== undefined &&
      quotaBytes === workspaceQuotaBytes
        ? 'workspace'
        : 'storage';
    if (
      quotaBytes &&
      quotaBytes > 0 &&
      usage.usedBytes + incomingBytes > quotaBytes
    ) {
      await this.fileNodesRepository.recordAudit(
        'file.quota_upload_rejected',
        workspaceId,
        {
          metadata: {
            ...auditMetadata,
            incomingBytes,
            quotaBytes,
            scope: quotaScope,
            spaceScope,
            usedBytes: usage.usedBytes,
          },
          nodeId: null,
          workspaceId,
        },
      );
      throw new BadRequestException('Storage space is insufficient');
    }
  }

  async getStorageUsage(workspaceId: string, quotaBytes: number | null) {
    const usage = await this.fileNodesRepository.getStorageUsage(workspaceId, {
      spaceScope: 'workspace',
    });
    const resolvedQuotaBytes = usage.quotaBytes ?? quotaBytes;
    const usagePercent =
      resolvedQuotaBytes && resolvedQuotaBytes > 0
        ? Math.min(
            100,
            Math.round((usage.usedBytes / resolvedQuotaBytes) * 1000) / 10,
          )
        : null;
    return {
      workspaceId,
      ...usage,
      quotaBytes: resolvedQuotaBytes,
      usagePercent,
      updatedAt: new Date().toISOString(),
    };
  }

  private async listSiblingNodes(input: {
    ownerUserId?: string;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }) {
    return this.fileNodesRepository.list(
      input.workspaceId,
      input.parentNodeId,
      'active',
      {
        ownerUserId:
          input.spaceScope === 'personal' ? input.ownerUserId : undefined,
        spaceScope: input.spaceScope,
      },
    );
  }

  private createAvailableSiblingFileName(
    fileName: string,
    siblings: FileNodeResponse[],
  ) {
    const siblingKeys = new Set(
      siblings.map((node) => getFileNameConflictKey(node.name)),
    );
    if (!siblingKeys.has(getFileNameConflictKey(fileName))) return fileName;

    for (let index = 2; index < 10000; index += 1) {
      const candidate = createSuffixedFileName(fileName, ` (${index})`);
      if (!siblingKeys.has(getFileNameConflictKey(candidate))) {
        return candidate;
      }
    }
    throw new BadRequestException('Unable to create a non-conflicting name');
  }

  private async findSiblingNameConflicts(input: {
    name: string;
    ownerUserId?: string;
    parentNodeId: string | null;
    spaceScope: FileNodeSpaceScope;
    workspaceId: string;
  }): Promise<FileNodeResponse[]> {
    const targetKey = getFileNameConflictKey(input.name);
    const siblings = await this.listSiblingNodes(input);
    return siblings.filter(
      (node) => getFileNameConflictKey(node.name) === targetKey,
    );
  }

  private async requireActiveNode(
    nodeId: string,
    access: { actorRole?: string; actorUserId?: string },
  ) {
    const node = await this.fileNodesRepository.findById(nodeId);
    if (!node) throw new NotFoundException('File node not found');
    if (
      node.spaceScope === 'personal' &&
      access.actorUserId &&
      access.actorRole !== 'admin' &&
      node.ownerUserId !== access.actorUserId
    ) {
      throw new NotFoundException('File node not found');
    }
    if (node.archivedAt) {
      throw new ForbiddenException('File node is archived');
    }
    return node;
  }
}

function resolveEffectiveQuotaBytes(
  workspaceQuotaBytes: number | null | undefined,
  storagePolicyQuotaBytes: number | null,
) {
  const candidates = [workspaceQuotaBytes, storagePolicyQuotaBytes].filter(
    (quotaBytes): quotaBytes is number =>
      quotaBytes !== null && quotaBytes !== undefined && quotaBytes > 0,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}
