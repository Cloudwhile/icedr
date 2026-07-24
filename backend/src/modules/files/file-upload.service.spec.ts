import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  createFileNodesServiceTestHarness,
  type FileNodesServiceTestHarness,
} from './file-upload-test-harness.helper';

describe('FileUploadService intent and completion', () => {
  let repository: FileNodesServiceTestHarness['repository'];
  let repositoryMocks: FileNodesServiceTestHarness['repositoryMocks'];
  let service: FileNodesServiceTestHarness['service'];
  let storage: FileNodesServiceTestHarness['storage'];
  let transfers: FileNodesServiceTestHarness['transfers'];
  let uploadSessions: FileNodesServiceTestHarness['uploadSessions'];
  let uploadSessionMocks: FileNodesServiceTestHarness['uploadSessionMocks'];

  beforeEach(() => {
    ({
      repository,
      repositoryMocks,
      service,
      storage,
      transfers,
      uploadSessions,
      uploadSessionMocks,
    } = createFileNodesServiceTestHarness());
  });

  it('creates upload intents and completes uploads into file nodes', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Customer Notes.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-customer-notes',
    });
    const partIntent = await service.createUploadPartIntent(
      intent.sessionId ?? '',
      0,
    );
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    const node = await service.completeUpload({
      workspaceId: 'workspace-default',
      fileName: 'Customer Notes.pdf',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      parentNodeId: undefined,
      mimeType: 'application/pdf',
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    });

    expect(intent.uploadMethod).toBe('object-multipart');
    expect(intent.transferId).toBe('transfer-test');
    expect(intent.uploadUrl).toContain(`/upload-sessions/${intent.sessionId}`);
    expect(intent.uploadUrl).toContain('/parts');
    expect(intent.chunkSizeBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(intent.uploadedPartIndexes).toEqual([]);
    expect(partIntent.uploadUrl).toContain('s3://icedr-drive/');
    expect(intent.objectKey).toMatch(
      /^workspaces\/workspace-default\/spaces\/workspace\/objects\/original\/v2\/\d{4}\/\d{2}\/[A-Za-z0-9_-]{16}\.blob$/,
    );
    expect(intent.objectKey).not.toContain('Customer');
    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      intent.objectKey,
      'application/pdf',
    );
    expect(storage.writeUploadSessionPart).not.toHaveBeenCalled();
    expect(storage.composeUploadSessionParts).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith({
      objectKey: intent.objectKey,
      uploadId: `multipart-${intent.objectKey}`,
      parts: [{ eTag: '"etag-0"', partIndex: 0 }],
    });
    expect(uploadSessionMocks.refreshCompletionClaim).toHaveBeenCalledWith(
      intent.sessionId,
      expect.stringMatching(/^completion_/),
    );
    expect(
      uploadSessionMocks.refreshCompletionClaim.mock.invocationCallOrder[0],
    ).toBeLessThan(
      (storage.completeMultipartUpload as jest.Mock).mock
        .invocationCallOrder[0],
    );
    expect(storage.assertObjectExists).toHaveBeenCalledWith(intent.objectKey);
    expect(node.id).toMatch(/^node_/);
    expect(node.objectKey).toBe(intent.objectKey);
    expect(node.owner).toBe('Workspace User');
    expect(node.kind).toBe('doc');
    expect(transfers.completeTransfer).toHaveBeenCalledWith({
      transferId: 'transfer-test',
      nodeId: node.id,
      ownerUserId: null,
    });
    expect(transfers.resumeTransferInternal).not.toHaveBeenCalled();
    const completedStatusCallOrder = (
      uploadSessions.completeCompletionClaim as jest.Mock
    ).mock.invocationCallOrder[0];
    expect(
      (storage.assertObjectExists as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(completedStatusCallOrder);
    expect(
      (repository.completeUpload as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(completedStatusCallOrder);
    expect(uploadSessionMocks.claimCompletion).toHaveBeenCalledWith(
      intent.sessionId,
      'running',
    );
    expect(uploadSessionMocks.persistCompletionNode).not.toHaveBeenCalled();
    expect(repositoryMocks.completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: intent.objectKey }),
      {
        sessionId: intent.sessionId,
        completionToken: expect.stringMatching(/^completion_/) as unknown,
      },
    );
    expect(uploadSessionMocks.completeCompletionClaim).toHaveBeenCalledWith(
      intent.sessionId,
      expect.stringMatching(/^completion_/),
      node.id,
      undefined,
    );
    await expect(
      repository.countAuditEvents('file.upload_intent_created'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('file.upload_completed'),
    ).resolves.toBe(1);
  });

  it('does not inspect multipart storage before owning the part-write lease', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Busy Part.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    uploadSessionMocks.claimPartWrite.mockResolvedValueOnce(null);

    await expect(
      service.completeUploadPart(intent.sessionId ?? '', 0, {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(storage.findMultipartUploadPart).not.toHaveBeenCalled();
    expect(uploadSessionMocks.commitPartWrite).not.toHaveBeenCalled();
  });

  it('revalidates the complete part set after claiming upload completion', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Raced Parts.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    const validParts = await uploadSessions.listParts(intent.sessionId ?? '');
    uploadSessionMocks.listParts.mockClear();
    uploadSessionMocks.listParts
      .mockResolvedValueOnce(validParts)
      .mockResolvedValueOnce([]);

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Raced Parts.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(uploadSessionMocks.listParts).toHaveBeenCalledTimes(2);
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(uploadSessionMocks.failCompletionClaim).toHaveBeenCalledWith(
      intent.sessionId,
      expect.stringMatching(/^completion_/),
      'UPLOAD_FAILED',
      undefined,
    );
  });

  it('returns the persisted node when a completed request is retried', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Completed Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    const completionInput = {
      workspaceId: 'workspace-default',
      fileName: 'Completed Retry.pdf',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: 'application/pdf',
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    };

    const first = await service.completeUpload(completionInput);
    transfers.completeTransfer.mockClear();
    transfers.resumeTransferInternal.mockClear();
    transfers.resumeTransferInternal.mockRejectedValueOnce(
      new ConflictException('Completed transfers cannot resume'),
    );
    const repeated = await service.completeUpload(completionInput);

    expect(repeated.id).toBe(first.id);
    expect(transfers.completeTransfer).toHaveBeenCalledTimes(1);
    expect(transfers.resumeTransferInternal).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.completeUpload).toHaveBeenCalledTimes(1);
  });

  it('resumes a non-terminal transfer only after direct completion conflicts', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Failed Transfer Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    transfers.completeTransfer
      .mockRejectedValueOnce(new ConflictException('Transfer is failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Failed Transfer Retry.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).resolves.toMatchObject({ objectKey: intent.objectKey });
    expect(transfers.completeTransfer).toHaveBeenCalledTimes(2);
    expect(transfers.resumeTransferInternal).toHaveBeenCalledWith(
      intent.transferId,
      95,
      null,
    );
  });

  it('uses one fixed expiry for the upload session, transfer, and response', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T08:00:00.000Z'));
    try {
      const intent = await service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Fixed Expiry.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
      });
      const expiresAt = new Date('2026-07-19T08:00:00.000Z');

      expect(transfers.createUploadTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt }),
      );
      expect(uploadSessionMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt }),
      );
      expect(intent).toMatchObject({
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: 86400,
        lifecycle: {
          status: 'running',
          expiresAt: expiresAt.toISOString(),
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('derives a legacy session deadline from createdAt instead of first access', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-20T08:00:00.000Z'));
    try {
      const intent = await service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Legacy Expired.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
      });
      const stored = await uploadSessions.findById(intent.sessionId ?? '');
      expect(stored).not.toBeNull();
      (uploadSessions.findById as jest.Mock).mockResolvedValueOnce({
        ...stored,
        createdAt: '2026-07-18T08:00:00.000Z',
        expiresAt: null,
      });

      await expect(
        service.createUploadPartIntent(intent.sessionId ?? '', 0),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(uploadSessionMocks.setLegacyExpiry).toHaveBeenCalledWith(
        intent.sessionId,
        new Date('2026-07-19T08:00:00.000Z'),
      );
      expect(uploadSessionMocks.transitionFailureState).toHaveBeenCalledWith(
        intent.sessionId,
        'expired',
        { failureCode: 'UPLOAD_SESSION_EXPIRED' },
      );
      expect(transfers.updateTransferInternal).not.toHaveBeenCalledWith(
        intent.transferId,
        { failureCode: 'UPLOAD_SESSION_EXPIRED', status: 'expired' },
        null,
      );
      expect(storage.createMultipartUploadPartUrl).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('persists a recent legacy deadline once and reuses the same boundary', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    try {
      const intent = await service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Legacy Recent.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
      });
      const stored = await uploadSessions.findById(intent.sessionId ?? '');
      expect(stored).not.toBeNull();
      (uploadSessions.findById as jest.Mock).mockResolvedValueOnce({
        ...stored,
        createdAt: '2026-07-18T08:00:00.000Z',
        expiresAt: null,
      });

      await service.createUploadPartIntent(intent.sessionId ?? '', 0);
      await service.createUploadPartIntent(intent.sessionId ?? '', 0);

      expect(uploadSessionMocks.setLegacyExpiry).toHaveBeenCalledTimes(1);
      expect(uploadSessionMocks.setLegacyExpiry).toHaveBeenCalledWith(
        intent.sessionId,
        new Date('2026-07-19T08:00:00.000Z'),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks the transfer failed when upload session creation fails', async () => {
    jest
      .spyOn(uploadSessions, 'create')
      .mockRejectedValueOnce(new Error('session create failed'));

    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Create Failure.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
      }),
    ).rejects.toThrow('session create failed');

    expect(transfers.updateTransferInternal).toHaveBeenCalledWith(
      'transfer-test',
      { failureCode: 'UPLOAD_FAILED', status: 'failed' },
      null,
    );
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('keeps a persisted multipart session reusable when audit recording fails', async () => {
    jest
      .spyOn(repository, 'recordAudit')
      .mockRejectedValueOnce(new Error('audit write failed'));

    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Audit Failure.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'audit-failure',
      }),
    ).rejects.toThrow('audit write failed');

    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(uploadSessionMocks.transitionFailureState).toHaveBeenCalledWith(
      'upload-session-test-1',
      'failed',
      { failureCode: 'UPLOAD_FAILED' },
    );
    expect(transfers.updateTransferInternal).not.toHaveBeenCalledWith(
      'transfer-test',
      { failureCode: 'UPLOAD_FAILED', status: 'failed' },
      null,
    );
  });

  it('marks upload lifecycle failed when object validation fails', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Validation Failure.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    jest
      .spyOn(storage, 'assertObjectExists')
      .mockRejectedValueOnce(new Error('object validation failed'));
    const auditMetadata = {
      requestId: 'request-upload-failure',
      ip: '203.0.113.7',
    };

    await expect(
      service.completeUpload(
        {
          workspaceId: 'workspace-default',
          fileName: 'Validation Failure.pdf',
          objectKey: intent.objectKey,
          sizeBytes: 4096,
          mimeType: 'application/pdf',
          transferId: intent.transferId,
          uploadSessionId: intent.sessionId,
        },
        { auditMetadata },
      ),
    ).rejects.toThrow('object validation failed');

    expect(uploadSessionMocks.failCompletionClaim).toHaveBeenCalledWith(
      intent.sessionId,
      expect.stringMatching(/^completion_/),
      'UPLOAD_FAILED',
      auditMetadata,
    );
    expect(transfers.updateTransferInternal).not.toHaveBeenCalledWith(
      intent.transferId,
      { failureCode: 'UPLOAD_FAILED', status: 'failed' },
      null,
    );
    expect(uploadSessionMocks.completeCompletionClaim).not.toHaveBeenCalled();
  });

  it('finishes an idempotent retry when the object was already finalized', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Finalize Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    jest
      .spyOn(storage, 'completeMultipartUpload')
      .mockRejectedValueOnce(new Error('multipart upload already completed'));

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Finalize Retry.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).resolves.toMatchObject({ objectKey: intent.objectKey });

    expect(storage.assertObjectExists).toHaveBeenCalledWith(intent.objectKey);
    expect(uploadSessionMocks.completeCompletionClaim).toHaveBeenCalledWith(
      intent.sessionId,
      expect.stringMatching(/^completion_/),
      expect.stringMatching(/^node_/),
      undefined,
    );
  });

  it('does not finalize storage twice when persisting the finalized marker fails', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Finalize Marker Retry.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    (storage.objectExists as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    uploadSessionMocks.markStorageFinalized.mockRejectedValueOnce(
      new Error('finalized marker unavailable'),
    );
    const completionInput = {
      workspaceId: 'workspace-default',
      fileName: 'Finalize Marker Retry.pdf',
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
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(uploadSessionMocks.markStorageFinalized).toHaveBeenCalledTimes(2);
  });
});
