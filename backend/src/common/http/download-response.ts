import { StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import {
  createAttachmentContentDisposition,
  createInlineContentDisposition,
} from '../security/file-name-policy';

type DownloadPurpose = 'download' | 'preview';

type StreamDownloadResponse = {
  acceptRanges: 'bytes';
  contentLength: number;
  contentRange: string | null;
  contentType: string;
  etag: string | null;
  filename: string;
  lastModified: Date | null;
  method: 'stream';
  purpose: DownloadPurpose;
  statusCode: 200 | 206;
  stream: Readable;
};

type ManifestDownloadResponse = {
  content: string;
  contentType: string;
  filename: string;
  method: 'manifest';
  purpose: DownloadPurpose;
};

export type DownloadResponsePayload =
  | ManifestDownloadResponse
  | StreamDownloadResponse;

export function writeDownloadResponse(
  download: DownloadResponsePayload,
  request: Request,
  response: Response,
) {
  setPrivateDownloadHeaders(download, response);
  if (download.method === 'manifest') {
    response.status(200);
    response.setHeader('Content-Length', Buffer.byteLength(download.content));
    return download.content;
  }

  response.status(download.statusCode);
  response.setHeader('Accept-Ranges', download.acceptRanges);
  response.setHeader('Content-Length', download.contentLength);
  if (download.contentRange) {
    response.setHeader('Content-Range', download.contentRange);
  }
  if (download.etag) response.setHeader('ETag', download.etag);
  if (download.lastModified) {
    response.setHeader('Last-Modified', download.lastModified.toUTCString());
  }
  attachStreamAbort(request, response, download.stream);
  return new StreamableFile(download.stream);
}

export function applyDownloadErrorHeaders(error: unknown, response: Response) {
  if (
    error &&
    typeof error === 'object' &&
    'contentRange' in error &&
    typeof error.contentRange === 'string'
  ) {
    response.setHeader('Content-Range', error.contentRange);
  }
}

function setPrivateDownloadHeaders(
  download: DownloadResponsePayload,
  response: Response,
) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Type', download.contentType);
  response.setHeader(
    'Content-Disposition',
    download.purpose === 'preview'
      ? createInlineContentDisposition(download.filename)
      : createAttachmentContentDisposition(download.filename),
  );
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (download.purpose === 'preview') {
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'",
    );
  }
}

function attachStreamAbort(
  request: Request,
  response: Response,
  stream: Readable,
) {
  const abort = () => {
    if (!response.writableEnded && !stream.destroyed) stream.destroy();
  };
  const cleanup = () => {
    request.off('aborted', abort);
    response.off('close', abort);
    stream.off('close', cleanup);
  };
  request.once('aborted', abort);
  response.once('close', abort);
  stream.once('close', cleanup);
}
