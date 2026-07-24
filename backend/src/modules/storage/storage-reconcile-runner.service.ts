import { Injectable } from '@nestjs/common';
import type { BlobReconcileTaskResponse } from './storage-reconcile.dto';
import {
  blobReconcileTaskStaleMs,
  StorageReconcileRepository,
  uploadCompletionClaimLeaseMs,
} from './storage-reconcile.repository';
import {
  isTransferObjectReferenceProtected,
  isUploadSessionStagingCleanupProtected,
} from './storage-reconcile-policy';
import { StorageObjectService } from './storage-object.service';
import { getWorkspaceObjectPrefixes } from './storage-object-keys';
import { StorageSettingsUsageService } from './storage-settings-usage.service';

@Injectable()
export class StorageReconcileRunner {
  constructor(
    private readonly reconcileRepository: StorageReconcileRepository,
    private readonly objectStorage: StorageObjectService,
    private readonly settingsUsage: StorageSettingsUsageService,
  ) {}

  async reconcileObjects(
    input: {
      cleanup?: boolean;
      staleUploadMinutes?: number;
      workspaceId?: string;
    },
    actorUserId: string,
  ) {
    const taskStartedAt = new Date();
    const startedAt = taskStartedAt.toISOString();
    const cleanup = Boolean(input.cleanup);
    const staleUploadMinutes = Math.min(
      Math.max(Math.trunc(input.staleUploadMinutes ?? 60), 1),
      10080,
    );
    const workspaceId = input.workspaceId?.trim() || undefined;
    await this.reconcileRepository.recoverStaleRunningTasks(
      new Date(taskStartedAt.getTime() - blobReconcileTaskStaleMs),
      taskStartedAt,
    );
    const task = await this.reconcileRepository.createTask({
      actorUserId,
      cleanup,
      staleUploadMinutes,
      startedAt,
      status: 'running',
      workspaceId: workspaceId ?? null,
    });
    let results: Pick<
      BlobReconcileTaskResponse,
      | 'deletedObjects'
      | 'missingObjects'
      | 'orphanObjects'
      | 'staleUploads'
      | 'summary'
    > = {
      deletedObjects: [],
      missingObjects: [],
      orphanObjects: [],
      staleUploads: [],
      summary: {
        deletedObjects: 0,
        missingObjects: 0,
        orphanObjects: 0,
        referencedObjects: 0,
        staleUploads: 0,
        storageObjects: 0,
      },
    };

    try {
      const scanNow = new Date();
      const staleBefore = new Date(
        scanNow.getTime() - staleUploadMinutes * 60 * 1000,
      );
      const protectionWindow = {
        completionClaimStaleBefore: new Date(
          scanNow.getTime() - uploadCompletionClaimLeaseMs,
        ),
        now: scanNow,
        staleBefore,
      };
      const storagePrefixes =
        await this.getReconcileStoragePrefixes(workspaceId);
      const [
        fileReferences,
        transferReferences,
        uploadSessionCleanupReferences,
        storageObjects,
      ] = await Promise.all([
        this.reconcileRepository.listFileObjectReferences(
          workspaceId,
          protectionWindow,
        ),
        this.reconcileRepository.listUploadTransferObjectReferences(
          workspaceId,
        ),
        this.reconcileRepository.listUploadSessionCleanupReferences(
          workspaceId,
        ),
        this.listObjectKeysForPrefixes(storagePrefixes),
      ]);

      const fileReferenceByObjectKey = new Map(
        fileReferences.map((reference) => [reference.objectKey, reference]),
      );
      const referencedObjectKeys = new Set(fileReferenceByObjectKey.keys());
      const storageObjectKeys = new Set(storageObjects);
      const protectedUploadObjectKeys = new Set<string>();
      const cleanupEligibleUploadReferences = transferReferences.filter(
        (reference) =>
          !isTransferObjectReferenceProtected(reference, protectionWindow),
      );
      const cleanupEligibleUploadSessions =
        uploadSessionCleanupReferences.filter(
          (reference) =>
            !isUploadSessionStagingCleanupProtected(
              reference,
              protectionWindow,
            ),
        );
      const staleUploadReferences = cleanupEligibleUploadReferences.filter(
        (reference) => !referencedObjectKeys.has(reference.objectKey),
      );
      const staleUploadTransferIds = new Set(
        staleUploadReferences.map((reference) => reference.transferId),
      );
      const staleUploads = staleUploadReferences.map((reference) => ({
        objectKey: reference.objectKey,
        transferId: reference.transferId,
        workspaceId: reference.workspaceId,
        reason: 'stale-upload' as const,
      }));

      transferReferences.forEach((reference) => {
        const stale = staleUploadTransferIds.has(reference.transferId);
        if (!stale && !referencedObjectKeys.has(reference.objectKey)) {
          protectedUploadObjectKeys.add(reference.objectKey);
        }
      });

      const missingObjects = fileReferences
        .filter((reference) => !storageObjectKeys.has(reference.objectKey))
        .map((reference) => ({
          objectKey: reference.objectKey,
          nodeId: reference.nodeId,
          workspaceId: reference.workspaceId,
          reason: 'missing-object' as const,
        }));
      const orphanObjects = storageObjects
        .filter(
          (objectKey) =>
            !referencedObjectKeys.has(objectKey) &&
            !protectedUploadObjectKeys.has(objectKey),
        )
        .map((objectKey) => ({
          objectKey,
          workspaceId,
          reason: 'orphan-object' as const,
        }));

      const cleanupCandidates = [
        ...new Set([
          ...orphanObjects.map((issue) => issue.objectKey),
          ...staleUploads
            .filter((issue) => storageObjectKeys.has(issue.objectKey))
            .map((issue) => issue.objectKey),
        ]),
      ].filter((objectKey) => !protectedUploadObjectKeys.has(objectKey));
      const deletedObjects: string[] = [];
      results = {
        deletedObjects,
        missingObjects,
        orphanObjects,
        staleUploads,
        summary: {
          referencedObjects: referencedObjectKeys.size,
          storageObjects: storageObjects.length,
          missingObjects: missingObjects.length,
          orphanObjects: orphanObjects.length,
          staleUploads: staleUploads.length,
          deletedObjects: 0,
        },
      };
      if (cleanup) {
        for (const objectKey of cleanupCandidates) {
          const deleteCheckNow = new Date();
          const isProtected =
            await this.reconcileRepository.isObjectKeyProtected({
              completionClaimStaleBefore: new Date(
                deleteCheckNow.getTime() - uploadCompletionClaimLeaseMs,
              ),
              now: deleteCheckNow,
              objectKey,
              staleBefore: new Date(
                deleteCheckNow.getTime() - staleUploadMinutes * 60 * 1000,
              ),
            });
          if (isProtected) continue;
          await this.objectStorage.deleteObject(objectKey);
          deletedObjects.push(objectKey);
          results.summary.deletedObjects = deletedObjects.length;
        }
        const cleanedUploadSessionIds = new Set<string>();
        for (const reference of cleanupEligibleUploadSessions) {
          if (cleanedUploadSessionIds.has(reference.uploadSessionId)) {
            continue;
          }
          const cleanupCheckNow = new Date();
          const cleanupProtected = await this.reconcileRepository
            .isUploadSessionCleanupProtected({
              completionClaimStaleBefore: new Date(
                cleanupCheckNow.getTime() - uploadCompletionClaimLeaseMs,
              ),
              now: cleanupCheckNow,
              staleBefore: new Date(
                cleanupCheckNow.getTime() - staleUploadMinutes * 60 * 1000,
              ),
              transferId: reference.transferId,
              uploadSessionId: reference.uploadSessionId,
            })
            .catch(() => true);
          if (cleanupProtected) continue;
          cleanedUploadSessionIds.add(reference.uploadSessionId);
          await this.objectStorage
            .deleteUploadSessionParts(reference.uploadSessionId)
            .catch(() => undefined);
        }
      }

      const finishedAt = new Date().toISOString();
      return this.reconcileRepository.updateTask(task.id, {
        ...results,
        failureCode: null,
        finishedAt,
        status: 'completed',
      });
    } catch (error) {
      await this.reconcileRepository
        .updateTask(task.id, {
          ...results,
          failureCode: 'STORAGE_RECONCILE_FAILED',
          finishedAt: new Date().toISOString(),
          status: 'failed',
        })
        .catch(() => undefined);
      throw error;
    }
  }

  listReconcileTasks(limit?: number) {
    return this.reconcileRepository.listTasks(limit);
  }

  private async listObjectKeysForPrefixes(prefixes: string[]) {
    if (prefixes.length === 0) return this.objectStorage.listObjectKeys();
    const keys = await Promise.all(
      prefixes.map((prefix) => this.objectStorage.listObjectKeys(prefix)),
    );
    return [...new Set(keys.flat())];
  }

  private async getReconcileStoragePrefixes(workspaceId?: string) {
    if (!workspaceId) return [];
    return getWorkspaceObjectPrefixes({
      distributedStorage: await this.settingsUsage.distributedStorageEnabled(),
      workspaceId,
    });
  }
}
