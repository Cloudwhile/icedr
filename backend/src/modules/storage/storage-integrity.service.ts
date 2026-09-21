import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { StorageObjectService } from './storage-object.service';

export type StorageIntegrityFailureCode =
  | 'missing-object'
  | 'size-mismatch'
  | 'checksum-mismatch'
  | 'verification-failed';

export type StorageIntegrityVerificationResult = {
  checksumAlgorithm: 'sha256';
  actualChecksum: string | null;
  actualSizeBytes: number | null;
  integrityStatus: 'verified' | 'mismatch' | 'failed';
  lastVerifiedAt: Date;
  verificationFailureCode: StorageIntegrityFailureCode | null;
};

@Injectable()
export class StorageIntegrityService {
  constructor(private readonly objectStorage: StorageObjectService) {}

  async verifyObject(input: {
    objectKey: string;
    expectedSizeBytes: number;
    checksumAlgorithm?: string | null;
    checksumValue?: string | null;
    onBytes?: (count: number) => Promise<void>;
    signal?: AbortSignal;
  }): Promise<StorageIntegrityVerificationResult> {
    const checksumAlgorithm = input.checksumAlgorithm?.trim() ?? '';
    const expectedChecksum = input.checksumValue?.trim().toLowerCase() ?? '';
    const hasChecksumBaseline = Boolean(checksumAlgorithm || expectedChecksum);
    if (
      !Number.isSafeInteger(input.expectedSizeBytes) ||
      input.expectedSizeBytes < 0 ||
      (hasChecksumBaseline &&
        (checksumAlgorithm.toLowerCase().replace('-', '') !== 'sha256' ||
          !/^[a-f0-9]{64}$/.test(expectedChecksum)))
    ) {
      return this.failedResult('verification-failed');
    }
    input.signal?.throwIfAborted();
    let opened;
    try {
      opened = await this.objectStorage.openObjectStream({
        objectKey: input.objectKey,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) throw error;
      if (error instanceof NotFoundException) {
        return this.failedResult('missing-object');
      }
      return this.failedResult('verification-failed');
    }
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const abortStream = () => {
      const abortError = new Error('Storage integrity verification aborted');
      abortError.name = 'AbortError';
      opened.stream.destroy(abortError);
    };
    input.signal?.addEventListener('abort', abortStream, { once: true });
    try {
      input.signal?.throwIfAborted();
      for await (const chunk of opened.stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        await input.onBytes?.(bytes.length);
        input.signal?.throwIfAborted();
        hash.update(bytes);
        sizeBytes += bytes.length;
      }
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) throw error;
      return this.failedResult('verification-failed');
    } finally {
      input.signal?.removeEventListener('abort', abortStream);
      if (!opened.stream.destroyed) opened.stream.destroy();
    }

    const checksumValue = hash.digest('hex');
    const sizeMatches = sizeBytes === input.expectedSizeBytes;
    const checksumMatches =
      !hasChecksumBaseline || checksumValue === expectedChecksum;
    const verificationFailureCode = !sizeMatches
      ? 'size-mismatch'
      : !checksumMatches
        ? 'checksum-mismatch'
        : null;
    return {
      checksumAlgorithm: 'sha256',
      actualChecksum: checksumValue,
      actualSizeBytes: sizeBytes,
      integrityStatus: verificationFailureCode ? 'mismatch' : 'verified',
      lastVerifiedAt: new Date(),
      verificationFailureCode,
    };
  }

  private failedResult(
    verificationFailureCode: StorageIntegrityFailureCode,
  ): StorageIntegrityVerificationResult {
    return {
      checksumAlgorithm: 'sha256',
      actualChecksum: null,
      actualSizeBytes: null,
      integrityStatus: 'failed',
      lastVerifiedAt: new Date(),
      verificationFailureCode,
    };
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
