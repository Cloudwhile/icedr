import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { StorageService } from '../storage/storage.service';
import {
  CompleteUploadDto,
  FileNodeResponse,
  PreviewIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import { FileNodesService } from './file-nodes.service';
import { resolveFilePreviewCapability } from './file-preview-policy';
import {
  UploadSession,
  UploadSessionPart,
  UploadSessionsRepository,
} from './upload-sessions.repository';

describe('FileNodesService', () => {
  let repository: FileNodesRepository;
  let service: FileNodesService;
  let storage: Pick<
    StorageService,
    | 'abortMultipartUpload'
    | 'assertObjectExists'
    | 'composeUploadSessionParts'
    | 'completeMultipartUpload'
    | 'createMultipartUpload'
    | 'createMultipartUploadPartUrl'
    | 'createPresignedUpload'
    | 'deleteUploadSessionParts'
    | 'distributedStorageEnabled'
    | 'findMultipartUploadPart'
    | 'writeUploadSessionPart'
  >;
  let transfers: {
    createUploadTransfer: jest.Mock;
    completeTransfer: jest.Mock;
    updateTransfer: jest.Mock;
  };
  let uploadSessions: UploadSessionsRepository;

  const docxMimeType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function createNode(
    input: Omit<FileNodeResponse, 'previewCapability'>,
  ): FileNodeResponse {
    return {
      ...input,
      previewCapability: resolveFilePreviewCapability(input),
    };
  }

  const seedNodes: FileNodeResponse[] = [
    createNode({
      id: 'roadmap',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'ICEDR Roadmap.docx',
      kind: 'doc',
      mimeType: docxMimeType,
      sizeBytes: 284 * 1024,
      objectKey: 'uploads/workspace-default/root/seed-roadmap.docx',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'unsafe-html',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'unsafe.html',
      kind: 'doc',
      mimeType: 'text/html',
      sizeBytes: 4096,
      objectKey: 'uploads/workspace-default/root/unsafe.html',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'large-log',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'large.log',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 1024 * 1024 + 1,
      objectKey: 'uploads/workspace-default/root/large.log',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
  ];

  async function readStreamSize(stream: Readable) {
    let sizeBytes = 0;
    for await (const chunk of stream) {
      sizeBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk));
    }
    return sizeBytes;
  }

  beforeEach(() => {
    const audits = new Map<string, number>();
    const nodes = [...seedNodes];
    const sessions = new Map<string, UploadSession>();
    const sessionParts = new Map<string, UploadSessionPart[]>();
    let sessionCounter = 0;
    repository = {
      list: jest.fn((workspaceId?: string) =>
        Promise.resolve(
          workspaceId
            ? nodes.filter((node) => node.workspaceId === workspaceId)
            : nodes,
        ),
      ),
      getStorageUsage: jest.fn((workspaceId: string) =>
        Promise.resolve({
          activeBytes: nodes
            .filter(
              (node) => node.workspaceId === workspaceId && !node.archivedAt,
            )
            .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
          defaultUserQuotaBytes: null,
          fileCount: nodes.filter(
            (node) =>
              node.workspaceId === workspaceId &&
              !node.archivedAt &&
              node.sizeBytes !== null,
          ).length,
          folderCount: nodes.filter(
            (node) =>
              node.workspaceId === workspaceId &&
              !node.archivedAt &&
              node.sizeBytes === null,
          ).length,
          quotaBytes: null,
          trashBytes: 0,
          trashFileCount: 0,
          usagePercent: null,
          usedBytes: nodes
            .filter((node) => node.workspaceId === workspaceId)
            .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
          versionBytes: 0,
          versionCount: 0,
          workspaceId,
          updatedAt: new Date(0).toISOString(),
        }),
      ),
      getUserStorageUsage: jest.fn((workspaceId: string, userId: string) =>
        Promise.resolve({
          defaultUserQuotaBytes: null,
          quotaBytes: null,
          usedBytes: 0,
          userId,
          workspaceId,
        }),
      ),
      findById: jest.fn((id: string) =>
        Promise.resolve(nodes.find((node) => node.id === id) ?? null),
      ),
      completeUpload: jest.fn((dto: CompleteUploadDto) => {
        const node = createNode({
          id: `node_${nodes.length + 1}`,
          workspaceId: dto.workspaceId,
          parentNodeId: dto.parentNodeId ?? null,
          name: dto.fileName,
          kind: 'doc',
          mimeType: dto.mimeType ?? 'application/octet-stream',
          sizeBytes: dto.sizeBytes,
          objectKey: dto.objectKey,
          owner: dto.owner ?? 'Workspace User',
          starred: false,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        nodes.push(node);
        return Promise.resolve(node);
      }),
      createPreviewArtifact: jest.fn(
        (
          node: FileNodeResponse,
          status: PreviewIntentResponse['status'],
          previewType: PreviewIntentResponse['previewType'],
        ) =>
          Promise.resolve({
            previewId: 'preview-test',
            nodeId: node.id,
            status,
            previewType,
            renderMode: previewType as PreviewIntentResponse['renderMode'],
            statusUrl: `/api/file-nodes/${node.id}/preview/status`,
            capability: node.previewCapability,
            error: null,
          }),
      ),
      findPreviewArtifact: jest.fn((previewId: string) =>
        Promise.resolve({
          previewId,
          nodeId: 'roadmap',
          status: 'ready',
          previewType: 'docx',
          renderMode: 'docx',
          statusUrl: '/api/file-nodes/roadmap/preview/status',
          capability: seedNodes[0].previewCapability,
          error: null,
        }),
      ),
      recordAudit: jest.fn((action: string) => {
        audits.set(action, (audits.get(action) ?? 0) + 1);
        return Promise.resolve();
      }),
      countAuditEvents: jest.fn((action: string) =>
        Promise.resolve(audits.get(action) ?? 0),
      ),
    } as unknown as FileNodesRepository;
    storage = {
      distributedStorageEnabled: jest.fn(() => Promise.resolve(true)),
      createPresignedUpload: jest.fn((key: string) => ({
        key,
        bucket: 'icedr-drive',
        method: 'PUT',
        url: `s3://icedr-drive/${key}`,
        headers: {
          'Content-Type': 'application/pdf',
        },
        expiresInSeconds: 900,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      })),
      assertObjectExists: jest.fn(() => Promise.resolve()),
      composeUploadSessionParts: jest.fn(() =>
        Promise.resolve({ objectKey: 'composed', stored: true }),
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
    } as unknown as StorageService;
    transfers = {
      createUploadTransfer: jest.fn(
        (input: { workspaceId: string; objectKey: string; name: string }) =>
          Promise.resolve({
            id: 'transfer-test',
            workspaceId: input.workspaceId,
            objectKey: input.objectKey,
            nodeId: null,
            name: input.name,
            type: 'upload',
            progress: 0,
            status: 'running',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
      ),
      completeTransfer: jest.fn(() => Promise.resolve()),
      updateTransfer: jest.fn(() => Promise.resolve()),
    };
    uploadSessions = {
      create: jest.fn(
        (input: Parameters<UploadSessionsRepository['create']>[0]) => {
          const session: UploadSession = {
            id: `upload-session-test-${++sessionCounter}`,
            transferId: input.transferId,
            workspaceId: input.workspaceId,
            objectKey: input.objectKey,
            multipartUploadId: input.multipartUploadId ?? null,
            resumeKey: input.resumeKey ?? null,
            fileName: input.fileName,
            parentNodeId: input.parentNodeId ?? null,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            chunkSizeBytes: input.chunkSizeBytes,
            status: 'running',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          };
          sessions.set(session.id, session);
          return Promise.resolve(session);
        },
      ),
      findReusable: jest.fn(
        (input: Parameters<UploadSessionsRepository['findReusable']>[0]) => {
          const session = Array.from(sessions.values()).find(
            (item) =>
              item.workspaceId === input.workspaceId &&
              item.resumeKey === input.resumeKey &&
              item.fileName === input.fileName &&
              item.parentNodeId === (input.parentNodeId ?? null) &&
              item.sizeBytes === input.sizeBytes &&
              ['running', 'paused', 'failed'].includes(item.status),
          );
          return Promise.resolve(session ?? null);
        },
      ),
      findById: jest.fn((id: string) =>
        Promise.resolve(sessions.get(id) ?? null),
      ),
      listParts: jest.fn((sessionId: string) =>
        Promise.resolve([...(sessionParts.get(sessionId) ?? [])]),
      ),
      upsertPart: jest.fn(
        (input: Parameters<UploadSessionsRepository['upsertPart']>[0]) => {
          const part: UploadSessionPart = {
            sessionId: input.sessionId,
            partIndex: input.partIndex,
            startByte: input.startByte,
            endByte: input.endByte,
            sizeBytes: input.sizeBytes,
            eTag: input.eTag ?? null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          };
          const parts = (sessionParts.get(input.sessionId) ?? []).filter(
            (item) => item.partIndex !== input.partIndex,
          );
          parts.push(part);
          parts.sort((left, right) => left.partIndex - right.partIndex);
          sessionParts.set(input.sessionId, parts);
          return Promise.resolve(part);
        },
      ),
      updateStatus: jest.fn((id: string, status: UploadSession['status']) => {
        const session = sessions.get(id);
        if (!session) return Promise.resolve(null);
        const updated = {
          ...session,
          status,
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      }),
    } as unknown as UploadSessionsRepository;
    service = new FileNodesService(
      repository,
      storage as StorageService,
      transfers as never,
      uploadSessions,
    );
  });

  it('lists file nodes from the repository', async () => {
    const nodes = await service.listFileNodes('workspace-default');

    expect(nodes.some((node) => node.id === 'roadmap')).toBe(true);
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
      /^workspaces\/workspace-default\/objects\/original\/\d{4}\/\d{2}\/[A-Za-z0-9_-]{16}\/Customer%20Notes\.pdf$/,
    );
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
    expect(storage.assertObjectExists).toHaveBeenCalledWith(intent.objectKey);
    expect(node.id).toMatch(/^node_/);
    expect(node.objectKey).toBe(intent.objectKey);
    expect(node.owner).toBe('Workspace User');
    expect(node.kind).toBe('doc');
    expect(transfers.completeTransfer).toHaveBeenCalledWith({
      transferId: 'transfer-test',
      nodeId: node.id,
    });
    await expect(
      repository.countAuditEvents('file.upload_intent_created'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('file.upload_completed'),
    ).resolves.toBe(1);
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

    await expect(
      service.cancelUploadSession(intent.sessionId ?? ''),
    ).resolves.toEqual({ ok: true });
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      objectKey: intent.objectKey,
      uploadId: `multipart-${intent.objectKey}`,
    });
    expect(storage.deleteUploadSessionParts).not.toHaveBeenCalled();
    expect(transfers.updateTransfer).toHaveBeenCalledWith(intent.transferId, {
      status: 'canceled',
    });

    const nextIntent = await service.createUploadIntent({
      workspaceId: 'workspace-default',
      fileName: 'Cancel.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 4096,
      resumeKey: 'resume-cancel',
    });
    expect(nextIntent.sessionId).not.toBe(intent.sessionId);
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

  it('creates preview intents for known file nodes', async () => {
    const intent = await service.createPreviewIntent('roadmap');

    expect(intent.previewId).toBe('preview-test');
    expect(intent.status).toBe('ready');
    expect(intent.renderMode).toBe('docx');
    expect(intent.capability).toMatchObject({
      supported: true,
      renderMode: 'docx',
      sanitized: true,
    });
    await expect(
      service.getPreviewStatus('roadmap', intent.previewId),
    ).resolves.toMatchObject({
      previewId: 'preview-test',
      status: 'ready',
      renderMode: 'docx',
    });
  });

  it('degrades unsafe or oversized preview intents to download-only', async () => {
    await expect(
      service.createPreviewIntent('unsafe-html'),
    ).resolves.toMatchObject({
      status: 'unsupported',
      renderMode: 'download-only',
      capability: {
        supported: false,
        reason: 'html-disabled',
        downloadOnly: true,
      },
      error: 'HTML-like files are available for download only',
    });

    await expect(
      service.createPreviewIntent('large-log'),
    ).resolves.toMatchObject({
      status: 'unsupported',
      renderMode: 'download-only',
      capability: {
        supported: false,
        reason: 'too-large',
        downloadOnly: true,
      },
      error: 'File is too large to preview',
    });
  });

  it('preserves the oversized text edit error message', async () => {
    await expect(service.getFileNodeContent('large-log')).rejects.toThrow(
      'File is too large to edit as text',
    );
  });
});
