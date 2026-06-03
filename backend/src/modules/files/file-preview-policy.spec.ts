import {
  PREVIEW_DOCUMENT_MAX_BYTES,
  PREVIEW_MEDIA_MAX_BYTES,
  PREVIEW_TEXT_MAX_BYTES,
  isTextContentEditable,
  resolveFilePreviewCapability,
} from './file-preview-policy';

describe('file preview policy', () => {
  it('allows small markdown as sanitized previewable content', () => {
    const capability = resolveFilePreviewCapability({
      kind: 'doc',
      mimeType: 'text/markdown',
      name: 'release-notes.md',
      objectKey: 'objects/release-notes.md',
      sizeBytes: 32 * 1024,
    });

    expect(capability).toEqual({
      supported: true,
      renderMode: 'markdown',
      reason: 'previewable',
      maxPreviewBytes: PREVIEW_TEXT_MAX_BYTES,
      sanitized: true,
      downloadOnly: false,
    });
  });

  it('keeps html-like content on the download-only path', () => {
    expect(
      resolveFilePreviewCapability({
        kind: 'doc',
        mimeType: 'text/html',
        name: 'landing.html',
        objectKey: 'objects/landing.html',
        sizeBytes: 4096,
      }),
    ).toMatchObject({
      supported: false,
      renderMode: 'download-only',
      reason: 'html-disabled',
      downloadOnly: true,
    });

    expect(
      resolveFilePreviewCapability({
        kind: 'image',
        mimeType: 'image/svg+xml',
        name: 'badge.svg',
        objectKey: 'objects/badge.svg',
        sizeBytes: 4096,
      }),
    ).toMatchObject({
      supported: false,
      renderMode: 'download-only',
      reason: 'html-disabled',
    });
  });

  it('enforces preview size limits before text editing is allowed', () => {
    const node = {
      kind: 'doc' as const,
      mimeType: 'text/plain',
      name: 'large-log.txt',
      objectKey: 'objects/large-log.txt',
      sizeBytes: PREVIEW_TEXT_MAX_BYTES + 1,
    };

    expect(resolveFilePreviewCapability(node)).toMatchObject({
      supported: false,
      renderMode: 'download-only',
      reason: 'too-large',
      maxPreviewBytes: PREVIEW_TEXT_MAX_BYTES,
    });
    expect(isTextContentEditable(node)).toBe(false);
  });

  it('supports bounded raster image, video, pdf, and docx previews', () => {
    expect(
      resolveFilePreviewCapability({
        kind: 'image',
        mimeType: 'image/png',
        name: 'diagram.png',
        objectKey: 'objects/diagram.png',
        sizeBytes: PREVIEW_MEDIA_MAX_BYTES,
      }),
    ).toMatchObject({ supported: true, renderMode: 'image' });

    expect(
      resolveFilePreviewCapability({
        kind: 'video',
        mimeType: 'video/webm',
        name: 'demo.webm',
        objectKey: 'objects/demo.webm',
        sizeBytes: PREVIEW_MEDIA_MAX_BYTES,
      }),
    ).toMatchObject({ supported: true, renderMode: 'video' });

    expect(
      resolveFilePreviewCapability({
        kind: 'doc',
        mimeType: 'application/pdf',
        name: 'guide.pdf',
        objectKey: 'objects/guide.pdf',
        sizeBytes: PREVIEW_DOCUMENT_MAX_BYTES,
      }),
    ).toMatchObject({ supported: true, renderMode: 'pdf' });

    expect(
      resolveFilePreviewCapability({
        kind: 'doc',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: 'brief.docx',
        objectKey: 'objects/brief.docx',
        sizeBytes: PREVIEW_DOCUMENT_MAX_BYTES,
      }),
    ).toMatchObject({
      supported: true,
      renderMode: 'docx',
      sanitized: true,
    });
  });

  it('degrades folders, archives, missing objects, and unknown binaries', () => {
    expect(
      resolveFilePreviewCapability({
        kind: 'folder',
        mimeType: 'inode/directory',
        name: 'Product',
        objectKey: null,
        sizeBytes: null,
      }),
    ).toMatchObject({ reason: 'folder', renderMode: 'metadata' });

    expect(
      resolveFilePreviewCapability({
        kind: 'archive',
        mimeType: 'application/zip',
        name: 'bundle.zip',
        objectKey: 'objects/bundle.zip',
        sizeBytes: 1024,
      }),
    ).toMatchObject({ reason: 'archive', renderMode: 'download-only' });

    expect(
      resolveFilePreviewCapability({
        kind: 'doc',
        mimeType: 'application/pdf',
        name: 'missing.pdf',
        objectKey: null,
        sizeBytes: 1024,
      }),
    ).toMatchObject({ reason: 'missing-object', renderMode: 'metadata' });

    expect(
      resolveFilePreviewCapability({
        kind: 'doc',
        mimeType: 'application/octet-stream',
        name: 'binary.bin',
        objectKey: 'objects/binary.bin',
        sizeBytes: 1024,
      }),
    ).toMatchObject({ reason: 'unknown-type', renderMode: 'download-only' });
  });
});
