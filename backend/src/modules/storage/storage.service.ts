import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import {
  StorageSettingsResponse,
  StorageTestResponse,
  StorageUsageBreakdownResponse,
  StorageUsageResponse,
  UpdateStorageSettingsDto,
  UpdateUserStorageQuotaDto,
  UpdateWorkspaceQuotaDto,
} from './storage-settings.dto';
import {
  StorageObjectService,
  type ObjectStreamResult,
} from './storage-object.service';
import { StorageReconcileRunner } from './storage-reconcile-runner.service';
import { StorageSettingsUsageService } from './storage-settings-usage.service';

export {
  STORAGE_SIGNER,
  type ObjectStreamResult,
} from './storage-object.service';

@Injectable()
export class StorageService {
  constructor(
    private readonly settingsUsage: StorageSettingsUsageService,
    private readonly objectStorage: StorageObjectService,
    private readonly reconcileRunner: StorageReconcileRunner,
  ) {}

  getProfile() {
    return this.settingsUsage.getProfile();
  }

  getSettings(): Promise<StorageSettingsResponse> {
    return this.settingsUsage.getSettings();
  }

  updateSettings(
    dto: UpdateStorageSettingsDto,
  ): Promise<StorageSettingsResponse> {
    return this.settingsUsage.updateSettings(dto);
  }

  validateSettings(dto: UpdateStorageSettingsDto) {
    return this.settingsUsage.validateSettings(dto);
  }

  testSettings(dto: UpdateStorageSettingsDto): Promise<StorageTestResponse> {
    return this.settingsUsage.testSettings(dto);
  }

  getUsage(
    workspaceId: string,
    options: { spaceScope?: string; userId?: string } = {},
  ): Promise<StorageUsageResponse> {
    return this.settingsUsage.getUsage(workspaceId, options);
  }

  getConfiguredQuotaBytes() {
    return this.settingsUsage.getConfiguredQuotaBytes();
  }

  getUsageBreakdown(
    workspaceId: string,
  ): Promise<StorageUsageBreakdownResponse> {
    return this.settingsUsage.getUsageBreakdown(workspaceId);
  }

  updateWorkspaceQuota(dto: UpdateWorkspaceQuotaDto) {
    return this.settingsUsage.updateWorkspaceQuota(dto);
  }

  updateUserStorageQuota(dto: UpdateUserStorageQuotaDto) {
    return this.settingsUsage.updateUserStorageQuota(dto);
  }

  distributedStorageEnabled() {
    return this.settingsUsage.distributedStorageEnabled();
  }

  configured() {
    return this.settingsUsage.configured();
  }

  createPresignedUpload(key: string, contentType = 'application/octet-stream') {
    return this.objectStorage.createPresignedUpload(key, contentType);
  }

  createMultipartUpload(key: string, contentType = 'application/octet-stream') {
    return this.objectStorage.createMultipartUpload(key, contentType);
  }

  createMultipartUploadPartUrl(input: {
    objectKey: string;
    partIndex: number;
    uploadId: string;
  }) {
    return this.objectStorage.createMultipartUploadPartUrl(input);
  }

  findMultipartUploadPart(input: {
    objectKey: string;
    partIndex: number;
    uploadId: string;
  }) {
    return this.objectStorage.findMultipartUploadPart(input);
  }

  completeMultipartUpload(input: {
    objectKey: string;
    parts: { eTag: string; partIndex: number }[];
    uploadId: string;
  }) {
    return this.objectStorage.completeMultipartUpload(input);
  }

  abortMultipartUpload(input: { objectKey: string; uploadId: string }) {
    return this.objectStorage.abortMultipartUpload(input);
  }

  openObjectStream(input: {
    objectKey: string;
    range?: string;
  }): Promise<ObjectStreamResult> {
    return this.objectStorage.openObjectStream(input);
  }

  assertObjectExists(key: string, expectedSize?: number) {
    return this.objectStorage.assertObjectExists(key, expectedSize);
  }

  objectExists(key: string, expectedSize?: number) {
    return this.objectStorage.objectExists(key, expectedSize);
  }

  writeLocalUpload(objectKey: string, stream: Readable) {
    return this.objectStorage.writeLocalUpload(objectKey, stream);
  }

  writeUploadSessionPart(
    sessionId: string,
    partIndex: number,
    stream: Readable,
  ) {
    return this.objectStorage.writeUploadSessionPart(
      sessionId,
      partIndex,
      stream,
    );
  }

  composeUploadSessionParts(input: {
    contentType?: string;
    expectedSize: number;
    objectKey: string;
    operationId: string;
    partIndexes: number[];
    refreshOperationLease?: () => Promise<void>;
    sessionId: string;
  }) {
    return this.objectStorage.composeUploadSessionParts(input);
  }

  deleteUploadSessionParts(sessionId: string) {
    return this.objectStorage.deleteUploadSessionParts(sessionId);
  }

  deleteObject(objectKey: string) {
    return this.objectStorage.deleteObject(objectKey);
  }

  listObjectKeys(prefix?: string) {
    return this.objectStorage.listObjectKeys(prefix);
  }

  reconcileObjects(
    input: {
      cleanup?: boolean;
      staleUploadMinutes?: number;
      workspaceId?: string;
    },
    actorUserId: string,
  ) {
    return this.reconcileRunner.reconcileObjects(input, actorUserId);
  }

  listReconcileTasks(limit?: number) {
    return this.reconcileRunner.listReconcileTasks(limit);
  }

  readObjectText(objectKey: string, maxBytes = 1024 * 1024) {
    return this.objectStorage.readObjectText(objectKey, maxBytes);
  }

  writeObjectText(
    objectKey: string,
    content: string,
    contentType = 'text/plain; charset=utf-8',
  ) {
    return this.objectStorage.writeObjectText(objectKey, content, contentType);
  }
}
