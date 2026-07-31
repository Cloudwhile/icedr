import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { uploadResumeKeyMaxLength } from './file-nodes.dto';
import { createNode, docxMimeType } from './file-upload-test-fixtures.helper';
import {
  createFileNodesServiceTestHarness,
  type FileNodesServiceTestHarness,
} from './file-upload-test-harness.helper';

describe('FileUploadService policies and sessions', () => {
  let nodes: FileNodesServiceTestHarness['nodes'];
  let repository: FileNodesServiceTestHarness['repository'];
  let service: FileNodesServiceTestHarness['service'];
  let storage: FileNodesServiceTestHarness['storage'];
  let transfers: FileNodesServiceTestHarness['transfers'];
  let uploadSessions: FileNodesServiceTestHarness['uploadSessions'];
  let uploadSessionMocks: FileNodesServiceTestHarness['uploadSessionMocks'];

  beforeEach(() => {
    ({
      nodes,
      repository,
      service,
      storage,
      transfers,
      uploadSessions,
      uploadSessionMocks,
    } = createFileNodesServiceTestHarness());
  });

  it('creates backend-local upload intents when distributed storage is disabled', async () => {
    jest
      .spyOn(storage, 'distributedStorageEnabled')
      .mockResolvedValueOnce(false);

    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Customer Notes.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-local-notes',
    });

    expect(intent.uploadMethod).toBe('chunked');
    expect(intent.transferId).toBe('transfer-test');
    expect(intent.objectKey).toMatch(/^local\/workspaces\//);
    expect(intent.uploadUrl).toContain('/api/file-nodes/upload-sessions/');
    expect(intent.uploadUrl).toContain('/chunks');
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('rejects upload intents that exceed workspace quota', async () => {
    jest.spyOn(repository, 'getStorageUsage').mockResolvedValueOnce({
      activeBytes: 900,
      defaultUserQuotaBytes: null,
      fileCount: 1,
      folderCount: 0,
      quotaBytes: 1000,
      trashBytes: 0,
      trashFileCount: 0,
      usagePercent: 90,
      usedBytes: 900,
      versionBytes: 0,
      versionCount: 0,
      workspaceId: 'workspace-default',
      updatedAt: new Date(0).toISOString(),
    });

    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Too Large.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('rejects upload intents with case-insensitive sibling conflicts', async () => {
    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'icedr roadmap.docx',
        mimeType: docxMimeType,
        fileSizeBytes: 4096,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('skips upload intents when the conflict strategy is skip', async () => {
    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'ICEDR Roadmap.docx',
        conflictStrategy: 'skip',
        mimeType: docxMimeType,
        fileSizeBytes: 4096,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('renames upload intents when the conflict strategy is rename', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'icedr roadmap.docx',
      conflictStrategy: 'rename',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
    });

    expect(intent.fileName).toBe('icedr roadmap (2).docx');
    expect(intent.conflictStrategy).toBe('rename');
    expect(transfers.createUploadTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'icedr roadmap (2).docx' }),
    );
  });

  it('keeps generated upload conflict names within the UTF-8 byte limit', async () => {
    const fileName = `${'界'.repeat(83)}.txt`;
    const conflict = createNode({
      id: 'multibyte-conflict',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: fileName,
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey: 'uploads/workspace-default/root/multibyte-conflict.txt',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    jest
      .spyOn(repository, 'list')
      .mockResolvedValueOnce([conflict])
      .mockResolvedValueOnce([conflict]);

    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName,
      conflictStrategy: 'rename',
      mimeType: 'text/plain',
      fileSizeBytes: 32,
    });

    expect(intent.fileName.endsWith(' (2).txt')).toBe(true);
    expect(Buffer.byteLength(intent.fileName, 'utf8')).toBeLessThanOrEqual(255);
  });

  it('allows exact-name uploads to continue as file versions', async () => {
    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'ICEDR Roadmap.docx',
        mimeType: docxMimeType,
        fileSizeBytes: 4096,
      }),
    ).resolves.toMatchObject({ transferId: 'transfer-test' });
    expect(transfers.createUploadTransfer).toHaveBeenCalledTimes(1);
  });

  it('allows explicit version uploads for case-insensitive file conflicts', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'icedr roadmap.docx',
      conflictStrategy: 'version',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    const node = await service.completeUpload({
      workspaceId: 'workspace-default',
      fileName: intent.fileName,
      conflictStrategy: 'version',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: docxMimeType,
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    });

    expect(node.id).toBe('roadmap');
    expect(node.name).toBe('icedr roadmap.docx');
    await expect(
      repository.countAuditEvents('file.version_created'),
    ).resolves.toBe(1);
  });

  it('overwrites file conflicts without keeping the previous object', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'ICEDR Roadmap.docx',
      conflictStrategy: 'overwrite',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    const node = await service.completeUpload({
      workspaceId: 'workspace-default',
      fileName: intent.fileName,
      conflictStrategy: 'overwrite',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      mimeType: docxMimeType,
      transferId: intent.transferId,
      uploadSessionId: intent.sessionId,
    });

    expect(node.id).toBe('roadmap');
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'uploads/workspace-default/root/seed-roadmap.docx',
    );
    await expect(
      repository.countAuditEvents('file.upload_overwritten'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('file.version_created'),
    ).resolves.toBe(0);
  });

  it('rejects upload intents that exceed configured storage quota', async () => {
    jest.spyOn(storage, 'getConfiguredQuotaBytes').mockResolvedValueOnce(1000);
    jest.spyOn(repository, 'getStorageUsage').mockResolvedValueOnce({
      activeBytes: 900,
      defaultUserQuotaBytes: null,
      fileCount: 1,
      folderCount: 0,
      quotaBytes: null,
      trashBytes: 0,
      trashFileCount: 0,
      usagePercent: null,
      usedBytes: 900,
      versionBytes: 0,
      versionCount: 0,
      workspaceId: 'workspace-default',
      updatedAt: new Date(0).toISOString(),
    });

    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Too Large.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('uses the storage policy quota when it is stricter than workspace quota', async () => {
    jest.spyOn(storage, 'getConfiguredQuotaBytes').mockResolvedValueOnce(1000);
    jest.spyOn(repository, 'getStorageUsage').mockResolvedValueOnce({
      activeBytes: 900,
      defaultUserQuotaBytes: null,
      fileCount: 1,
      folderCount: 0,
      quotaBytes: 2000,
      trashBytes: 0,
      trashFileCount: 0,
      usagePercent: 45,
      usedBytes: 900,
      versionBytes: 0,
      versionCount: 0,
      workspaceId: 'workspace-default',
      updatedAt: new Date(0).toISOString(),
    });

    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Too Large.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 200,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('rejects upload intents that exceed user quota', async () => {
    jest.spyOn(repository, 'getUserStorageUsage').mockResolvedValueOnce({
      defaultUserQuotaBytes: 1000,
      quotaBytes: 1000,
      usedBytes: 950,
      userId: 'user-test',
      workspaceId: 'workspace-default',
    });

    await expect(
      service.createUploadIntent(
        {
          workspaceId: 'workspace-default',
          fileName: 'Member Quota.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 100,
          spaceScope: 'personal',
        },
        { ownerUserId: 'user-test' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('reuses resumable upload sessions and reports completed chunks', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Resume.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-same-file',
    });
    await service.completeUploadPart(firstIntent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });

    const resumedIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Resume.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-same-file',
    });

    expect(resumedIntent.sessionId).toBe(firstIntent.sessionId);
    expect(resumedIntent.transferId).toBe(firstIntent.transferId);
    expect(resumedIntent.uploadedBytes).toBe(4096);
    expect(resumedIntent.uploadedPartIndexes).toEqual([0]);
    expect(transfers.createUploadTransfer).toHaveBeenCalledTimes(1);
    expect(uploadSessionMocks.resumeSession).toHaveBeenCalledWith(
      firstIntent.sessionId,
      'running',
      95,
    );
    expect(transfers.resumeTransferInternal).not.toHaveBeenCalled();
  });

  it('does not reuse a resume identity when the MIME type changes', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Resume MIME.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-mime-change',
    });

    const replacementIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Resume MIME.pdf',
      mimeType: 'text/plain',
      fileSizeBytes: 4096,
      resumeKey: 'resume-mime-change',
    });

    expect(replacementIntent.sessionId).not.toBe(firstIntent.sessionId);
    expect(uploadSessionMocks.cancelSession).toHaveBeenCalledWith(
      firstIntent.sessionId,
      'running',
      undefined,
    );
    expect(storage.createMultipartUpload).toHaveBeenLastCalledWith(
      replacementIntent.objectKey,
      'text/plain',
    );
  });

  it('rejects oversized upload resume keys before creating a transfer', async () => {
    await expect(
      service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Oversized Resume.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'x'.repeat(uploadResumeKeyMaxLength + 1),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transfers.createUploadTransfer).not.toHaveBeenCalled();
  });

  it('recovers the winning upload intent after a concurrent unique conflict', async () => {
    const winnerIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Concurrent Resume.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-concurrent-winner',
    });
    const winner = await uploadSessions.findById(winnerIntent.sessionId ?? '');
    if (!winner) throw new Error('test upload session missing');
    uploadSessionMocks.findReusable
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    uploadSessionMocks.create.mockRejectedValueOnce(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    );

    const recovered = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Concurrent Resume.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-concurrent-winner',
    });

    expect(recovered.sessionId).toBe(winnerIntent.sessionId);
    expect(recovered.transferId).toBe(winnerIntent.transferId);
    expect(storage.abortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(uploadSessionMocks.resumeSession).toHaveBeenCalledWith(
      winner.id,
      winner.status,
      0,
    );
  });

  it('returns a structured conflict when a unique-race winner is unavailable', async () => {
    uploadSessionMocks.findReusable
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    uploadSessionMocks.create.mockRejectedValueOnce(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    );

    let caught: unknown;
    try {
      await service.createUploadIntent({
        workspaceId: 'workspace-default',
        fileName: 'Concurrent Missing.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'resume-concurrent-missing',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({
      code: 'UPLOAD_RESUME_IDENTITY_CONFLICT',
    });
  });

  it('replaces an active resume identity when conflict strategy changes', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'version',
      fileName: 'Strategy Change.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-strategy-change',
    });

    const replacementIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'rename',
      fileName: 'Strategy Change.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-strategy-change',
    });

    expect(replacementIntent.sessionId).not.toBe(firstIntent.sessionId);
    expect(replacementIntent.conflictStrategy).toBe('rename');
    expect(uploadSessionMocks.cancelSession).toHaveBeenCalledWith(
      firstIntent.sessionId,
      'running',
      undefined,
    );
  });

  it('persists an expired resume candidate before creating its replacement', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Expired Resume.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-expired-candidate',
    });
    const stored = await uploadSessions.findById(firstIntent.sessionId ?? '');
    if (!stored) throw new Error('test upload session missing');
    uploadSessionMocks.findReusable.mockResolvedValueOnce({
      ...stored,
      status: 'expired',
    });

    const replacementIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Expired Resume.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-expired-candidate',
    });

    expect(replacementIntent.sessionId).not.toBe(firstIntent.sessionId);
    expect(uploadSessionMocks.transitionFailureState).toHaveBeenCalledWith(
      firstIntent.sessionId,
      'expired',
      { failureCode: 'UPLOAD_SESSION_EXPIRED' },
    );
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      objectKey: firstIntent.objectKey,
      uploadId: `multipart-${firstIntent.objectKey}`,
    });
  });

  it('returns expired session status without waiting for storage cleanup', async () => {
    const intent = await service.createUploadIntent(
      {
        workspaceId: 'workspace-default',
        fileName: 'Expired Status.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'resume-expired-status',
      },
      { ownerUserId: 'user-a' },
    );
    const stored = await uploadSessions.findById(intent.sessionId ?? '');
    if (!stored) throw new Error('test upload session missing');
    stored.status = 'expired';
    let releaseCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const abortMultipartUpload = jest
      .spyOn(storage, 'abortMultipartUpload')
      .mockReturnValueOnce(cleanup);

    await expect(
      service.getUploadSession(intent.sessionId ?? '', 'user-a'),
    ).resolves.toMatchObject({
      sessionId: intent.sessionId,
      status: 'expired',
    });

    expect(abortMultipartUpload).toHaveBeenCalledWith({
      objectKey: intent.objectKey,
      uploadId: `multipart-${intent.objectKey}`,
    });
    releaseCleanup?.();
    await cleanup;
  });

  it('replaces a reusable overwrite session when its target object changed', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'overwrite',
      fileName: 'ICEDR Roadmap.docx',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
      resumeKey: 'resume-overwrite-snapshot',
    });
    const target = nodes.find((node) => node.id === 'roadmap');
    expect(target).toBeDefined();
    if (!target) throw new Error('test target missing');
    target.objectKey = 'objects/concurrent-roadmap.docx';

    const replacementIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'overwrite',
      fileName: 'ICEDR Roadmap.docx',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
      resumeKey: 'resume-overwrite-snapshot',
    });
    const replacementSession = await uploadSessions.findById(
      replacementIntent.sessionId ?? '',
    );

    expect(replacementIntent.sessionId).not.toBe(firstIntent.sessionId);
    expect(uploadSessionMocks.cancelSession).toHaveBeenCalledWith(
      firstIntent.sessionId,
      'running',
      undefined,
    );
    expect(replacementSession).toMatchObject({
      conflictTargetNodeId: 'roadmap',
      conflictTargetObjectKey: 'objects/concurrent-roadmap.docx',
    });
  });

  it('replaces a reusable version session when the same-name target id changed', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'version',
      fileName: 'ICEDR Roadmap.docx',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
      resumeKey: 'resume-version-snapshot',
    });
    const targetIndex = nodes.findIndex((node) => node.id === 'roadmap');
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const previousTarget = nodes[targetIndex];
    if (!previousTarget) throw new Error('test target missing');
    nodes[targetIndex] = createNode({
      ...previousTarget,
      id: 'roadmap-replacement',
      objectKey: 'objects/replacement-roadmap.docx',
    });

    const replacementIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      conflictStrategy: 'version',
      fileName: 'ICEDR Roadmap.docx',
      mimeType: docxMimeType,
      fileSizeBytes: 4096,
      resumeKey: 'resume-version-snapshot',
    });
    const replacementSession = await uploadSessions.findById(
      replacementIntent.sessionId ?? '',
    );

    expect(replacementIntent.sessionId).not.toBe(firstIntent.sessionId);
    expect(uploadSessionMocks.cancelSession).toHaveBeenCalledWith(
      firstIntent.sessionId,
      'running',
      undefined,
    );
    expect(replacementSession).toMatchObject({
      conflictTargetNodeId: 'roadmap-replacement',
    });
  });

  it('returns the resumed lifecycle after retrying a failed session', async () => {
    const firstIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Retry Lifecycle.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'retry-lifecycle',
    });
    await uploadSessions.updateStatus(firstIntent.sessionId ?? '', 'failed', {
      failureCode: 'UPLOAD_FAILED',
    });

    const resumedIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Retry Lifecycle.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'retry-lifecycle',
    });

    expect(resumedIntent.sessionId).toBe(firstIntent.sessionId);
    expect(resumedIntent.lifecycle).toMatchObject({
      status: 'running',
      errorCode: null,
    });
  });

  it('recovers finalized failed sessions in completion-only mode', async () => {
    const firstIntent = await service.createUploadIntent(
      {
        workspaceId: 'workspace-default',
        fileName: 'Completion Recovery.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'resume-completion-recovery',
      },
      { ownerUserId: 'user-a' },
    );
    await service.completeUploadPart(firstIntent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });
    await uploadSessions.updateStatus(firstIntent.sessionId ?? '', 'failed', {
      failureCode: 'UPLOAD_FAILED',
    });
    const failed = await uploadSessions.findById(firstIntent.sessionId ?? '');
    if (!failed) throw new Error('test upload session missing');
    failed.storageFinalizedAt = new Date().toISOString();

    const resumedIntent = await service.createUploadIntent(
      {
        workspaceId: 'workspace-default',
        fileName: 'Completion Recovery.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'resume-completion-recovery',
      },
      { ownerUserId: 'user-a' },
    );
    const status = await service.getUploadSession(
      resumedIntent.sessionId ?? '',
      'user-a',
    );

    expect(resumedIntent).toMatchObject({
      sessionId: firstIntent.sessionId,
      recoveryMode: 'completion-only',
    });
    expect(status).toMatchObject({
      sessionId: firstIntent.sessionId,
      uploadedBytes: 4096,
      uploadedPartIndexes: [0],
      progress: 95,
      recoveryMode: 'completion-only',
      status: 'running',
    });
    for (const privateField of [
      'objectKey',
      'resumeKey',
      'multipartUploadId',
      'eTag',
      'completionToken',
      'ownerUserId',
    ]) {
      expect(status).not.toHaveProperty(privateField);
    }
    await expect(
      service.createUploadPartIntent(
        resumedIntent.sessionId ?? '',
        0,
        'user-a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getUploadSession(resumedIntent.sessionId ?? '', 'user-b'),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.completeUpload(
        {
          workspaceId: 'workspace-default',
          fileName: 'Completion Recovery.pdf',
          objectKey: resumedIntent.objectKey,
          sizeBytes: 4096,
          mimeType: 'application/pdf',
          transferId: resumedIntent.transferId,
          uploadSessionId: resumedIntent.sessionId,
        },
        { ownerUserId: 'user-a' },
      ),
    ).resolves.toMatchObject({ objectKey: resumedIntent.objectKey });
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(storage.assertObjectExists).toHaveBeenCalledWith(
      resumedIntent.objectKey,
      4096,
    );
  });

  it('rejects upload completion until every chunk has arrived', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Missing Chunk.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-missing',
    });

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Missing Chunk.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
        uploadSessionId: intent.sessionId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('cancels object multipart sessions by aborting object storage uploads', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Cancel.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-cancel',
    });
    const auditMetadata = {
      requestId: 'request-cancel',
      ip: '203.0.113.7',
    };

    await expect(
      service.cancelUploadSession(intent.sessionId ?? '', { auditMetadata }),
    ).resolves.toEqual({ ok: true });
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      objectKey: intent.objectKey,
      uploadId: `multipart-${intent.objectKey}`,
    });
    expect(storage.deleteUploadSessionParts).not.toHaveBeenCalled();
    expect(uploadSessionMocks.cancelSession).toHaveBeenCalledWith(
      intent.sessionId,
      'running',
      auditMetadata,
    );
    expect(transfers.updateTransferInternal).not.toHaveBeenCalledWith(
      intent.transferId,
      { status: 'canceled' },
      null,
    );

    const nextIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Cancel.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-cancel',
    });
    expect(nextIntent.sessionId).not.toBe(intent.sessionId);
  });

  it('commits both cancellation states before storage cleanup can fail', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Cancel Cleanup Failure.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-cancel-cleanup-failure',
    });
    (storage.abortMultipartUpload as jest.Mock).mockRejectedValueOnce(
      new Error('storage cleanup unavailable'),
    );

    await expect(
      service.cancelUploadSession(intent.sessionId ?? ''),
    ).rejects.toThrow('storage cleanup unavailable');

    expect(uploadSessionMocks.cancelSession).toHaveBeenCalledWith(
      intent.sessionId,
      'running',
      undefined,
    );
    expect(
      uploadSessionMocks.cancelSession.mock.invocationCallOrder[0],
    ).toBeLessThan(
      (storage.abortMultipartUpload as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(transfers.updateTransferInternal).not.toHaveBeenCalledWith(
      intent.transferId,
      { status: 'canceled' },
      null,
    );
  });

  it('rejects upload completions with object keys outside the upload intent shape', async () => {
    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Customer Notes.pdf',
        objectKey: 'seed/workspace-default/roadmap.docx',
        sizeBytes: 4096,
        parentNodeId: undefined,
        owner: 'Workspace User',
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.assertObjectExists).not.toHaveBeenCalled();
  });

  it('requires upload completion to reference its server-created session', async () => {
    const intent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Session Required.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-session-required',
    });
    await service.completeUploadPart(intent.sessionId ?? '', 0, {
      eTag: '"etag-0"',
      sizeBytes: 4096,
    });

    await expect(
      service.completeUpload({
        workspaceId: 'workspace-default',
        fileName: 'Session Required.pdf',
        objectKey: intent.objectKey,
        sizeBytes: 4096,
        mimeType: 'application/pdf',
        transferId: intent.transferId,
      }),
    ).rejects.toThrow('Upload session is required');
  });

  it('does not allow another user to operate an upload session', async () => {
    const intent = await service.createUploadIntent(
      {
        workspaceId: 'workspace-default',
        fileName: 'Private Upload.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 4096,
        resumeKey: 'resume-private-upload',
      },
      { ownerUserId: 'user-a' },
    );

    await expect(
      service.completeUploadPart(
        intent.sessionId ?? '',
        0,
        { eTag: '"etag-0"', sizeBytes: 4096 },
        'user-b',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.cancelUploadSession(intent.sessionId ?? '', {
        ownerUserId: 'user-b',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
