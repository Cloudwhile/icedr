import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import {
  createFileNodesServiceTestHarness,
  type FileNodesServiceTestHarness,
} from './file-upload-test-harness.helper';

describe('FileDownloadPreviewService', () => {
  let repository: FileNodesServiceTestHarness['repository'];
  let repositoryMocks: FileNodesServiceTestHarness['repositoryMocks'];
  let service: FileNodesServiceTestHarness['service'];
  let storage: FileNodesServiceTestHarness['storage'];

  beforeEach(() => {
    ({ repository, repositoryMocks, service, storage } =
      createFileNodesServiceTestHarness());
  });

  it('creates preview intents for known file nodes', async () => {
    const intent = await service.createPreviewIntent('roadmap');

    expect(intent.previewId).toBe('preview-test');
    expect(intent.status).toBe('completed');
    expect(intent.legacyPreviewStatus).toBe('ready');
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
      status: 'completed',
      legacyPreviewStatus: 'ready',
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
      status: 'failed',
      legacyPreviewStatus: 'unsupported',
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
      status: 'failed',
      legacyPreviewStatus: 'unsupported',
      renderMode: 'download-only',
      capability: {
        supported: false,
        reason: 'too-large',
        downloadOnly: true,
      },
      error: 'File is too large to preview',
    });
  });

  it('binds download purpose to the intent and streams through ICEDR', async () => {
    const previewIntent = await service.createDownloadIntent(
      'roadmap',
      { purpose: 'preview' },
      { auditMetadata: { ip: '203.0.113.7', userAgent: 'Test Browser' } },
    );

    expect(previewIntent).toMatchObject({
      lifecycle: { status: 'pending' },
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

  it('serializes concurrent downloads before opening storage', async () => {
    const intent = await service.createDownloadIntent('roadmap', {});

    const results = await Promise.allSettled([
      service.downloadFileNode('roadmap', intent.downloadId),
      service.downloadFileNode('roadmap', intent.downloadId),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(storage.openObjectStream).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.claimDownloadIntent).toHaveBeenCalledTimes(2);
  });

  it('marks preparation failures and allows the same intent to retry', async () => {
    const intent = await service.createDownloadIntent('roadmap', {});
    (storage.openObjectStream as jest.Mock).mockRejectedValueOnce(
      new Error('storage temporarily unavailable'),
    );

    await expect(
      service.downloadFileNode('roadmap', intent.downloadId),
    ).rejects.toThrow('storage temporarily unavailable');
    expect(repositoryMocks.failDownloadIntent).toHaveBeenCalledWith({
      claimToken: expect.stringMatching(/^claim_/) as unknown,
      downloadId: intent.downloadId,
      failureCode: 'DOWNLOAD_FAILED',
    });
    expect(repositoryMocks.commitDownloadIntent).not.toHaveBeenCalled();

    await expect(
      service.downloadFileNode('roadmap', intent.downloadId),
    ).resolves.toMatchObject({ method: 'stream', purpose: 'download' });
    expect(repositoryMocks.commitDownloadIntent).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.commitDownloadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        audit: expect.objectContaining({
          action: 'file.download_started',
          nodeId: 'roadmap',
        }) as unknown,
      }),
    );
  });

  it('destroys a prepared stream when the claim can no longer commit', async () => {
    const intent = await service.createDownloadIntent('roadmap', {});
    const stream = Readable.from(['test']);
    const destroy = jest.spyOn(stream, 'destroy');
    (storage.openObjectStream as jest.Mock).mockResolvedValueOnce({
      acceptRanges: 'bytes',
      contentLength: 4,
      contentRange: null,
      contentType: 'application/octet-stream',
      etag: null,
      lastModified: null,
      statusCode: 200,
      stream,
    });
    (repository.commitDownloadIntent as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      service.downloadFileNode('roadmap', intent.downloadId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.failDownloadIntent).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.recordAudit).not.toHaveBeenCalledWith(
      'file.download_started',
      expect.anything(),
      expect.anything(),
    );
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
    expect(intent).toMatchObject({ method: 'stream', purpose: 'download' });
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
    expect(download).toMatchObject({ method: 'stream', purpose: 'download' });
    expect(storage.openObjectStream).toHaveBeenLastCalledWith({
      objectKey: 'uploads/workspace-default/root/seed-roadmap-v1.docx',
      range: undefined,
    });
    await expect(
      service.downloadFileVersion('roadmap', 'version-1', intent.downloadId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
