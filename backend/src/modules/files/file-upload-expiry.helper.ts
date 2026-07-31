import {
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { uploadSessionLifetimeMs } from '../../common/transfers/upload-session-policy';
import type { StorageService } from '../storage/storage.service';
import type {
  UploadSession,
  UploadSessionsRepository,
} from './upload-sessions.repository';

export type ExpiredStorageCleanupMode = 'background' | 'wait';

export class FileUploadExpiryManager {
  private readonly cleanupTasks = new Map<string, Promise<void>>();
  private readonly logger = new Logger(FileUploadExpiryManager.name);

  constructor(
    private readonly uploadSessions: UploadSessionsRepository,
    private readonly storage: StorageService,
  ) {}

  async ensure(
    session: UploadSession,
    cleanupMode: ExpiredStorageCleanupMode = 'wait',
  ) {
    if (!session.expiresAt) {
      const fixedExpiry = new Date(
        new Date(session.createdAt).getTime() + uploadSessionLifetimeMs,
      );
      const updated = await this.uploadSessions.setLegacyExpiry(
        session.id,
        fixedExpiry,
      );
      if (!updated) {
        throw new ConflictException({
          code: 'UPLOAD_SESSION_STATE_CONFLICT',
          message:
            'Upload session status changed before its deadline was persisted',
        });
      }
      session = updated;
    }
    if (session.status !== 'expired') return session;

    let expired = await this.uploadSessions.transitionFailureState(
      session.id,
      'expired',
      { failureCode: 'UPLOAD_SESSION_EXPIRED' },
    );
    if (!expired) {
      const current = await this.uploadSessions.findById(session.id);
      if (!current || current.status !== 'expired') {
        return current ?? session;
      }
      expired = await this.uploadSessions.transitionFailureState(
        current.id,
        'expired',
        { failureCode: 'UPLOAD_SESSION_EXPIRED' },
      );
      if (!expired) return current;
    }
    session = expired;
    const cleanup = this.cleanupStorage(session);
    if (cleanupMode === 'background') {
      void cleanup.catch(() => {
        this.logger.warn(
          `Expired upload storage cleanup failed for session ${session.id}; reconciliation will retry it`,
        );
      });
      return session;
    }
    try {
      await cleanup;
    } catch {
      throw new ServiceUnavailableException(
        'Expired upload storage cleanup failed',
      );
    }
    return session;
  }

  private cleanupStorage(session: UploadSession) {
    if (session.storageFinalizedAt) return Promise.resolve();
    const existing = this.cleanupTasks.get(session.id);
    if (existing) return existing;

    const operation = session.multipartUploadId
      ? this.storage.abortMultipartUpload({
          objectKey: session.objectKey,
          uploadId: session.multipartUploadId,
        })
      : this.storage.deleteUploadSessionParts(session.id);
    const tracked = operation.finally(() => {
      if (this.cleanupTasks.get(session.id) === tracked) {
        this.cleanupTasks.delete(session.id);
      }
    });
    this.cleanupTasks.set(session.id, tracked);
    return tracked;
  }
}
