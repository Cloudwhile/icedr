import { createHash } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { createStorageTestContext } from './storage-settings-usage.spec-helper';
import { Readable } from 'stream';
import type { StorageObjectService } from './storage-object.service';
import { StorageIntegrityService } from './storage-integrity.service';

describe('StorageIntegrityService', () => {
  it('streams an object once to calculate its SHA-256 checksum and byte size without trusting ETag', async () => {
    const content = Buffer.from('完整性校验内容', 'utf8');
    const openObjectStream = jest.fn().mockResolvedValue({
      acceptRanges: 'bytes',
      contentLength: content.length,
      contentRange: null,
      contentType: 'application/octet-stream',
      etag: 'this-is-not-a-checksum',
      lastModified: null,
      statusCode: 200,
      stream: Readable.from([content.subarray(0, 5), content.subarray(5)]),
    });
    const service = new StorageIntegrityService({
      openObjectStream,
    } as unknown as StorageObjectService);

    await expect(
      service.verifyObject({
        objectKey: 'local/workspace/file.bin',
        expectedSizeBytes: content.length,
      }),
    ).resolves.toMatchObject({
      checksumAlgorithm: 'sha256',
      actualChecksum: createHash('sha256').update(content).digest('hex'),
      actualSizeBytes: content.length,
      integrityStatus: 'verified',
      verificationFailureCode: null,
      lastVerifiedAt: expect.any(Date) as unknown,
    });
    expect(openObjectStream).toHaveBeenCalledWith({
      objectKey: 'local/workspace/file.bin',
    });
  });

  it('classifies an object that cannot be opened because it is missing', async () => {
    const service = new StorageIntegrityService({
      openObjectStream: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Stored object not found')),
    } as unknown as StorageObjectService);

    await expect(
      service.verifyObject({
        objectKey: 'local/workspace/missing.bin',
        expectedSizeBytes: 10,
      }),
    ).resolves.toMatchObject({
      checksumAlgorithm: 'sha256',
      actualChecksum: null,
      actualSizeBytes: null,
      integrityStatus: 'failed',
      verificationFailureCode: 'missing-object',
    });
  });

  it('classifies a streamed object whose actual byte size differs from metadata', async () => {
    const content = Buffer.from('actual bytes');
    const service = new StorageIntegrityService({
      openObjectStream: jest.fn().mockResolvedValue({
        etag: 'ignored',
        stream: Readable.from([content]),
      }),
    } as unknown as StorageObjectService);

    await expect(
      service.verifyObject({
        objectKey: 'remote/file.bin',
        expectedSizeBytes: content.length + 1,
      }),
    ).resolves.toMatchObject({
      actualChecksum: createHash('sha256').update(content).digest('hex'),
      actualSizeBytes: content.length,
      integrityStatus: 'mismatch',
      verificationFailureCode: 'size-mismatch',
    });
  });

  it('classifies a same-sized object whose SHA-256 checksum differs from metadata', async () => {
    const content = Buffer.from('same sized object');
    const service = new StorageIntegrityService({
      openObjectStream: jest.fn().mockResolvedValue({
        etag: createHash('sha256').update(content).digest('hex'),
        stream: Readable.from([content]),
      }),
    } as unknown as StorageObjectService);

    await expect(
      service.verifyObject({
        objectKey: 'remote/file.bin',
        expectedSizeBytes: content.length,
        checksumAlgorithm: 'sha256',
        checksumValue: '0'.repeat(64),
      }),
    ).resolves.toMatchObject({
      actualChecksum: createHash('sha256').update(content).digest('hex'),
      actualSizeBytes: content.length,
      integrityStatus: 'mismatch',
      verificationFailureCode: 'checksum-mismatch',
    });
  });

  it('returns a sanitized verification failure and destroys the stream when reading fails', async () => {
    const stream = Readable.from(
      (async function* () {
        await new Promise<void>((resolve) => setImmediate(resolve));
        yield Buffer.from('partial');
        throw new Error('sensitive storage failure');
      })(),
    );
    const destroy = jest.spyOn(stream, 'destroy');
    const service = new StorageIntegrityService({
      openObjectStream: jest.fn().mockResolvedValue({ stream }),
    } as unknown as StorageObjectService);

    await expect(
      service.verifyObject({
        objectKey: 'remote/file.bin',
        expectedSizeBytes: 100,
      }),
    ).resolves.toMatchObject({
      actualChecksum: null,
      actualSizeBytes: null,
      integrityStatus: 'failed',
      verificationFailureCode: 'verification-failed',
    });
    expect(destroy).toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it('awaits a shared bandwidth hook for every streamed chunk', async () => {
    const consumed: number[] = [];
    const content = [Buffer.from('abc'), Buffer.from('de')];
    const service = new StorageIntegrityService({
      openObjectStream: jest.fn().mockResolvedValue({
        stream: Readable.from(content),
      }),
    } as unknown as StorageObjectService);

    const result = await service.verifyObject({
      objectKey: 'remote/file.bin',
      expectedSizeBytes: 5,
      onBytes: async (count) => {
        await Promise.resolve();
        consumed.push(count);
      },
    });

    expect(consumed).toEqual([3, 2]);
    expect(result.integrityStatus).toBe('verified');
  });

  it('cancels an active verification by destroying its stream', async () => {
    const controller = new AbortController();
    const stream = new Readable({ read: () => undefined });
    stream.push(Buffer.from('partial'));
    const destroy = jest.spyOn(stream, 'destroy');
    const openObjectStream = jest.fn().mockResolvedValue({ stream });
    const service = new StorageIntegrityService({
      openObjectStream,
    } as unknown as StorageObjectService);

    const verification = service.verifyObject({
      objectKey: 'remote/file.bin',
      expectedSizeBytes: 100,
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(verification).rejects.toMatchObject({ name: 'AbortError' });
    expect(openObjectStream).toHaveBeenCalledWith({
      objectKey: 'remote/file.bin',
      signal: controller.signal,
    });
    expect(destroy).toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it('records verification time after the object stream has finished', async () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-08-13T10:00:00.000Z');
    const finishedAt = new Date('2026-08-13T10:01:00.000Z');
    jest.setSystemTime(startedAt);
    const service = new StorageIntegrityService({
      openObjectStream: jest.fn().mockResolvedValue({
        stream: Readable.from([Buffer.from('content')]),
      }),
    } as unknown as StorageObjectService);

    try {
      const result = await service.verifyObject({
        objectKey: 'remote/file.bin',
        expectedSizeBytes: 7,
        onBytes: () => {
          jest.setSystemTime(finishedAt);
          return Promise.resolve();
        },
      });

      expect(result.lastVerifiedAt).toEqual(finishedAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects an unsupported baseline algorithm without reading the object', async () => {
    const openObjectStream = jest.fn();
    const service = new StorageIntegrityService({
      openObjectStream,
    } as unknown as StorageObjectService);

    await expect(
      service.verifyObject({
        objectKey: 'remote/file.bin',
        expectedSizeBytes: 10,
        checksumAlgorithm: 'md5',
        checksumValue: '0'.repeat(32),
      }),
    ).resolves.toMatchObject({
      actualChecksum: null,
      actualSizeBytes: null,
      integrityStatus: 'failed',
      verificationFailureCode: 'verification-failed',
    });
    expect(openObjectStream).not.toHaveBeenCalled();
  });

  it('verifies a chunked S3 response through the storage adapter without using its multipart ETag', async () => {
    const content = Buffer.from('chunked S3 content');
    const { objectStorage } = createStorageTestContext();
    const send = jest.fn((command: GetObjectCommand) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      return Promise.resolve({
        Body: Readable.from([content.subarray(0, 4), content.subarray(4)]),
        ContentLength: content.length,
        ETag: '"multipart-etag-2"',
      });
    });
    jest
      .spyOn(
        objectStorage as unknown as {
          createClient: () => { send: typeof send };
        },
        'createClient',
      )
      .mockReturnValue({ send });
    const service = new StorageIntegrityService(objectStorage);

    await expect(
      service.verifyObject({
        objectKey: 'workspace/file.bin',
        expectedSizeBytes: content.length,
      }),
    ).resolves.toMatchObject({
      actualChecksum: createHash('sha256').update(content).digest('hex'),
      integrityStatus: 'verified',
    });
  });

  it('verifies a real local object stream through the storage adapter', async () => {
    const content = Buffer.from('real local content');
    const objectKey = 'local/workspace/integrity/local.bin';
    const filePath =
      'backend/.tmp/storage-service-spec-local-files/workspace/integrity/local.bin';
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    const { objectStorage } = createStorageTestContext();

    try {
      await expect(
        new StorageIntegrityService(objectStorage).verifyObject({
          objectKey,
          expectedSizeBytes: content.length,
        }),
      ).resolves.toMatchObject({
        actualChecksum: createHash('sha256').update(content).digest('hex'),
        actualSizeBytes: content.length,
        integrityStatus: 'verified',
      });
    } finally {
      await rm('backend/.tmp/storage-service-spec-local-files', {
        force: true,
        recursive: true,
      });
    }
  });

  it('sanitizes an interrupted S3 response stream through the storage adapter', async () => {
    const { objectStorage } = createStorageTestContext();
    const stream = Readable.from(
      (async function* () {
        await new Promise<void>((resolve) => setImmediate(resolve));
        yield Buffer.from('partial');
        throw new Error('sensitive S3 socket error');
      })(),
    );
    const send = jest.fn().mockResolvedValue({
      Body: stream,
      ContentLength: 100,
      ETag: '"opaque"',
    });
    jest
      .spyOn(
        objectStorage as unknown as {
          createClient: () => { send: typeof send };
        },
        'createClient',
      )
      .mockReturnValue({ send });

    await expect(
      new StorageIntegrityService(objectStorage).verifyObject({
        objectKey: 'workspace/file.bin',
        expectedSizeBytes: 100,
      }),
    ).resolves.toMatchObject({
      actualChecksum: null,
      integrityStatus: 'failed',
      verificationFailureCode: 'verification-failed',
    });
    expect(stream.destroyed).toBe(true);
  });
});
