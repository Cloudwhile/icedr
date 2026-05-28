import { BadRequestException } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import {
  CompleteUploadDto,
  FileNodeResponse,
  PreviewIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import { FileNodesService } from './file-nodes.service';

describe('FileNodesService', () => {
  let repository: FileNodesRepository;
  let service: FileNodesService;
  let storage: Pick<
    StorageService,
    'createPresignedUpload' | 'assertObjectExists' | 'distributedStorageEnabled'
  >;
  let transfers: {
    createUploadTransfer: jest.Mock;
    completeTransfer: jest.Mock;
  };

  const seedNodes: FileNodeResponse[] = [
    {
      id: 'roadmap',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'ICEDR Roadmap.docx',
      kind: 'doc',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 284 * 1024,
      objectKey: 'uploads/workspace-default/root/seed-roadmap.docx',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  ];

  beforeEach(() => {
    const audits = new Map<string, number>();
    const nodes = [...seedNodes];
    repository = {
      list: jest.fn((workspaceId?: string) =>
        Promise.resolve(
          workspaceId
            ? nodes.filter((node) => node.workspaceId === workspaceId)
            : nodes,
        ),
      ),
      findById: jest.fn((id: string) =>
        Promise.resolve(nodes.find((node) => node.id === id) ?? null),
      ),
      completeUpload: jest.fn((dto: CompleteUploadDto) => {
        const node: FileNodeResponse = {
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
        };
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
            statusUrl: `/api/file-nodes/${node.id}/preview/status`,
            error: null,
          }),
      ),
      findPreviewArtifact: jest.fn((previewId: string) =>
        Promise.resolve({
          previewId,
          nodeId: 'roadmap',
          status: 'pending',
          previewType: 'doc',
          statusUrl: '/api/file-nodes/roadmap/preview/status',
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
            progress: 5,
            status: 'running',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }),
      ),
      completeTransfer: jest.fn(() => Promise.resolve()),
    };
    service = new FileNodesService(
      repository,
      storage as StorageService,
      transfers as never,
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
    });
    const node = await service.completeUpload({
      workspaceId: 'workspace-default',
      fileName: 'Customer Notes.pdf',
      objectKey: intent.objectKey,
      sizeBytes: 4096,
      parentNodeId: undefined,
      mimeType: 'application/pdf',
      transferId: intent.transferId,
    });

    expect(intent.uploadMethod).toBe('presigned-url');
    expect(intent.transferId).toBe('transfer-test');
    expect(intent.uploadUrl).toContain(intent.objectKey);
    expect(intent.objectKey).toMatch(
      /^uploads\/workspace-default\/root\/\d{10,}-[A-Za-z0-9_-]{16}-Customer%20Notes\.pdf$/,
    );
    expect(intent.headers).toHaveProperty('Content-Type');
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
    });

    expect(intent.uploadMethod).toBe('backend-local');
    expect(intent.transferId).toBe('transfer-test');
    expect(intent.objectKey).toMatch(/^local\/uploads\//);
    expect(intent.uploadUrl).toContain('/api/storage/local-uploads');
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
    expect(intent.status).toBe('pending');
    await expect(
      service.getPreviewStatus('roadmap', intent.previewId),
    ).resolves.toMatchObject({
      previewId: 'preview-test',
      status: 'pending',
    });
  });
});
