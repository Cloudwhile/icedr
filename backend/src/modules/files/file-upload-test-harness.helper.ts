import { StorageService } from '../storage/storage.service';
import { FileDownloadPreviewService } from './file-download-preview.service';
import { FileNodesService } from './file-nodes.service';
import { FileUploadPolicyService } from './file-upload-policy.service';
import { FileUploadService } from './file-upload.service';
import {
  createSeedNodes,
  type TestUploadSession,
} from './file-upload-test-fixtures.helper';
import { createFileNodesRepositoryMock } from './file-upload-test-repository.helper';
import {
  createTestStorage,
  createTestTransfers,
} from './file-upload-test-runtime.helper';
import { createUploadSessionsRepositoryMock } from './file-upload-test-sessions.helper';
import type { UploadSessionPart } from './upload-sessions.repository';

export function createFileNodesServiceTestHarness() {
  const nodes = createSeedNodes();
  const sessions = new Map<string, TestUploadSession>();
  const sessionParts = new Map<string, UploadSessionPart[]>();
  const { repository, repositoryMocks } = createFileNodesRepositoryMock({
    nodes,
    sessions,
  });
  const storage = createTestStorage();
  const transfers = createTestTransfers();
  const { uploadSessions, uploadSessionMocks } =
    createUploadSessionsRepositoryMock({ sessions, sessionParts });
  const uploadPolicy = new FileUploadPolicyService(
    repository,
    storage as StorageService,
  );
  const uploadService = new FileUploadService(
    repository,
    storage as StorageService,
    transfers as never,
    uploadSessions,
    uploadPolicy,
  );
  const downloadPreviewService = new FileDownloadPreviewService(
    repository,
    storage as StorageService,
  );
  const service = new FileNodesService(
    repository,
    storage as StorageService,
    uploadService,
    downloadPreviewService,
  );
  return {
    nodes,
    repository,
    repositoryMocks,
    service,
    storage,
    transfers,
    uploadSessions,
    uploadSessionMocks,
  };
}

export type FileNodesServiceTestHarness = ReturnType<
  typeof createFileNodesServiceTestHarness
>;
