import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { StorageService } from '../storage/storage.service';
import {
  CompleteUploadDto,
  FileNodeSpaceScope,
  FileNodeResponse,
  PreviewIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import { FileNodesService } from './file-nodes.service';
import { resolveFilePreviewCapability } from './file-preview-policy';
import { getFileNameConflictKey } from '../../common/security/file-name-policy';
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
    | 'deleteObject'
    | 'deleteUploadSessionParts'
    | 'distributedStorageEnabled'
    | 'findMultipartUploadPart'
    | 'getConfiguredQuotaBytes'
    | 'openObjectStream'
    | 'writeUploadSessionPart'
  >;
  let transfers: {
    createUploadTransfer: jest.Mock;
    completeTransfer: jest.Mock;
    updateTransferInternal: jest.Mock;
  };
  let uploadSessions: UploadSessionsRepository;

  const docxMimeType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function createNode(
    input: Omit<
      FileNodeResponse,
      | 'archivedBy'
      | 'originalParentNodeId'
      | 'originalPath'
      | 'ownerUserId'
      | 'previewCapability'
      | 'spaceScope'
    > &
      Partial<
        Pick<
          FileNodeResponse,
          | 'archivedBy'
          | 'originalParentNodeId'
          | 'originalPath'
          | 'ownerUserId'
          | 'spaceScope'
        >
      >,
  ): FileNodeResponse {
    const node = {
      archivedBy: null,
      originalParentNodeId: null,
      originalPath: null,
      ownerUserId: null,
      spaceScope: 'workspace' as FileNodeSpaceScope,
      ...input,
    };
    return {
      ...node,
      previewCapability: resolveFilePreviewCapability(node),
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
    createNode({
      id: 'personal-a',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'Personal A.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey:
        'local/workspaces/workspace-default/users/user-a/personal-a.txt',
      owner: 'User A',
      ownerUserId: 'user-a',
      spaceScope: 'personal',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'personal-b',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'Personal B.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey:
        'local/workspaces/workspace-default/users/user-b/personal-b.txt',
      owner: 'User B',
      ownerUserId: 'user-b',
      spaceScope: 'personal',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'personal-folder-b',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'User B Folder',
      kind: 'folder',
      mimeType: 'inode/directory',
      sizeBytes: null,
      objectKey: null,
      owner: 'User B',
      ownerUserId: 'user-b',
      spaceScope: 'personal',
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
    const downloadIntents = new Map<
      string,
      {
        auditMetadata: Record<string, unknown>;
        consumedAt: string | null;
        createdAt: string;
        downloadId: string;
        expiresAt: string;
        filename: string;
        method: 'stream' | 'manifest';
        nodeId: string;
        purpose: 'download' | 'preview';
        useCount: number;
        versionId: string | null;
      }
    >();
    const nodes = [...seedNodes];
    const sessions = new Map<string, UploadSession>();
    const sessionParts = new Map<string, UploadSessionPart[]>();
    let sessionCounter = 0;
    repository = {
      list: jest.fn(
        (
          workspaceId?: string,
          parentNodeId?: string | null,
          state = 'active',
          filter: {
            ownerUserId?: string;
            spaceScope?: FileNodeSpaceScope;
          } = {},
        ) =>
          Promise.resolve(
            nodes.filter(
              (node) =>
                (!workspaceId || node.workspaceId === workspaceId) &&
                node.parentNodeId === (parentNodeId ?? null) &&
                (state !== 'active' || !node.archivedAt) &&
                node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                (!filter.ownerUserId ||
                  node.ownerUserId === filter.ownerUserId),
            ),
          ),
      ),
      getStorageUsage: jest.fn(
        (
          workspaceId: string,
          filter: {
            ownerUserId?: string;
            spaceScope?: FileNodeSpaceScope;
          } = {},
        ) =>
          Promise.resolve({
            activeBytes: nodes
              .filter(
                (node) =>
                  node.workspaceId === workspaceId &&
                  !node.archivedAt &&
                  node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                  (!filter.ownerUserId ||
                    node.ownerUserId === filter.ownerUserId),
              )
              .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
            defaultUserQuotaBytes: null,
            fileCount: nodes.filter(
              (node) =>
                node.workspaceId === workspaceId &&
                !node.archivedAt &&
                node.sizeBytes !== null &&
                node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                (!filter.ownerUserId ||
                  node.ownerUserId === filter.ownerUserId),
            ).length,
            folderCount: nodes.filter(
              (node) =>
                node.workspaceId === workspaceId &&
                !node.archivedAt &&
                node.sizeBytes === null &&
                node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                (!filter.ownerUserId ||
                  node.ownerUserId === filter.ownerUserId),
            ).length,
            quotaBytes: null,
            trashBytes: 0,
            trashFileCount: 0,
            usagePercent: null,
            usedBytes: nodes
              .filter(
                (node) =>
                  node.workspaceId === workspaceId &&
                  node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                  (!filter.ownerUserId ||
                    node.ownerUserId === filter.ownerUserId),
              )
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
          usedBytes: nodes
            .filter(
              (node) =>
                node.workspaceId === workspaceId &&
                node.spaceScope === 'personal' &&
                node.ownerUserId === userId,
            )
            .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
          userId,
          workspaceId,
        }),
      ),
      findById: jest.fn((id: string) =>
        Promise.resolve(nodes.find((node) => node.id === id) ?? null),
      ),
      findVersion: jest.fn((nodeId: string, versionId: string) =>
        Promise.resolve(
          nodeId === 'roadmap' && versionId === 'version-1'
            ? {
                id: 'version-1',
                nodeId: 'roadmap',
                versionNumber: 1,
                objectKey:
                  'uploads/workspace-default/root/seed-roadmap-v1.docx',
                sizeBytes: 1024,
                mimeType: docxMimeType,
                uploadedBy: 'Workspace User',
                remark: 'Initial version',
                createdAt: new Date(0).toISOString(),
              }
            : null,
        ),
      ),
      listVersions: jest.fn(() =>
        Promise.resolve([
          {
            id: 'version-1',
            nodeId: 'roadmap',
            versionNumber: 1,
            objectKey: 'uploads/workspace-default/root/seed-roadmap-v1.docx',
            sizeBytes: 1024,
            mimeType: docxMimeType,
            uploadedBy: 'Workspace User',
            remark: 'Initial version',
            createdAt: new Date(0).toISOString(),
          },
        ]),
      ),
      createDownloadIntent: jest.fn(
        (input: {
          auditMetadata?: Record<string, unknown>;
          filename: string;
          method: 'stream' | 'manifest';
          nodeId: string;
          purpose: 'download' | 'preview';
          versionId?: string | null;
        }) => {
          const downloadId = `fdl_test_${downloadIntents.size + 1}`;
          const intent = {
            auditMetadata: input.auditMetadata ?? {},
            consumedAt: null,
            createdAt: new Date().toISOString(),
            downloadId,
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            filename: input.filename,
            method: input.method,
            nodeId: input.nodeId,
            purpose: input.purpose,
            useCount: 0,
            versionId: input.versionId ?? null,
          };
          downloadIntents.set(downloadId, intent);
          return Promise.resolve(intent);
        },
      ),
      openDownloadIntent: jest.fn(
        (input: {
          downloadId: string;
          nodeId: string;
          versionId?: string | null;
        }) => {
          const intent = downloadIntents.get(input.downloadId);
          if (
            !intent ||
            intent.nodeId !== input.nodeId ||
            intent.versionId !== (input.versionId ?? null) ||
            new Date(intent.expiresAt).getTime() < Date.now() ||
            (intent.purpose === 'download' && intent.consumedAt)
          ) {
            return Promise.resolve(null);
          }
          intent.useCount += 1;
          if (intent.purpose === 'download') {
            intent.consumedAt = new Date().toISOString();
          }
          return Promise.resolve({ ...intent });
        },
      ),
      completeUpload: jest.fn(
        (
          dto: CompleteUploadDto & {
            conflictTargetNodeId?: string;
            ownerUserId?: string;
          },
        ) => {
          const targetIndex = dto.conflictTargetNodeId
            ? nodes.findIndex((node) => node.id === dto.conflictTargetNodeId)
            : nodes.findIndex(
                (node) =>
                  !node.archivedAt &&
                  node.workspaceId === dto.workspaceId &&
                  node.parentNodeId === (dto.parentNodeId ?? null) &&
                  node.spaceScope === (dto.spaceScope ?? 'workspace') &&
                  node.name === dto.fileName,
              );
          if (targetIndex >= 0 && nodes[targetIndex].objectKey) {
            const existing = nodes[targetIndex];
            const node = createNode({
              ...existing,
              name: dto.fileName,
              kind: 'doc',
              mimeType: dto.mimeType ?? 'application/octet-stream',
              sizeBytes: dto.sizeBytes,
              objectKey: dto.objectKey,
              owner: dto.owner ?? existing.owner,
              ownerUserId: dto.ownerUserId ?? existing.ownerUserId,
              updatedAt: new Date().toISOString(),
            });
            nodes[targetIndex] = node;
            return Promise.resolve(node);
          }
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
            ownerUserId: dto.ownerUserId ?? null,
            spaceScope: dto.spaceScope ?? 'workspace',
            starred: false,
            archivedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          nodes.push(node);
          return Promise.resolve(node);
        },
      ),
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
      findPreviewArtifact: jest.fn((previewId: string) => {
        const nodeId =
          previewId === 'preview-personal-b' ? 'personal-b' : 'roadmap';
        return Promise.resolve({
          previewId,
          nodeId,
          status: 'ready',
          previewType: 'docx',
          renderMode: 'docx',
          statusUrl: `/api/file-nodes/${nodeId}/preview/status`,
          capability: seedNodes[0].previewCapability,
          error: null,
        });
      }),
      copyTree: jest.fn(
        (
          source: FileNodeResponse,
          input: { name: string; parentNodeId: string | null },
        ) => {
          const node = createNode({
            ...source,
            id: `copy_${nodes.length + 1}`,
            name: input.name,
            parentNodeId: input.parentNodeId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          nodes.push(node);
          return Promise.resolve(node);
        },
      ),
      recordAudit: jest.fn((action: string) => {
        audits.set(action, (audits.get(action) ?? 0) + 1);
        return Promise.resolve();
      }),
      pruneVersions: jest.fn(() => Promise.resolve([])),
      countAuditEvents: jest.fn((action: string) =>
        Promise.resolve(audits.get(action) ?? 0),
      ),
    } as unknown as FileNodesRepository;
    storage = {
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
    } as unknown as StorageService;
    transfers = {
      createUploadTransfer: jest.fn(
        (input: { workspaceId: string; objectKey: string; name: string }) =>
          Promise.resolve({
            id: 'transfer-test',
            workspaceId: input.workspaceId,
            ownerUserId: null,
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
      updateTransferInternal: jest.fn(() => Promise.resolve()),
    };
    uploadSessions = {
      create: jest.fn(
        (input: Parameters<UploadSessionsRepository['create']>[0]) => {
          const session: UploadSession = {
            id: `upload-session-test-${++sessionCounter}`,
            transferId: input.transferId,
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId ?? null,
            spaceScope: input.spaceScope ?? 'workspace',
            conflictStrategy: input.conflictStrategy,
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
              item.ownerUserId === (input.ownerUserId ?? null) &&
              item.spaceScope === (input.spaceScope ?? 'workspace') &&
              item.conflictStrategy === input.conflictStrategy &&
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

  it('keeps repeated generated copy names unique and within the byte limit', async () => {
    const sourceName = `${'界'.repeat(83)}ab.txt`;
    expect(Buffer.byteLength(sourceName, 'utf8')).toBe(255);
    const source = createNode({
      id: 'long-name-source',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: sourceName,
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey: 'uploads/workspace-default/root/long-name-source.txt',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    jest.spyOn(repository, 'findById').mockResolvedValue(source);

    const first = await service.copyFileNode(source.id, {});
    const second = await service.copyFileNode(source.id, {});

    for (const copy of [first, second]) {
      expect(copy.name.endsWith('.txt')).toBe(true);
      expect(Buffer.byteLength(copy.name, 'utf8')).toBeLessThanOrEqual(255);
    }
    expect(
      new Set([first.name, second.name].map(getFileNameConflictKey)).size,
    ).toBe(2);
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
    await expect(
      repository.countAuditEvents('file.upload_intent_created'),
    ).resolves.toBe(1);
    await expect(
      repository.countAuditEvents('file.upload_completed'),
    ).resolves.toBe(1);
  });

  it('continues multipart uploads when the transfer progress task is gone', async () => {
    transfers.updateTransferInternal.mockRejectedValueOnce(
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
      expect.objectContaining({
        name: 'icedr roadmap (2).docx',
      }),
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
    ).resolves.toMatchObject({
      transferId: 'transfer-test',
    });
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
    expect(transfers.updateTransferInternal).toHaveBeenCalledWith(
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
    await expect(
      service.getPreviewStatus('personal-b', 'preview-personal-b', {
        actorRole: 'member',
        actorUserId: 'user-a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it('prevents member IDOR across personal spaces', async () => {
    const memberAccess = { actorRole: 'member', actorUserId: 'user-a' };

    await expect(
      service.getFileNode('personal-b', memberAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createDownloadIntent('personal-b', {}, memberAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.renameFileNode(
        'personal-b',
        { name: 'Stolen.txt' },
        memberAccess,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createFolder({
        workspaceId: 'workspace-default',
        name: 'Injected Folder',
        parentNodeId: 'personal-folder-b',
        spaceScope: 'personal',
        ownerUserId: 'user-a',
        ...memberAccess,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.getFileNode('personal-b', {
        actorRole: 'admin',
        actorUserId: 'admin-user',
      }),
    ).resolves.toMatchObject({ id: 'personal-b' });
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

  it('binds download purpose to the intent and streams through ICEDR', async () => {
    const previewIntent = await service.createDownloadIntent(
      'roadmap',
      { purpose: 'preview' },
      { auditMetadata: { ip: '203.0.113.7', userAgent: 'Test Browser' } },
    );

    expect(previewIntent).toMatchObject({
      method: 'stream',
      purpose: 'preview',
    });
    expect(previewIntent.downloadUrl).not.toContain('purpose=');
    const preview = await service.downloadFileNode(
      'roadmap',
      previewIntent.downloadId,
      {
        auditMetadata: { ip: '203.0.113.7', userAgent: 'Test Browser' },
        range: 'bytes=0-3',
      },
    );
    expect(preview).toMatchObject({
      method: 'stream',
      purpose: 'preview',
      contentLength: 4,
      contentRange: 'bytes 0-3/10',
    });
    expect(preview).not.toHaveProperty('redirectUrl');
    expect(storage.openObjectStream).toHaveBeenCalledWith({
      objectKey: 'uploads/workspace-default/root/seed-roadmap.docx',
      range: 'bytes=0-3',
    });

    const downloadIntent = await service.createDownloadIntent('roadmap', {});
    await expect(
      service.downloadFileNode('roadmap', downloadIntent.downloadId),
    ).resolves.toMatchObject({ method: 'stream', purpose: 'download' });
    await expect(
      service.downloadFileNode('roadmap', downloadIntent.downloadId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not issue preview streams for download-only file types', async () => {
    await expect(
      service.createDownloadIntent('unsafe-html', { purpose: 'preview' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps version object keys behind an ICEDR download endpoint', async () => {
    const versions = await service.listFileVersions('roadmap');
    expect(versions).toHaveLength(1);
    expect(versions[0]).not.toHaveProperty('objectKey');

    const intent = await service.createVersionDownloadIntent(
      'roadmap',
      'version-1',
      { auditMetadata: { ip: '203.0.113.7', userAgent: 'Test Browser' } },
    );
    expect(intent).toMatchObject({
      method: 'stream',
      purpose: 'download',
    });
    expect(intent.downloadUrl).toBe(
      `/api/file-nodes/roadmap/versions/version-1/download?downloadId=${encodeURIComponent(intent.downloadId)}`,
    );
    expect(intent.downloadUrl).not.toContain('uploads/');

    const download = await service.downloadFileVersion(
      'roadmap',
      'version-1',
      intent.downloadId,
      {
        auditMetadata: { ip: '203.0.113.7', userAgent: 'Test Browser' },
      },
    );
    expect(download).toMatchObject({
      method: 'stream',
      purpose: 'download',
    });
    expect(storage.openObjectStream).toHaveBeenLastCalledWith({
      objectKey: 'uploads/workspace-default/root/seed-roadmap-v1.docx',
      range: undefined,
    });
    await expect(
      service.downloadFileVersion('roadmap', 'version-1', intent.downloadId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves the oversized text edit error message', async () => {
    await expect(service.getFileNodeContent('large-log')).rejects.toThrow(
      'File is too large to edit as text',
    );
  });
});
