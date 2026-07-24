import { createPreviewArtifactsRepository as createRepository } from './file-nodes.repository.spec-helpers';

describe('FilePreviewArtifactsRepository', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores canonical preview state while preserving the legacy response', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T00:01:00.000Z'));
    let capturedData: Record<string, unknown> | undefined;
    const repository = createRepository({
      previewArtifact: {
        create: jest.fn((input: { data: Record<string, unknown> }) => {
          capturedData = input.data;
          return Promise.resolve({
            ...input.data,
            createdAt: new Date('2026-07-18T00:00:00.000Z'),
            updatedAt: new Date('2026-07-18T00:00:00.000Z'),
          });
        }),
      },
    });

    const preview = await repository.createPreviewArtifact(
      {
        id: 'node-1',
        objectKey: 'uploads/node-1.html',
      } as never,
      'failed',
      'download-only',
      'HTML-like files are available for download only',
      {
        actorUserId: 'user-a',
        expiresAt: new Date('2026-07-18T00:05:00.000Z'),
        failureCode: 'PREVIEW_UNSUPPORTED',
      },
    );

    expect(capturedData).toMatchObject({
      actorUserId: 'user-a',
      status: 'failed',
      failureCode: 'PREVIEW_UNSUPPORTED',
    });
    expect(preview).toMatchObject({
      actorUserId: 'user-a',
      status: 'failed',
      legacyPreviewStatus: 'unsupported',
      lifecycle: {
        status: 'failed',
        errorCode: 'PREVIEW_UNSUPPORTED',
        retryable: false,
      },
    });
  });
});
