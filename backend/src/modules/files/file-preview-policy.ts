import type { FileNodeKind } from './file-nodes.dto';

export type PreviewRenderMode =
  | 'image'
  | 'video'
  | 'pdf'
  | 'docx'
  | 'markdown'
  | 'text'
  | 'metadata'
  | 'download-only';

export type PreviewCapabilityReason =
  | 'previewable'
  | 'folder'
  | 'archive'
  | 'unknown-type'
  | 'too-large'
  | 'html-disabled'
  | 'missing-object';

export type FilePreviewCapability = {
  supported: boolean;
  renderMode: PreviewRenderMode;
  reason: PreviewCapabilityReason;
  maxPreviewBytes: number | null;
  sanitized: boolean;
  downloadOnly: boolean;
};

export type PreviewPolicyNode = {
  kind: FileNodeKind;
  mimeType: string;
  name: string;
  objectKey: string | null;
  sizeBytes: number | null;
};

export const PREVIEW_TEXT_MAX_BYTES = 1024 * 1024;
export const PREVIEW_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const PREVIEW_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

const markdownExtensions = new Set(['md', 'markdown']);
const textExtensions = new Set(['txt', 'json', 'csv', 'log', 'yaml', 'yml']);
const rasterImageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const rasterImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const videoExtensions = new Set(['mp4', 'webm', 'ogv']);
const videoMimeTypes = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const htmlLikeExtensions = new Set(['html', 'htm', 'xhtml', 'svg']);
const htmlLikeMimeTypes = new Set([
  'application/xhtml+xml',
  'image/svg+xml',
  'text/html',
]);
const docxMimeType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function resolveFilePreviewCapability(
  node: PreviewPolicyNode,
): FilePreviewCapability {
  const extension = getPreviewExtension(node.name);
  const mimeType = node.mimeType.toLowerCase();
  const sizeBytes = node.sizeBytes ?? 0;

  if (node.kind === 'folder') {
    return unsupported('folder', 'metadata', null);
  }

  if (!node.objectKey) {
    return unsupported('missing-object', 'metadata', null);
  }

  if (node.kind === 'archive') {
    return unsupported('archive', 'download-only', null);
  }

  if (htmlLikeExtensions.has(extension) || htmlLikeMimeTypes.has(mimeType)) {
    return unsupported(
      'html-disabled',
      'download-only',
      PREVIEW_TEXT_MAX_BYTES,
    );
  }

  if (markdownExtensions.has(extension)) {
    return previewableWithLimit({
      mode: 'markdown',
      sizeBytes,
      maxPreviewBytes: PREVIEW_TEXT_MAX_BYTES,
      sanitized: true,
    });
  }

  if (isTextPreviewType(mimeType, extension)) {
    return previewableWithLimit({
      mode: 'text',
      sizeBytes,
      maxPreviewBytes: PREVIEW_TEXT_MAX_BYTES,
      sanitized: false,
    });
  }

  if (
    rasterImageMimeTypes.has(mimeType) ||
    rasterImageExtensions.has(extension)
  ) {
    return previewableWithLimit({
      mode: 'image',
      sizeBytes,
      maxPreviewBytes: PREVIEW_MEDIA_MAX_BYTES,
      sanitized: false,
    });
  }

  if (videoMimeTypes.has(mimeType) || videoExtensions.has(extension)) {
    return previewableWithLimit({
      mode: 'video',
      sizeBytes,
      maxPreviewBytes: PREVIEW_MEDIA_MAX_BYTES,
      sanitized: false,
    });
  }

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return previewableWithLimit({
      mode: 'pdf',
      sizeBytes,
      maxPreviewBytes: PREVIEW_DOCUMENT_MAX_BYTES,
      sanitized: false,
    });
  }

  if (mimeType === docxMimeType || extension === 'docx') {
    return previewableWithLimit({
      mode: 'docx',
      sizeBytes,
      maxPreviewBytes: PREVIEW_DOCUMENT_MAX_BYTES,
      sanitized: true,
    });
  }

  return unsupported('unknown-type', 'download-only', null);
}

export function isTextContentEditable(node: PreviewPolicyNode) {
  const capability = resolveFilePreviewCapability(node);
  return (
    capability.supported &&
    (capability.renderMode === 'markdown' || capability.renderMode === 'text')
  );
}

export function getPreviewExtension(name: string) {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === name.length - 1) return '';
  return name.slice(dotIndex + 1).toLowerCase();
}

function isTextPreviewType(mimeType: string, extension: string) {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/x-ndjson' ||
    textExtensions.has(extension)
  );
}

function previewableWithLimit({
  maxPreviewBytes,
  mode,
  sanitized,
  sizeBytes,
}: {
  maxPreviewBytes: number;
  mode: PreviewRenderMode;
  sanitized: boolean;
  sizeBytes: number;
}) {
  if (sizeBytes > maxPreviewBytes) {
    return unsupported('too-large', 'download-only', maxPreviewBytes);
  }

  return {
    supported: true,
    renderMode: mode,
    reason: 'previewable',
    maxPreviewBytes,
    sanitized,
    downloadOnly: false,
  } satisfies FilePreviewCapability;
}

function unsupported(
  reason: PreviewCapabilityReason,
  renderMode: PreviewRenderMode,
  maxPreviewBytes: number | null,
) {
  return {
    supported: false,
    renderMode,
    reason,
    maxPreviewBytes,
    sanitized: false,
    downloadOnly: true,
  } satisfies FilePreviewCapability;
}
