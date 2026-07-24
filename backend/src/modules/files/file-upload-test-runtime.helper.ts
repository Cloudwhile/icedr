import { Readable } from 'stream';
import { createTransferTaskLifecycle } from '../../common/transfers/transfer-task-state';
import { StorageService } from '../storage/storage.service';
import { readStreamSize } from './file-upload-test-fixtures.helper';

export type TestStorage = Pick<
  StorageService,
  | 'abortMultipartUpload'
  | 'assertObjectExists'
  | 'composeUploadSessionParts'
  | 'completeMultipartUpload'
  | 'createMultipartUpload'
  | 'createMultipartUploadPartUrl'
  | 'deleteObject'
  | 'deleteUploadSessionParts'
  | 'distributedStorageEnabled'
  | 'findMultipartUploadPart'
  | 'getConfiguredQuotaBytes'
  | 'objectExists'
  | 'openObjectStream'
  | 'writeUploadSessionPart'
>;

export type TestTransfers = {
  createUploadTransfer: jest.Mock;
  completeTransfer: jest.Mock;
  resumeTransferInternal: jest.Mock;
  updateTransferInternal: jest.Mock;
  updateTransferProgressInternal: jest.Mock;
};

export function createTestStorage(): TestStorage {
  return {
    distributedStorageEnabled: jest.fn(() => Promise.resolve(true)),
    getConfiguredQuotaBytes: jest.fn(() => Promise.resolve(null)),
    openObjectStream: jest.fn(() =>
      Promise.resolve({
        acceptRanges: 'bytes' as const,
        contentLength: 4,
        contentRange: 'bytes 0-3/10',
        contentType: 'application/octet-stream',
        etag: null,
        lastModified: null,
        statusCode: 206 as const,
        stream: Readable.from(['test']),
      }),
    ),
    assertObjectExists: jest.fn(() => Promise.resolve()),
    objectExists: jest.fn(() => Promise.resolve(false)),
    composeUploadSessionParts: jest.fn(
      async (input: { refreshOperationLease?: () => Promise<void> }) => {
        await input.refreshOperationLease?.();
        return { objectKey: 'composed', stored: true } as const;
      },
    ),
    createMultipartUpload: jest.fn((key: string) =>
      Promise.resolve({ key, uploadId: `multipart-${key}` }),
    ),
    createMultipartUploadPartUrl: jest.fn(
      (input: { objectKey: string; partIndex: number; uploadId: string }) =>
        Promise.resolve({
          expiresAt: new Date(Date.now() + 900000).toISOString(),
          expiresInSeconds: 900,
          headers: {},
          method: 'PUT',
          partIndex: input.partIndex,
          uploadId: input.uploadId,
          url: `s3://icedr-drive/${input.objectKey}?part=${input.partIndex}`,
        }),
    ),
    completeMultipartUpload: jest.fn(() =>
      Promise.resolve({ objectKey: 'completed', stored: true }),
    ),
    abortMultipartUpload: jest.fn(() => Promise.resolve()),
    deleteObject: jest.fn(() => Promise.resolve()),
    findMultipartUploadPart: jest.fn((input: { partIndex: number }) =>
      Promise.resolve({
        eTag: `"etag-${input.partIndex}"`,
        partIndex: input.partIndex,
        sizeBytes: null,
      }),
    ),
    deleteUploadSessionParts: jest.fn(() => Promise.resolve()),
    writeUploadSessionPart: jest.fn(
      async (_sessionId: string, _partIndex: number, stream: Readable) => ({
        sizeBytes: await readStreamSize(stream),
      }),
    ),
  } as unknown as TestStorage;
}

export function createTestTransfers(): TestTransfers {
  return {
    createUploadTransfer: jest.fn(
      (input: {
        workspaceId: string;
        objectKey: string;
        name: string;
        expiresAt?: Date | null;
      }) => {
        const createdAt = new Date().toISOString();
        return Promise.resolve({
          id: 'transfer-test',
          workspaceId: input.workspaceId,
          ownerUserId: null,
          objectKey: input.objectKey,
          nodeId: null,
          name: input.name,
          type: 'upload',
          progress: 0,
          status: 'running',
          failureCode: null,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          lifecycle: createTransferTaskLifecycle({
            status: 'running',
            createdAt,
            updatedAt: createdAt,
            expiresAt: input.expiresAt,
          }),
          createdAt,
          updatedAt: createdAt,
        });
      },
    ),
    completeTransfer: jest.fn(() => Promise.resolve()),
    resumeTransferInternal: jest.fn(() => Promise.resolve()),
    updateTransferInternal: jest.fn(() => Promise.resolve()),
    updateTransferProgressInternal: jest.fn(() => Promise.resolve()),
  };
}
