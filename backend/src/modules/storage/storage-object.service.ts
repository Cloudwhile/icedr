import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  createReadStream,
  createWriteStream,
  type Dirent,
  promises as fileSystem,
  type Stats,
} from 'fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import { dirname, relative, resolve, sep } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import {
  RangeNotSatisfiableException,
  resolveObjectByteRange,
} from './object-byte-range';
import { hasUnsafePathSegments } from './storage-object-keys';
import {
  ObjectStorageConnectionSettings,
  StorageSettingsUsageService,
} from './storage-settings-usage.service';

export const STORAGE_SIGNER = 'STORAGE_SIGNER';

type Signer = (
  client: S3Client,
  command: PutObjectCommand | GetObjectCommand | UploadPartCommand,
  options: { expiresIn: number },
) => Promise<string>;

export type ObjectStreamResult = {
  acceptRanges: 'bytes';
  contentLength: number;
  contentRange: string | null;
  contentType: string;
  etag: string | null;
  lastModified: Date | null;
  statusCode: 200 | 206;
  stream: Readable;
};

@Injectable()
export class StorageObjectService {
  private readonly signer: Signer;

  constructor(
    private readonly config: ConfigService,
    private readonly settingsUsage: StorageSettingsUsageService,
    @Optional()
    @Inject(STORAGE_SIGNER)
    signer: Signer = getSignedUrl,
  ) {
    this.signer = signer;
  }

  async createPresignedUpload(
    key: string,
    contentType = 'application/octet-stream',
  ) {
    const expiresInSeconds = 900;
    const settings = await this.getResolvedSettings();
    const bucket = this.getBucket(settings);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const signedUrl = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      key,
      bucket,
      method: 'PUT' as const,
      url: this.withPublicObjectEndpoint(signedUrl),
      headers: {
        'Content-Type': contentType,
      },
      expiresInSeconds,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }

  async createMultipartUpload(
    key: string,
    contentType = 'application/octet-stream',
  ) {
    const settings = await this.getResolvedSettings();
    const result = await this.createClient(settings).send(
      new CreateMultipartUploadCommand({
        Bucket: this.getBucket(settings),
        ContentType: contentType,
        Key: key,
      }),
    );
    if (!result.UploadId) {
      throw new ServiceUnavailableException(
        'Object storage multipart upload failed to start',
      );
    }
    return {
      key,
      uploadId: result.UploadId,
    };
  }

  async createMultipartUploadPartUrl(input: {
    expectedSize: number;
    objectKey: string;
    partIndex: number;
    uploadId: string;
  }) {
    if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize < 0) {
      throw new BadRequestException('Expected upload chunk size is invalid');
    }
    const expiresInSeconds = 900;
    const settings = await this.getResolvedSettings();
    const command = new UploadPartCommand({
      Bucket: this.getBucket(settings),
      ContentLength: input.expectedSize,
      Key: input.objectKey,
      PartNumber: input.partIndex + 1,
      UploadId: input.uploadId,
    });
    const signedUrl = await this.signer(this.createClient(settings), command, {
      expiresIn: expiresInSeconds,
    });

    return {
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      expiresInSeconds,
      headers: {},
      method: 'PUT' as const,
      partIndex: input.partIndex,
      uploadId: input.uploadId,
      url: this.withPublicObjectEndpoint(signedUrl),
    };
  }

  async findMultipartUploadPart(input: {
    objectKey: string;
    partIndex: number;
    uploadId: string;
  }) {
    const settings = await this.getResolvedSettings();
    const response = await this.createClient(settings).send(
      new ListPartsCommand({
        Bucket: this.getBucket(settings),
        Key: input.objectKey,
        PartNumberMarker: String(input.partIndex),
        UploadId: input.uploadId,
      }),
    );
    const partNumber = input.partIndex + 1;
    const part = response.Parts?.find((item) => item.PartNumber === partNumber);
    if (!part?.ETag) {
      throw new BadRequestException('Uploaded multipart part was not found');
    }
    return {
      eTag: part.ETag,
      partIndex: input.partIndex,
      sizeBytes: part.Size ?? null,
    };
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    parts: { eTag: string; partIndex: number }[];
    uploadId: string;
  }) {
    const settings = await this.getResolvedSettings();
    if (input.parts.length === 0) {
      await this.abortMultipartUpload({
        objectKey: input.objectKey,
        uploadId: input.uploadId,
      }).catch(() => undefined);
      await this.createClient(settings).send(
        new PutObjectCommand({
          Body: Buffer.alloc(0),
          Bucket: this.getBucket(settings),
          Key: input.objectKey,
        }),
      );
      return { objectKey: input.objectKey, stored: true };
    }

    const sortedParts = [...input.parts].sort(
      (left, right) => left.partIndex - right.partIndex,
    );
    await this.createClient(settings).send(
      new CompleteMultipartUploadCommand({
        Bucket: this.getBucket(settings),
        Key: input.objectKey,
        MultipartUpload: {
          Parts: sortedParts.map((part) => ({
            ETag: part.eTag,
            PartNumber: part.partIndex + 1,
          })),
        },
        UploadId: input.uploadId,
      }),
    );
    return { objectKey: input.objectKey, stored: true };
  }

  async abortMultipartUpload(input: { objectKey: string; uploadId: string }) {
    const settings = await this.getResolvedSettings();
    try {
      await this.createClient(settings).send(
        new AbortMultipartUploadCommand({
          Bucket: this.getBucket(settings),
          Key: input.objectKey,
          UploadId: input.uploadId,
        }),
      );
    } catch (error) {
      if (this.isNotFoundError(error)) return;
      throw error;
    }
  }

  async openObjectStream(input: {
    objectKey: string;
    range?: string;
  }): Promise<ObjectStreamResult> {
    if (
      input.objectKey.startsWith('local/') &&
      !this.isLocalObjectKey(input.objectKey)
    ) {
      throw new BadRequestException('Local object key is invalid');
    }
    if (!this.isLocalObjectKey(input.objectKey)) {
      return this.openDistributedObjectStream(input);
    }

    const filePath = this.resolveLocalObjectPath(input.objectKey);
    let fileHandle;
    let fileStat;
    try {
      fileHandle = await open(filePath, 'r');
      fileStat = await fileHandle.stat();
      if (!fileStat.isFile()) throw new Error('Not a file');
    } catch {
      await fileHandle?.close().catch(() => undefined);
      throw new NotFoundException('Stored object not found');
    }
    let range;
    try {
      range = resolveObjectByteRange(input.range, fileStat.size);
    } catch (error) {
      await fileHandle.close().catch(() => undefined);
      throw error;
    }

    return {
      acceptRanges: 'bytes',
      contentLength: range?.length ?? fileStat.size,
      contentRange: range
        ? `bytes ${range.start}-${range.end}/${fileStat.size}`
        : null,
      contentType: 'application/octet-stream',
      etag: null,
      lastModified: fileStat.mtime,
      statusCode: range ? 206 : 200,
      stream: fileHandle.createReadStream({
        ...(range ?? {}),
        autoClose: true,
      }),
    };
  }

  async assertObjectExists(key: string, expectedSize?: number) {
    if (
      expectedSize !== undefined &&
      (!Number.isSafeInteger(expectedSize) || expectedSize < 0)
    ) {
      throw new BadRequestException('Expected object size is invalid');
    }

    if (this.isLocalObjectKey(key)) {
      await this.assertLocalObjectExists(key, expectedSize);
      return;
    }

    const settings = await this.getResolvedSettings();
    const bucket = this.getBucket(settings);
    try {
      const response = await this.createClient(settings).send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      if (
        expectedSize !== undefined &&
        this.normalizeObjectSize(response.ContentLength) !== expectedSize
      ) {
        throw new BadRequestException('Uploaded object size does not match');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (this.isNotFoundError(error)) {
        throw new BadRequestException('Uploaded object was not found');
      }
      throw new ServiceUnavailableException(
        'Object storage verification failed',
      );
    }
  }

  async objectExists(key: string, expectedSize?: number) {
    try {
      await this.assertObjectExists(key, expectedSize);
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) return false;
      throw error;
    }
  }

  async writeLocalUpload(objectKey: string, stream: Readable) {
    if (await this.distributedStorageEnabled()) {
      throw new BadRequestException('Local file storage is not enabled');
    }
    if (!this.isLocalObjectKey(objectKey)) {
      throw new BadRequestException('Local object key is invalid');
    }

    const filePath = this.resolveLocalObjectPath(objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await pipeline(stream, createWriteStream(filePath));
    return { objectKey, stored: true };
  }

  async writeUploadSessionPart(
    sessionId: string,
    partIndex: number,
    stream: Readable,
    expectedSize: number,
  ) {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      throw new BadRequestException('Expected upload chunk size is invalid');
    }
    const partPath = this.resolveUploadSessionPartPath(sessionId, partIndex);
    const stagedPartPath = `${partPath}.${randomBytes(8).toString('hex')}.tmp`;
    await mkdir(dirname(partPath), { recursive: true });
    let writtenBytes = 0;
    const enforceExpectedSize = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        writtenBytes += chunk.length;
        if (writtenBytes > expectedSize) {
          callback(
            new BadRequestException('Upload chunk size does not match session'),
          );
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        stream,
        enforceExpectedSize,
        createWriteStream(stagedPartPath),
      );
      if (writtenBytes !== expectedSize) {
        throw new BadRequestException(
          'Upload chunk size does not match session',
        );
      }
      await fileSystem.rename(stagedPartPath, partPath);
      return { sizeBytes: writtenBytes };
    } catch (error) {
      await rm(stagedPartPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async composeUploadSessionParts(input: {
    contentType?: string;
    expectedSize: number;
    objectKey: string;
    operationId: string;
    partIndexes: number[];
    refreshOperationLease?: () => Promise<void>;
    sessionId: string;
  }) {
    this.assertSafeComposeOperationId(input.operationId);
    if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize < 0) {
      throw new BadRequestException('Expected object size is invalid');
    }
    const sessionDirectory = this.resolveUploadSessionDirectory(
      input.sessionId,
    );
    const localObject = this.isLocalObjectKey(input.objectKey);
    // Each completion token owns its staging file; the final lease refresh
    // fences superseded tokens before the staged file is published.
    const stagedObjectPath = localObject
      ? resolve(
          this.resolveLocalComposeStagingDirectory(input.sessionId),
          `${input.operationId}.tmp`,
        )
      : resolve(sessionDirectory, `assembled-${input.operationId}.tmp`);
    await rm(stagedObjectPath, { force: true });
    await mkdir(dirname(stagedObjectPath), { recursive: true });

    try {
      if (input.partIndexes.length === 0) {
        await writeFile(stagedObjectPath, Buffer.alloc(0));
      } else {
        for (const partIndex of input.partIndexes) {
          const partPath = this.resolveUploadSessionPartPath(
            input.sessionId,
            partIndex,
          );
          await pipeline(
            createReadStream(partPath),
            createWriteStream(stagedObjectPath, { flags: 'a' }),
          );
          await input.refreshOperationLease?.();
        }
      }

      const stagedStat = await stat(stagedObjectPath);
      if (!stagedStat.isFile() || stagedStat.size !== input.expectedSize) {
        throw new BadRequestException(
          'Composed upload size does not match session',
        );
      }

      if (localObject) {
        const finalObjectPath = this.resolveLocalObjectPath(input.objectKey);
        await mkdir(dirname(finalObjectPath), { recursive: true });
        let existingStat: Stats | null = null;
        try {
          existingStat = await stat(finalObjectPath);
        } catch (error) {
          if (!this.isNotFoundError(error)) {
            throw new ServiceUnavailableException(
              'Local object storage verification failed',
            );
          }
        }
        await input.refreshOperationLease?.();
        if (
          existingStat?.isFile() &&
          existingStat.size === input.expectedSize
        ) {
          return { objectKey: input.objectKey, stored: true };
        }
        if (existingStat) {
          if (!existingStat.isFile()) {
            throw new BadRequestException('Uploaded local file was not found');
          }
          await rm(finalObjectPath, { force: true });
        }
        await input.refreshOperationLease?.();
        await fileSystem.rename(stagedObjectPath, finalObjectPath);
      } else {
        await input.refreshOperationLease?.();
        const settings = await this.getResolvedSettings();
        await this.createClient(settings).send(
          new PutObjectCommand({
            Body: createReadStream(stagedObjectPath),
            Bucket: this.getBucket(settings),
            ContentType: input.contentType ?? 'application/octet-stream',
            Key: input.objectKey,
          }),
        );
      }

      return { objectKey: input.objectKey, stored: true };
    } finally {
      await rm(stagedObjectPath, { force: true }).catch(() => undefined);
    }
  }

  async deleteUploadSessionParts(sessionId: string) {
    await Promise.all([
      rm(this.resolveUploadSessionDirectory(sessionId), {
        recursive: true,
        force: true,
      }),
      rm(this.resolveLocalComposeStagingDirectory(sessionId), {
        recursive: true,
        force: true,
      }),
    ]);
  }

  async deleteObject(objectKey: string) {
    if (this.isLocalObjectKey(objectKey)) {
      await rm(this.resolveLocalObjectPath(objectKey), { force: true });
      return;
    }

    const settings = await this.getResolvedSettings();
    await this.createClient(settings).send(
      new DeleteObjectCommand({
        Bucket: this.getBucket(settings),
        Key: objectKey,
      }),
    );
  }

  async listObjectKeys(prefix?: string) {
    if (!(await this.distributedStorageEnabled())) {
      return this.listLocalObjectKeys(prefix);
    }

    const settings = await this.getResolvedSettings();
    const client = this.createClient(settings);
    const bucket = this.getBucket(settings);
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          Prefix: prefix,
        }),
      );
      response.Contents?.forEach((item) => {
        if (item.Key) keys.push(item.Key);
      });
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  async readObjectText(objectKey: string, maxBytes = 1024 * 1024) {
    if (this.isLocalObjectKey(objectKey)) {
      const filePath = this.resolveLocalObjectPath(objectKey);
      const fileStat = await stat(filePath);
      if (fileStat.size > maxBytes) {
        throw new BadRequestException('File is too large to edit as text');
      }
      return readFile(filePath, 'utf8');
    }

    const settings = await this.getResolvedSettings();
    const response = await this.createClient(settings).send(
      new GetObjectCommand({
        Bucket: this.getBucket(settings),
        Key: objectKey,
      }),
    );
    const body = await response.Body?.transformToByteArray();
    if (!body) return '';
    if (body.byteLength > maxBytes) {
      throw new BadRequestException('File is too large to edit as text');
    }
    return Buffer.from(body).toString('utf8');
  }

  async writeObjectText(
    objectKey: string,
    content: string,
    contentType = 'text/plain; charset=utf-8',
  ) {
    if (this.isLocalObjectKey(objectKey)) {
      const filePath = this.resolveLocalObjectPath(objectKey);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return;
    }

    const settings = await this.getResolvedSettings();
    await this.createClient(settings).send(
      new PutObjectCommand({
        Body: content,
        Bucket: this.getBucket(settings),
        ContentType: contentType,
        Key: objectKey,
      }),
    );
  }

  async distributedStorageEnabled() {
    return this.settingsUsage.distributedStorageEnabled();
  }

  private async openDistributedObjectStream(input: {
    objectKey: string;
    range?: string;
  }): Promise<ObjectStreamResult> {
    if (!input.objectKey.trim() || hasControlCharacter(input.objectKey)) {
      throw new BadRequestException('Object key is invalid');
    }
    const settings = await this.getResolvedSettings();
    const client = this.createClient(settings);
    const bucket = this.getBucket(settings);

    try {
      let range = null;
      let totalSize: number | null = null;
      if (input.range?.trim()) {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey }),
        );
        totalSize = this.normalizeObjectSize(head.ContentLength);
        range = resolveObjectByteRange(input.range, totalSize);
      }
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: input.objectKey,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }),
      );
      const stream = this.toNodeReadable(response.Body);
      const contentLength = range
        ? range.length
        : this.normalizeObjectSize(response.ContentLength);

      return {
        acceptRanges: 'bytes',
        contentLength,
        contentRange:
          range && totalSize !== null
            ? `bytes ${range.start}-${range.end}/${totalSize}`
            : null,
        contentType: response.ContentType || 'application/octet-stream',
        etag: response.ETag ?? null,
        lastModified: response.LastModified ?? null,
        statusCode: range ? 206 : 200,
        stream,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new NotFoundException('Stored object not found');
      }
      if (
        error instanceof BadRequestException ||
        error instanceof RangeNotSatisfiableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException('Stored object could not be read');
    }
  }

  private normalizeObjectSize(value: number | undefined) {
    if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
      throw new ServiceUnavailableException('Stored object size is invalid');
    }
    return value;
  }

  private toNodeReadable(body: unknown) {
    if (body instanceof Readable) return body;
    if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
      return Readable.from(body as AsyncIterable<Uint8Array>);
    }
    throw new ServiceUnavailableException('Stored object body is unavailable');
  }

  private createClient(settings: ObjectStorageConnectionSettings) {
    return this.settingsUsage.createClient(settings);
  }

  private getBucket(settings: ObjectStorageConnectionSettings) {
    return this.settingsUsage.getBucket(settings);
  }

  private getResolvedSettings() {
    return this.settingsUsage.getResolvedSettings();
  }

  private getLocalRoot() {
    return this.settingsUsage.getLocalRoot();
  }

  private getPublicObjectEndpoint() {
    return (
      this.config
        .get<string>('storage.publicEndpoint')
        ?.trim()
        .replace(/\/$/, '') ?? ''
    );
  }

  private withPublicObjectEndpoint(signedUrl: string) {
    const publicEndpoint = this.getPublicObjectEndpoint();
    if (!publicEndpoint) return signedUrl;

    try {
      const signed = new URL(signedUrl);
      const publicUrl = new URL(publicEndpoint);
      publicUrl.pathname = `${publicUrl.pathname.replace(/\/$/, '')}${signed.pathname}`;
      const mergedParams = new URLSearchParams(signed.search);
      new URLSearchParams(publicUrl.search).forEach((value, key) => {
        if (!mergedParams.has(key)) {
          mergedParams.set(key, value);
        }
      });
      publicUrl.search = mergedParams.toString();
      publicUrl.hash = signed.hash || publicUrl.hash;
      return publicUrl.toString();
    } catch {
      return signedUrl;
    }
  }

  private getUploadStagingRoot() {
    return resolve(dirname(resolve(this.getLocalRoot())), '.upload-parts');
  }

  private getLocalComposeStagingRoot() {
    return resolve(this.getLocalRoot(), '.upload-staging');
  }

  private async listLocalObjectKeys(prefix?: string) {
    const root = resolve(this.getLocalRoot());
    const keys: string[] = [];

    const visit = async (directory: string) => {
      let entries: Dirent<string>[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = resolve(directory, entry.name);
        if (entryPath === this.getLocalComposeStagingRoot()) continue;
        if (entry.isDirectory()) {
          await visit(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const key = `local/${relative(root, entryPath).replace(/\\/g, '/')}`;
        if (!prefix || key.startsWith(prefix)) keys.push(key);
      }
    };

    await visit(root);
    return keys;
  }

  private isLocalObjectKey(key: string) {
    return (
      key.startsWith('local/') &&
      !key.includes('\\') &&
      !hasUnsafePathSegments(key)
    );
  }

  private resolveLocalObjectPath(key: string) {
    const root = resolve(this.getLocalRoot());
    const filePath = resolve(root, key.slice('local/'.length));
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException('Local object key is outside storage root');
    }
    return filePath;
  }

  private resolveUploadSessionDirectory(sessionId: string) {
    this.assertSafeUploadSessionId(sessionId);
    const root = this.getUploadStagingRoot();
    const directory = resolve(root, sessionId);
    if (directory !== root && !directory.startsWith(`${root}${sep}`)) {
      throw new BadRequestException('Upload session path is invalid');
    }
    return directory;
  }

  private resolveUploadSessionPartPath(sessionId: string, partIndex: number) {
    this.assertSafePartIndex(partIndex);
    return resolve(
      this.resolveUploadSessionDirectory(sessionId),
      `${partIndex}.part`,
    );
  }

  private resolveLocalComposeStagingDirectory(sessionId: string) {
    this.assertSafeUploadSessionId(sessionId);
    return resolve(this.getLocalComposeStagingRoot(), sessionId);
  }

  private assertSafeUploadSessionId(sessionId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      throw new BadRequestException('Upload session id is invalid');
    }
  }

  private assertSafeComposeOperationId(operationId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
      throw new BadRequestException('Upload compose operation id is invalid');
    }
  }

  private assertSafePartIndex(partIndex: number) {
    if (!Number.isInteger(partIndex) || partIndex < 0) {
      throw new BadRequestException('Upload part index is invalid');
    }
  }

  private async assertLocalObjectExists(key: string, expectedSize?: number) {
    let fileStat: Stats;
    try {
      fileStat = await stat(this.resolveLocalObjectPath(key));
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new BadRequestException('Uploaded local file was not found');
      }
      throw new ServiceUnavailableException(
        'Local object storage verification failed',
      );
    }
    if (!fileStat.isFile()) {
      throw new BadRequestException('Uploaded local file was not found');
    }
    if (expectedSize !== undefined && fileStat.size !== expectedSize) {
      throw new BadRequestException('Uploaded local file size does not match');
    }
  }

  private isNotFoundError(error: unknown) {
    const maybeError = error as {
      code?: string;
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      maybeError.code === 'ENOENT' ||
      maybeError.code === 'ENOTDIR' ||
      maybeError.name === 'NotFound' ||
      maybeError.name === 'NoSuchKey' ||
      maybeError.name === 'NoSuchUpload' ||
      maybeError.$metadata?.httpStatusCode === 404
    );
  }
}

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}
