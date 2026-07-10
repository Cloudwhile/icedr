import { StreamableFile } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { RangeNotSatisfiableException } from '../../modules/storage/object-byte-range';
import {
  applyDownloadErrorHeaders,
  writeDownloadResponse,
} from './download-response';

describe('writeDownloadResponse', () => {
  function createHttpDoubles() {
    const request = new EventEmitter();
    const response = new EventEmitter() as EventEmitter & {
      setHeader: jest.Mock;
      status: jest.Mock;
      writableEnded: boolean;
    };
    response.setHeader = jest.fn();
    response.status = jest.fn(() => response);
    response.writableEnded = false;
    return { request, response };
  }

  it('writes a private partial preview response without redirecting', () => {
    const { request, response } = createHttpDoubles();
    const stream = Readable.from(['test']);

    const result = writeDownloadResponse(
      {
        acceptRanges: 'bytes',
        contentLength: 4,
        contentRange: 'bytes 0-3/10',
        contentType: 'text/plain',
        etag: '"etag"',
        filename: '测试.txt',
        lastModified: new Date('2026-07-11T00:00:00.000Z'),
        method: 'stream',
        purpose: 'preview',
        statusCode: 206,
        stream,
      },
      request as never,
      response as never,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect((result as StreamableFile).getStream()).toBe(stream);
    expect(response.status).toHaveBeenCalledWith(206);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('inline;'),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes 0-3/10',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Referrer-Policy',
      'no-referrer',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
  });

  it('destroys the upstream stream when the client aborts', () => {
    const { request, response } = createHttpDoubles();
    const stream = new Readable({ read() {} });
    const destroy = jest.spyOn(stream, 'destroy');
    writeDownloadResponse(
      {
        acceptRanges: 'bytes',
        contentLength: 10,
        contentRange: null,
        contentType: 'application/octet-stream',
        etag: null,
        filename: 'download.bin',
        lastModified: null,
        method: 'stream',
        purpose: 'download',
        statusCode: 200,
        stream,
      },
      request as never,
      response as never,
    );

    request.emit('aborted');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('writes the object size for an unsatisfied range', () => {
    const { response } = createHttpDoubles();

    applyDownloadErrorHeaders(
      new RangeNotSatisfiableException(10),
      response as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes */10',
    );
  });
});
