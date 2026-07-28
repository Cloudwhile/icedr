import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { createNode, docxMimeType } from './file-upload-test-fixtures.helper';
import {
  createFileNodesServiceTestHarness,
  type FileNodesServiceTestHarness,
} from './file-upload-test-harness.helper';

describe('FileUploadService completion leases', () => {
  let nodes: FileNodesServiceTestHarness['nodes'];
  let repository: FileNodesServiceTestHarness['repository'];
  let repositoryMocks: FileNodesServiceTestHarness['repositoryMocks'];
  let service: FileNodesServiceTestHarness['service'];
  let storage: FileNodesServiceTestHarness['storage'];
  let transfers: FileNodesServiceTestHarness['transfers'];
  let uploadSessions: FileNodesServiceTestHarness['uploadSessions'];
  let uploadSessionMocks: FileNodesServiceTestHarness['uploadSessionMocks'];

  beforeEach(() => {
    ({
      nodes,
      repository,
      repositoryMocks,
      service,
      storage,
      transfers,
      uploadSessions,
      uploadSessionMocks,
    } = createFileNodesServiceTestHarness());
  });

  it('does not treat an undersized local compose target as finalized', async () => {
    (storage.distributedStorageEnabled as jest.Mock).mockResolvedValueOnce(
      false,
    );
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Local Compose Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.uploadChunk(
      intent.sessionId ?? '',
      0,
      Readable.from(Buffer.alloc(4096)),
    );
    (storage.objectExists as jest.Mock).mockResolvedValueOnce(false);

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Local Compose Retry.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).resolves.toMatchObject({ objectKey: intent.objectKey });

    expect(storage.objectExists).toHaveBeenCalledWith(intent.objectKey, 4096);
    expect(storage.composeUploadSessionParts).toHaveBeenCalledTimes(1);
    expect(storage.assertObjectExists).toHaveBeenCalledWith(
      intent.objectKey,
      4096,
    );
  });

  it('does not accept a partially written local compose target after an error', async () => {
    (storage.distributedStorageEnabled as jest.Mock).mockResolvedValueOnce(
      false,
    );
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Partial Local Compose.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.uploadChunk(
      intent.sessionId ?? '',
      0,
      Readable.from(Buffer.alloc(4096)),
    );
    let localTargetSize: number | null = null;
    (storage.composeUploadSessionParts as jest.Mock).mockImplementationOnce(
      () => {
        localTargetSize = 1024;
        return Promise.reject(new Error('local compose failed after write'));
      },
    );
    (storage.objectExists as jest.Mock).mockImplementationOnce(
      (_objectKey: string, expectedSize?: number) =>
        Promise.resolve(localTargetSize === expectedSize),
    );
    (storage.assertObjectExists as jest.Mock).mockImplementationOnce(
      (_objectKey: string, expectedSize?: number) =>
        localTargetSize === expectedSize
          ? Promise.resolve()
          : Promise.reject(new BadRequestException('object size mismatch')),
    );

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Partial Local Compose.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).rejects.toThrow('local compose failed after write');

    expect(localTargetSize).toBe(1024);
    expect(storage.objectExists).toHaveBeenCalledWith(intent.objectKey, 4096);
    expect(storage.assertObjectExists).toHaveBeenCalledWith(
      intent.objectKey,
      4096,
    );
    expect(uploadSessionMocks.markStorageFinalized).not.toHaveBeenCalled();
    expect(repositoryMocks.completeUpload).not.toHaveBeenCalled();
    expect(uploadSessionMocks.completeCompletionClaim).not.toHaveBeenCalled();
  });

  it('does not publish a local compose after its completion claim is superseded', async () => {
    (storage.distributedStorageEnabled as jest.Mock).mockResolvedValueOnce(
      false,
    );
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Superseded Local Compose.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.uploadChunk(
      intent.sessionId ?? '',
      0,
      Readable.from(Buffer.alloc(4096)),
    );
    uploadSessionMocks.refreshCompletionClaim
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null);
    (storage.assertObjectExists as jest.Mock).mockRejectedValueOnce(
      new BadRequestException('object missing'),
    );

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Superseded Local Compose.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(uploadSessionMocks.refreshCompletionClaim).toHaveBeenCalledTimes(2);
    expect(storage.composeUploadSessionParts).toHaveBeenCalledTimes(1);
    expect(uploadSessionMocks.markStorageFinalized).not.toHaveBeenCalled();
    expect(repositoryMocks.completeUpload).not.toHaveBeenCalled();
    expect(uploadSessionMocks.completeCompletionClaim).not.toHaveBeenCalled();
    expect(storage.deleteUploadSessionParts).not.toHaveBeenCalled();
  });

  it('recovers a completed local compose when persisting the marker fails', async () => {
    (storage.distributedStorageEnabled as jest.Mock).mockResolvedValueOnce(
      false,
    );
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Local Marker Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.uploadChunk(
      intent.sessionId ?? '',
      0,
      Readable.from(Buffer.alloc(4096)),
    );
    (storage.objectExists as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    uploadSessionMocks.markStorageFinalized.mockRejectedValueOnce(
      new Error('finalized marker unavailable'),
    );
    const completionInput = {
      workspaceId: 'workspace-default',
      fileName: 'Local Marker Retry.pdf',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: 'application/pdf',
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    };

    await expect(service.completeUpload(completionInput)).rejects.toThrow(
      'finalized marker unavailable',
    );
    await expect(
      service.completeUpload(completionInput),
    ).resolves.toMatchObject({ objectKey: intent.objectKey });

    expect(storage.objectExists).toHaveBeenCalledTimes(2);
    expect(storage.objectExists).toHaveBeenNthCalledWith(
      1,
      intent.objectKey,
      4096,
    );
    expect(storage.objectExists).toHaveBeenNthCalledWith(
      2,
      intent.objectKey,
      4096,
    );
    expect(storage.composeUploadSessionParts).toHaveBeenCalledTimes(1);
    expect(uploadSessionMocks.refreshCompletionClaim).toHaveBeenCalledTimes(2);
    expect(uploadSessionMocks.markStorageFinalized).toHaveBeenCalledTimes(2);
    expect(storage.deleteUploadSessionParts).toHaveBeenCalledTimes(1);
    expect(
      uploadSessionMocks.completeCompletionClaim.mock.invocationCallOrder[0],
    ).toBeLessThan(
      (storage.deleteUploadSessionParts as jest.Mock).mock
        .invocationCallOrder[0],
    );
  });

  it('does not let cancellation supersede an active completion claim', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Completion Lease.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    let releaseFinalize:
      | ((value: { objectKey: string; stored: true }) => void)
      | undefined;
    let notifyFinalizeStarted: (() => void) | undefined;
    const finalizeStarted = new Promise<void>((resolve) => {
      notifyFinalizeStarted = resolve;
    });
    (storage.completeMultipartUpload as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<{ objectKey: string; stored: true }>((resolve) => {
          releaseFinalize = resolve;
          notifyFinalizeStarted?.();
        }),
    );

    const completion = service.completeUpload({
      workspaceId: 'workspace-default',
      fileName: 'Completion Lease.pdf',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: 'application/pdf',
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    });
    await finalizeStarted;

    await expect(
      service.cancelUploadSession(intent.sessionId ?? ''),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();

    releaseFinalize?.({ objectKey: intent.objectKey, stored: true });
    await expect(completion).resolves.toMatchObject({
      objectKey: intent.objectKey,
    });
  });

  it('retries node persistence without finalizing storage twice', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Completion Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    (repository.completeUpload as jest.Mock).mockRejectedValueOnce(
      new Error('node persistence unavailable'),
    );
    const completionInput = {
      workspaceId: 'workspace-default',
      fileName: 'Completion Retry.pdf',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: 'application/pdf',
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    };

    await expect(service.completeUpload(completionInput)).rejects.toThrow(
      'node persistence unavailable',
    );
    expect(uploadSessionMocks.failCompletionClaim).toHaveBeenCalledTimes(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);

    await expect(
      service.completeUpload(completionInput),
    ).resolves.toMatchObject({
      name: 'Completion Retry.pdf',
      objectKey: intent.objectKey,
    });
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.assertObjectExists).toHaveBeenCalledTimes(2);
    expect(uploadSessionMocks.claimCompletion).toHaveBeenNthCalledWith(
      2,
      intent.sessionId,
      'failed',
    );
  });

  it('recovers a persisted concurrent rename using the old intent name', async () => {
    const original = nodes.find((node) => node.id === 'roadmap');
    if (!original) throw new Error('test target missing');
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'rename',
      fileName: original.name,
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
    });
    expect(intent.fileName).toBe('ICEDR Roadmap (2).docx');
    nodes.push(
      createNode({
        ...original,
        id: 'concurrent-rename',
        name: 'ICEDR Roadmap (2).docx',
        objectKey: 'objects/concurrent-rename.docx',
      }),
    );
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    uploadSessionMocks.completeCompletionClaim.mockResolvedValueOnce(null);
    const completionInput = {
      workspaceId: 'workspace-default',
      conflictStrategy: 'rename' as const,
      fileName: intent.fileName,
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: docxMimeType,
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    };

    await expect(service.completeUpload(completionInput)).rejects.toMatchObject(
      {
        response: { code: 'UPLOAD_COMPLETION_CLAIM_CONFLICT' },
      },
    );
    await expect(
      service.completeUpload(completionInput),
    ).resolves.toMatchObject({
      name: 'ICEDR Roadmap (3).docx',
      objectKey: intent.objectKey,
    });

    expect(repositoryMocks.completeUpload).toHaveBeenCalledTimes(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(uploadSessionMocks.claimCompletion).toHaveBeenNthCalledWith(
      2,
      intent.sessionId,
      'failed',
    );
  });

  it('cancels a completion-time skip race without exposing a failed transfer', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'skip',
      fileName: 'Concurrent Skip.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    (repository.completeUpload as jest.Mock).mockRejectedValueOnce(
      new ConflictException({
        code: 'UPLOAD_CONFLICT_SKIPPED',
        message: 'File upload skipped because a same-name item exists',
      }),
    );

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        conflictStrategy: 'skip',
        fileName: 'Concurrent Skip.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'UPLOAD_CONFLICT_SKIPPED' },
    });

    expect(uploadSessionMocks.cancelCompletionClaim).toHaveBeenCalledWith(
      intent.sessionId,
      expect.any(String),
      undefined,
    );
    expect(uploadSessionMocks.failCompletionClaim).not.toHaveBeenCalled();
    await expect(
      uploadSessions.findById(intent.sessionId ?? ''),
    ).resolves.toMatchObject({
      status: 'canceled',
      failureCode: null,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(intent.objectKey);
  });

  it('retries overwrite cleanup when a completed request is replayed', async () => {
    const displacedObjectKey =
      'uploads/workspace-default/root/seed-roadmap.docx';
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'overwrite',
      fileName: 'ICEDR Roadmap.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    (storage.deleteObject as jest.Mock)
      .mockRejectedValueOnce(new Error('cleanup interrupted'))
      .mockResolvedValueOnce(undefined);
    const completionInput = {
      workspaceId: 'workspace-default',
      conflictStrategy: 'overwrite' as const,
      fileName: 'ICEDR Roadmap.docx',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    };

    await expect(
      service.completeUpload(completionInput),
    ).resolves.toMatchObject({ objectKey: intent.objectKey });
    await expect(
      service.completeUpload(completionInput),
    ).resolves.toMatchObject({ objectKey: intent.objectKey });

    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenNthCalledWith(1, displacedObjectKey);
    expect(storage.deleteObject).toHaveBeenNthCalledWith(2, displacedObjectKey);
    expect(repositoryMocks.pruneVersions).toHaveBeenCalledTimes(2);
  });

  it('continues multipart uploads when the transfer progress task is gone', async () => {
    transfers.updateTransferProgressInternal.mockRejectedValueOnce(
      new NotFoundException('Transfer not found'),
    );
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Progress Race.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-progress-race',
    });

    await expect(
      service.completeUploadPart(intent.sessionId ?? '', 0, {
        eTag: '"etag-0"',
        sizeBytes: 4096,
      }),
    ).resolves.toMatchObject({
      progress: 95,
      uploadedBytes: 4096,
      uploadedPartIndexes: [0],
    });
  });

  it('keeps completed uploads when the transfer completion task is gone', async () => {
    transfers.completeTransfer.mockRejectedValueOnce(
      new NotFoundException('Transfer not found'),
    );
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Completion Race.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-completion-race',
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Completion Race.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        parentNodeId: undefined,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).resolves.toMatchObject({
      name: 'Completion Race.pdf',
      objectKey: intent.objectKey,
    });
  });
});
