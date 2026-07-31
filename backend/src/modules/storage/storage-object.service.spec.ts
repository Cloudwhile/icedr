import {
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { promises as fileSystem } from 'fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Readable } from 'stream';
import { RangeNotSatisfiableException } from './object-byte-range';
import {
  configuredStorageValues,
  createStorageTestContext,
} from './storage-settings-usage.spec-helper';

describe('StorageObjectService', () => {
  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await rm('backend/.tmp/storage-service-spec-local-files', {
      force: true,
      recursive: true,
    });
  });

  it('creates presigned upload urls with content headers', async () => {
    const { service, signer } = createStorageTestContext();

    const intent = await service.createPresignedUpload(
      'workspace-default/root/file.pdf',
      'application/pdf',
    );

    expect(intent).toMatchObject({
      key: 'workspace-default/root/file.pdf',
      bucket: 'icedr-drive',
      method: 'PUT',
      url: 'http://signed.local',
      headers: { 'Content-Type': 'application/pdf' },
      expiresInSeconds: 900,
    });
    expect(intent.expiresAt).toEqual(expect.any(String));
    expect(signer).toHaveBeenCalledTimes(1);
  });

  it('binds the expected multipart part size into the signed command', async () => {
    const { service, signer } = createStorageTestContext();

    await service.createMultipartUploadPartUrl({
      expectedSize: 4096,
      objectKey: 'workspace-default/root/file.pdf',
      partIndex: 2,
      uploadId: 'multipart-file',
    });

    const command: unknown = signer.mock.calls[0]?.[1];
    expect(command).toBeInstanceOf(UploadPartCommand);
    expect((command as UploadPartCommand).input).toMatchObject({
      ContentLength: 4096,
      Key: 'workspace-default/root/file.pdf',
      PartNumber: 3,
      UploadId: 'multipart-file',
    });
  });

  it('treats an already missing multipart upload as successfully aborted', async () => {
    const { objectStorage } = createStorageTestContext();
    const send = jest
      .fn()
      .mockRejectedValueOnce({
        name: 'NoSuchUpload',
        $metadata: { httpStatusCode: 404 },
      })
      .mockRejectedValueOnce(new Error('storage unavailable'));
    jest
      .spyOn(
        objectStorage as unknown as {
          createClient: () => { send: typeof send };
        },
        'createClient',
      )
      .mockReturnValue({ send });

    const input = {
      objectKey: 'workspace-default/root/file.pdf',
      uploadId: 'multipart-file',
    };
    await expect(objectStorage.abortMultipartUpload(input)).resolves.toBe(
      undefined,
    );
    await expect(objectStorage.abortMultipartUpload(input)).rejects.toThrow(
      'storage unavailable',
    );
  });

  it('only reports missing objects as absent', async () => {
    const { objectStorage, service } = createStorageTestContext();
    jest
      .spyOn(objectStorage, 'assertObjectExists')
      .mockRejectedValueOnce(new BadRequestException('missing'))
      .mockRejectedValueOnce(
        new ServiceUnavailableException('verification unavailable'),
      );

    await expect(service.objectExists('missing')).resolves.toBe(false);
    await expect(service.objectExists('unavailable')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('requires an exact size match when verifying local objects', async () => {
    const { service } = createStorageTestContext();
    const objectKey = 'local/workspace-default/root/size-test.txt';
    const filePath =
      'backend/.tmp/storage-service-spec-local-files/workspace-default/root/size-test.txt';
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '0123456789', 'utf8');

    try {
      await expect(service.assertObjectExists(objectKey, 10)).resolves.toBe(
        undefined,
      );
      await expect(service.objectExists(objectKey, 9)).resolves.toBe(false);
      await expect(service.objectExists(objectKey, 10)).resolves.toBe(true);
    } finally {
      await rm('backend/.tmp/storage-service-spec-local-files', {
        force: true,
        recursive: true,
      });
    }
  });

  it('caps local chunks while streaming and removes failed staged parts', async () => {
    const { service } = createStorageTestContext();
    const sessionId = 'bounded-part-test';
    const partDirectory = `backend/.tmp/.upload-parts/${sessionId}`;
    const partPath = `${partDirectory}/0.part`;

    try {
      await service.writeUploadSessionPart(
        sessionId,
        0,
        Readable.from(['old']),
        3,
      );
      await expect(
        service.writeUploadSessionPart(
          sessionId,
          0,
          Readable.from(['too-large']),
          3,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.writeUploadSessionPart(sessionId, 0, Readable.from(['no']), 3),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(readFile(partPath, 'utf8')).resolves.toBe('old');
      await expect(readdir(partDirectory)).resolves.toEqual(['0.part']);
    } finally {
      await rm(partDirectory, { force: true, recursive: true });
    }
  });

  it('preserves the committed local chunk when atomic publication fails', async () => {
    const { service } = createStorageTestContext();
    const sessionId = 'atomic-part-test';
    const partDirectory = `backend/.tmp/.upload-parts/${sessionId}`;
    const partPath = `${partDirectory}/0.part`;

    try {
      await service.writeUploadSessionPart(
        sessionId,
        0,
        Readable.from(['old']),
        3,
      );
      jest
        .spyOn(fileSystem, 'rename')
        .mockRejectedValueOnce(new Error('atomic publication failed'));

      await expect(
        service.writeUploadSessionPart(sessionId, 0, Readable.from(['new']), 3),
      ).rejects.toThrow('atomic publication failed');

      await expect(readFile(partPath, 'utf8')).resolves.toBe('old');
      await expect(readdir(partDirectory)).resolves.toEqual(['0.part']);
    } finally {
      await rm(partDirectory, { force: true, recursive: true });
    }
  });

  it('isolates compose operations and fences a superseded publisher', async () => {
    const { objectStorage, service } = createStorageTestContext();
    const sessionId = 'compose-fence-test';
    const objectKey = 'local/workspace-default/root/fenced.bin';
    const finalPath =
      'backend/.tmp/storage-service-spec-local-files/workspace-default/root/fenced.bin';
    const stagingDirectory =
      'backend/.tmp/storage-service-spec-local-files/.upload-staging/compose-fence-test';
    let releaseOld: (() => void) | undefined;
    let releaseNew: (() => void) | undefined;
    let notifyOldReady: (() => void) | undefined;
    let notifyNewReady: (() => void) | undefined;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const newGate = new Promise<void>((resolve) => {
      releaseNew = resolve;
    });
    const oldReady = new Promise<void>((resolve) => {
      notifyOldReady = resolve;
    });
    const newReady = new Promise<void>((resolve) => {
      notifyNewReady = resolve;
    });
    let oldRefreshes = 0;
    let newRefreshes = 0;
    let oldCompose: Promise<{ objectKey: string; stored: boolean }> | undefined;
    let newCompose: Promise<{ objectKey: string; stored: boolean }> | undefined;

    await mkdir(dirname(finalPath), { recursive: true });
    await writeFile(finalPath, 'x', 'utf8');
    await service.writeUploadSessionPart(
      sessionId,
      0,
      Readable.from(['old']),
      3,
    );
    jest
      .spyOn(objectStorage, 'distributedStorageEnabled')
      .mockResolvedValue(false);

    try {
      oldCompose = service.composeUploadSessionParts({
        expectedSize: 3,
        objectKey,
        operationId: 'completion-old',
        partIndexes: [0],
        refreshOperationLease: async () => {
          oldRefreshes += 1;
          if (oldRefreshes !== 2) return;
          notifyOldReady?.();
          await oldGate;
          throw new Error('completion claim superseded');
        },
        sessionId,
      });
      await oldReady;
      await service.writeUploadSessionPart(
        sessionId,
        0,
        Readable.from(['new']),
        3,
      );
      newCompose = service.composeUploadSessionParts({
        expectedSize: 3,
        objectKey,
        operationId: 'completion-new',
        partIndexes: [0],
        refreshOperationLease: async () => {
          newRefreshes += 1;
          if (newRefreshes !== 2) return;
          notifyNewReady?.();
          await newGate;
        },
        sessionId,
      });
      await newReady;

      expect((await readdir(stagingDirectory)).sort()).toEqual([
        'completion-new.tmp',
        'completion-old.tmp',
      ]);
      await expect(
        readFile(`${stagingDirectory}/completion-old.tmp`, 'utf8'),
      ).resolves.toBe('old');
      await expect(
        readFile(`${stagingDirectory}/completion-new.tmp`, 'utf8'),
      ).resolves.toBe('new');
      await expect(service.listObjectKeys()).resolves.toEqual([objectKey]);

      releaseNew?.();
      await expect(newCompose).resolves.toMatchObject({
        objectKey,
        stored: true,
      });
      await expect(readFile(finalPath, 'utf8')).resolves.toBe('new');
      await expect(readdir(stagingDirectory)).resolves.toEqual([
        'completion-old.tmp',
      ]);

      releaseOld?.();
      await expect(oldCompose).rejects.toThrow('completion claim superseded');
      await expect(readFile(finalPath, 'utf8')).resolves.toBe('new');
      await expect(
        readFile(`backend/.tmp/.upload-parts/${sessionId}/0.part`, 'utf8'),
      ).resolves.toBe('new');
    } finally {
      releaseNew?.();
      releaseOld?.();
      await Promise.allSettled([
        Promise.resolve(oldCompose),
        Promise.resolve(newCompose),
      ]);
      await rm('backend/.tmp/storage-service-spec-local-files', {
        force: true,
        recursive: true,
      });
      await rm(`backend/.tmp/.upload-parts/${sessionId}`, {
        force: true,
        recursive: true,
      });
    }
  });

  it('rejects unsafe object storage endpoints before creating clients', async () => {
    const { service, signer } = createStorageTestContext({
      ...configuredStorageValues,
      'storage.endpoint': 'http://169.254.169.254/latest/meta-data',
    });

    await expect(
      service.createPresignedUpload(
        'workspace-default/root/file.pdf',
        'application/pdf',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(signer).not.toHaveBeenCalled();
  });

  it('opens local object ranges without exposing the storage path', async () => {
    const { service } = createStorageTestContext();
    const objectKey = 'local/workspace-default/root/range-test.txt';
    const filePath =
      'backend/.tmp/storage-service-spec-local-files/workspace-default/root/range-test.txt';
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '0123456789', 'utf8');

    try {
      const result = await service.openObjectStream({
        objectKey,
        range: 'bytes=2-5',
      });
      expect((result.stream as Readable & { pending?: boolean }).pending).toBe(
        false,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        const value: unknown = chunk;
        if (typeof value === 'string' || value instanceof Uint8Array) {
          chunks.push(Buffer.from(value));
        }
      }

      expect(Buffer.concat(chunks).toString('utf8')).toBe('2345');
      expect(result).toMatchObject({
        acceptRanges: 'bytes',
        contentLength: 4,
        contentRange: 'bytes 2-5/10',
        contentType: 'application/octet-stream',
        statusCode: 206,
      });
      expect(result).not.toHaveProperty('path');
      expect(result).not.toHaveProperty('url');
    } finally {
      await rm('backend/.tmp/storage-service-spec-local-files', {
        force: true,
        recursive: true,
      });
    }
  });

  it('streams object storage ranges without creating a signed url', async () => {
    const { objectStorage, service, signer } = createStorageTestContext();
    const lastModified = new Date('2026-07-11T00:00:00.000Z');
    const send = jest.fn((command: GetObjectCommand | HeadObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return Promise.resolve({ ContentLength: 10 });
      }
      return Promise.resolve({
        Body: Readable.from(['2345']),
        ContentLength: 4,
        ContentRange: 'bytes 2-5/10',
        ContentType: 'text/plain',
        ETag: '"etag-range"',
        LastModified: lastModified,
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

    const result = await service.openObjectStream({
      objectKey: 'workspace-default/root/range-test.txt',
      range: 'bytes=2-5',
    });
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      const value: unknown = chunk;
      if (typeof value === 'string' || value instanceof Uint8Array) {
        chunks.push(Buffer.from(value));
      }
    }

    expect(Buffer.concat(chunks).toString('utf8')).toBe('2345');
    expect(result).toMatchObject({
      acceptRanges: 'bytes',
      contentLength: 4,
      contentRange: 'bytes 2-5/10',
      contentType: 'text/plain',
      etag: '"etag-range"',
      lastModified,
      statusCode: 206,
    });
    expect(result).not.toHaveProperty('bucket');
    expect(result).not.toHaveProperty('url');
    expect(signer).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.Range).toBe('bytes=2-5');
  });

  it('rejects object storage ranges before requesting the object body', async () => {
    const { objectStorage, service } = createStorageTestContext();
    const send = jest.fn(() => Promise.resolve({ ContentLength: 10 }));
    jest
      .spyOn(
        objectStorage as unknown as {
          createClient: () => { send: typeof send };
        },
        'createClient',
      )
      .mockReturnValue({ send });

    await expect(
      service.openObjectStream({
        objectKey: 'workspace-default/root/range-test.txt',
        range: 'bytes=10-12',
      }),
    ).rejects.toBeInstanceOf(RangeNotSatisfiableException);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });
});
