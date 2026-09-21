import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { FileDownloadIntentsRepository } from './file-download-intents.repository';
import { FileNodeVersionsRepository } from './file-node-versions.repository';
import { FileNodesRepository } from './file-nodes.repository';
import { FilePreviewArtifactsRepository } from './file-preview-artifacts.repository';
import { FileStorageUsageRepository } from './file-storage-usage.repository';
import { StorageIntegrityTaskService } from '../storage/storage-integrity-task.service';

export const downloadIntentTestSecret = 'download-intent-test-secret';

export type StoredIntent = ReturnType<typeof storedIntent>;

export type CreateIntentInput = {
  data: {
    auditMetadata: Record<string, unknown>;
    actorUserId: string | null;
    claimedAt: Date | null;
    claimToken: string | null;
    expiresAt: Date;
    failureCode: string | null;
    filename: string;
    id: string;
    method: string;
    nodeId: string;
    purpose: string;
    requestIpHash: string | null;
    updatedAt: Date;
    userAgentHash: string | null;
    versionId: string | null;
  };
};

export type IntentUpdateManyAndReturnInput = {
  data: {
    claimedAt?: Date | null;
    claimToken?: string | null;
    consumedAt?: Date;
    failureCode?: string | null;
    updatedAt: Date;
    useCount?: { increment: number };
  };
  where: {
    claimedAt?: Date | null | { gt: Date };
    claimToken?: string | null;
    consumedAt?: null;
    expiresAt?: { gt: Date };
    failureCode?: string | null;
    id: string;
    purpose?: string;
    updatedAt?: Date | null;
    useCount?: number | { lt: number };
  };
};

function createConfig() {
  return {
    get: jest.fn((key: string) =>
      key === 'share.visitorHashSecret' ? downloadIntentTestSecret : undefined,
    ),
  } as unknown as ConfigService;
}

export function createDownloadIntentsRepository(prisma: unknown) {
  return new FileDownloadIntentsRepository(
    prisma as PrismaService,
    createConfig(),
  );
}

export function createPreviewArtifactsRepository(prisma: unknown) {
  return new FilePreviewArtifactsRepository(prisma as PrismaService);
}

export function createFileNodeVersionsRepository(prisma: unknown) {
  return new FileNodeVersionsRepository(addPrismaTestDefaults(prisma));
}

export function createFileStorageUsageRepository(prisma: unknown) {
  return new FileStorageUsageRepository(prisma as PrismaService);
}

export function createFileNodesRepository(
  prisma: unknown,
  integrityTasks: Pick<
    StorageIntegrityTaskService,
    'enqueueObjectVerification' | 'kickQueued'
  > = {
    enqueueObjectVerification: jest.fn(() => Promise.resolve('task-test')),
    kickQueued: jest.fn(),
  },
) {
  const prismaService = addPrismaTestDefaults(prisma);
  return new FileNodesRepository(
    prismaService,
    new FileDownloadIntentsRepository(prismaService, createConfig()),
    new FileNodeVersionsRepository(prismaService),
    new FilePreviewArtifactsRepository(prismaService),
    new FileStorageUsageRepository(prismaService),
    integrityTasks as StorageIntegrityTaskService,
  );
}

function addPrismaTestDefaults(prisma: unknown) {
  const client = prisma as Record<string, unknown> & {
    $queryRaw?: jest.Mock;
    $transaction?: (...args: unknown[]) => unknown;
    isSqlite?: () => boolean;
  };
  client.isSqlite ??= () => false;
  addTransactionClientDefaults(client);
  const transaction = client.$transaction;
  client.$transaction = transaction
    ? (operation: unknown, ...options: unknown[]) =>
        transaction(
          typeof operation === 'function'
            ? (tx: unknown) =>
                (operation as (client: unknown) => unknown)(
                  addTransactionClientDefaults(tx),
                )
            : operation,
          ...options,
        )
    : jest.fn((operation: unknown) =>
        typeof operation === 'function'
          ? (operation as (tx: unknown) => unknown)(client)
          : Promise.all(operation as Promise<unknown>[]),
      );
  return client as unknown as PrismaService;
}

function addTransactionClientDefaults(client: unknown) {
  const transactionClient = client as Record<string, unknown> & {
    $executeRaw?: jest.Mock;
    $queryRaw?: jest.Mock;
    fileNode?: Record<string, unknown> & { count?: jest.Mock };
  };
  transactionClient.$queryRaw ??= jest.fn((query: unknown) =>
    Promise.resolve(
      queryValues(query)
        .filter((value): value is string => typeof value === 'string')
        .map((id) => ({ id })),
    ),
  );
  transactionClient.$executeRaw ??= jest.fn((query: unknown) =>
    Promise.resolve(
      queryValues(query).filter((value) => typeof value === 'string').length,
    ),
  );
  if (transactionClient.fileNode) {
    transactionClient.fileNode.count ??= jest.fn(() => Promise.resolve(0));
  }
  return transactionClient;
}

function queryValues(query: unknown) {
  if (typeof query !== 'object' || query === null || !('values' in query)) {
    return [] as unknown[];
  }
  const values = (query as { values?: unknown }).values;
  return Array.isArray(values) ? (values as unknown[]) : [];
}

export function storedIntent(
  overrides: Partial<{
    actorUserId: string | null;
    claimedAt: Date | null;
    claimToken: string | null;
    consumedAt: Date | null;
    createdAt: Date;
    expiresAt: Date;
    failureCode: string | null;
    purpose: string;
    requestIpHash: string | null;
    useCount: number;
    updatedAt: Date | null;
    userAgentHash: string | null;
    versionId: string | null;
  }> = {},
) {
  return {
    id: 'fdl_test',
    nodeId: 'node-1',
    versionId: null,
    filename: 'file.txt',
    method: 'stream',
    purpose: 'download',
    claimToken: null,
    claimedAt: null,
    failureCode: null,
    auditMetadata: {},
    expiresAt: new Date(Date.now() + 60000),
    consumedAt: null,
    useCount: 0,
    requestIpHash: null,
    userAgentHash: null,
    actorUserId: null,
    createdAt: new Date(0),
    updatedAt: null,
    ...overrides,
  };
}
