import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createHash, randomBytes } from 'crypto';
import { createStorageTestContext } from './storage-settings-usage.spec-helper';
import { StorageIntegrityService } from './storage-integrity.service';

const describeMinio =
  process.env.STORAGE_INTEGRITY_MINIO_TEST === '1' ? describe : describe.skip;

async function createBucketWithRetry(client: S3Client, bucket: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 30) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError;
}

describeMinio('StorageIntegrityService with MinIO', () => {
  jest.setTimeout(90_000);

  it('streams and verifies a multipart object while ignoring its ETag', async () => {
    const endpoint =
      process.env.STORAGE_INTEGRITY_MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
    const region = process.env.STORAGE_INTEGRITY_MINIO_REGION ?? 'us-east-1';
    const accessKeyId =
      process.env.STORAGE_INTEGRITY_MINIO_ACCESS_KEY ?? 'minioadmin';
    const secretAccessKey =
      process.env.STORAGE_INTEGRITY_MINIO_SECRET_KEY ?? 'minioadmin';
    const bucket = `icedr-integrity-${randomBytes(8).toString('hex')}`;
    const objectKey = 'multipart/integrity.bin';
    const firstPart = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const secondPart = Buffer.from('minio-final-part');
    const content = Buffer.concat([firstPart, secondPart]);
    const client = new S3Client({
      endpoint,
      forcePathStyle: true,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    let uploadId: string | undefined;

    await createBucketWithRetry(client, bucket);
    try {
      const created = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: objectKey }),
      );
      uploadId = created.UploadId;
      if (!uploadId) throw new Error('MinIO did not create a multipart upload');
      const uploadedParts = [];
      for (const [index, body] of [firstPart, secondPart].entries()) {
        const uploaded = await client.send(
          new UploadPartCommand({
            Body: body,
            Bucket: bucket,
            Key: objectKey,
            PartNumber: index + 1,
            UploadId: uploadId,
          }),
        );
        uploadedParts.push({ ETag: uploaded.ETag, PartNumber: index + 1 });
      }
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          MultipartUpload: { Parts: uploadedParts },
          UploadId: uploadId,
        }),
      );
      uploadId = undefined;

      const values: Record<string, unknown> = {
        'storage.accessKeyId': accessKeyId,
        'storage.bucket': bucket,
        'storage.endpoint': endpoint,
        'storage.forcePathStyle': true,
        'storage.region': region,
        'storage.secretAccessKey': secretAccessKey,
      };
      const { objectStorage } = createStorageTestContext(values);
      jest
        .spyOn(
          objectStorage as unknown as { createClient: () => S3Client },
          'createClient',
        )
        .mockReturnValue(client);
      const expectedHash = createHash('sha256').update(content).digest('hex');
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      expect(head.ETag?.replaceAll('"', '')).not.toBe(expectedHash);

      await expect(
        new StorageIntegrityService(objectStorage).verifyObject({
          objectKey,
          expectedSizeBytes: content.length,
        }),
      ).resolves.toMatchObject({
        actualChecksum: expectedHash,
        actualSizeBytes: content.length,
        integrityStatus: 'verified',
      });
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      );
      await expect(
        new StorageIntegrityService(objectStorage).verifyObject({
          objectKey,
          expectedSizeBytes: content.length,
        }),
      ).resolves.toMatchObject({
        actualChecksum: null,
        actualSizeBytes: null,
        integrityStatus: 'failed',
        verificationFailureCode: 'missing-object',
      });
    } finally {
      if (uploadId) {
        await client
          .send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: objectKey,
              UploadId: uploadId,
            }),
          )
          .catch(() => undefined);
      }
      await client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }))
        .catch(() => undefined);
      await client
        .send(new DeleteBucketCommand({ Bucket: bucket }))
        .catch(() => undefined);
      client.destroy();
    }
  });
});
