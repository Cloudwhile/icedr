import { ConflictException } from '@nestjs/common';
import type {
  CompleteUploadDto,
  DownloadIntentResponse,
  FileNodeResponse,
  FileNodeSpaceScope,
  PreviewIntentResponse,
} from './file-nodes.dto';
import { FileNodesRepository } from './file-nodes.repository';
import {
  createSuffixedFileName,
  getFileNameConflictKey,
} from '../../common/security/file-name-policy';
import {
  createNode,
  docxMimeType,
  type TestUploadSession,
} from './file-upload-test-fixtures.helper';

type DownloadIntent = {
  auditMetadata: Record<string, unknown>;
  claimToken: string | null;
  consumedAt: string | null;
  createdAt: string;
  downloadId: string;
  expiresAt: string;
  failureCode: DownloadIntentResponse['lifecycle']['errorCode'];
  filename: string;
  lifecycle: DownloadIntentResponse['lifecycle'];
  method: 'stream' | 'manifest';
  nodeId: string;
  purpose: 'download' | 'preview';
  useCount: number;
  versionId: string | null;
};

export type FileNodesRepositoryMocks = {
  claimDownloadIntent: jest.Mock;
  commitDownloadIntent: jest.Mock;
  completeUpload: jest.Mock;
  failDownloadIntent: jest.Mock;
  pruneVersions: jest.Mock;
  recordAudit: jest.Mock;
};

export function createFileNodesRepositoryMock(input: {
  nodes: FileNodeResponse[];
  sessions: Map<string, TestUploadSession>;
}) {
  const { nodes, sessions } = input;
  const audits = new Map<string, number>();
  const downloadIntents = new Map<string, DownloadIntent>();
  const repository = {
    list: jest.fn(
      (
        workspaceId?: string,
        parentNodeId?: string | null,
        state = 'active',
        filter: {
          ownerUserId?: string | null;
          spaceScope?: FileNodeSpaceScope;
        } = {},
      ) =>
        Promise.resolve(
          nodes.filter(
            (node) =>
              (!workspaceId || node.workspaceId === workspaceId) &&
              node.parentNodeId === (parentNodeId ?? null) &&
              (state !== 'active' || !node.archivedAt) &&
              node.spaceScope === (filter.spaceScope ?? 'workspace') &&
              (filter.ownerUserId === undefined ||
                node.ownerUserId === filter.ownerUserId),
          ),
        ),
    ),
    getStorageUsage: jest.fn(
      (
        workspaceId: string,
        filter: {
          ownerUserId?: string | null;
          spaceScope?: FileNodeSpaceScope;
        } = {},
      ) =>
        Promise.resolve({
          activeBytes: nodes
            .filter(
              (node) =>
                node.workspaceId === workspaceId &&
                !node.archivedAt &&
                node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                (filter.ownerUserId === undefined ||
                  node.ownerUserId === filter.ownerUserId),
            )
            .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
          defaultUserQuotaBytes: null,
          fileCount: nodes.filter(
            (node) =>
              node.workspaceId === workspaceId &&
              !node.archivedAt &&
              node.sizeBytes !== null &&
              node.spaceScope === (filter.spaceScope ?? 'workspace') &&
              (filter.ownerUserId === undefined ||
                node.ownerUserId === filter.ownerUserId),
          ).length,
          folderCount: nodes.filter(
            (node) =>
              node.workspaceId === workspaceId &&
              !node.archivedAt &&
              node.sizeBytes === null &&
              node.spaceScope === (filter.spaceScope ?? 'workspace') &&
              (filter.ownerUserId === undefined ||
                node.ownerUserId === filter.ownerUserId),
          ).length,
          quotaBytes: null,
          trashBytes: 0,
          trashFileCount: 0,
          usagePercent: null,
          usedBytes: nodes
            .filter(
              (node) =>
                node.workspaceId === workspaceId &&
                node.spaceScope === (filter.spaceScope ?? 'workspace') &&
                (filter.ownerUserId === undefined ||
                  node.ownerUserId === filter.ownerUserId),
            )
            .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
          versionBytes: 0,
          versionCount: 0,
          workspaceId,
          updatedAt: new Date(0).toISOString(),
        }),
    ),
    getUserStorageUsage: jest.fn((workspaceId: string, userId: string) =>
      Promise.resolve({
        defaultUserQuotaBytes: null,
        quotaBytes: null,
        usedBytes: nodes
          .filter(
            (node) =>
              node.workspaceId === workspaceId &&
              node.spaceScope === 'personal' &&
              node.ownerUserId === userId,
          )
          .reduce((total, node) => total + (node.sizeBytes ?? 0), 0),
        userId,
        workspaceId,
      }),
    ),
    findById: jest.fn((id: string) =>
      Promise.resolve(nodes.find((node) => node.id === id) ?? null),
    ),
    findVersion: jest.fn((nodeId: string, versionId: string) =>
      Promise.resolve(
        nodeId === 'roadmap' && versionId === 'version-1'
          ? {
              id: 'version-1',
              nodeId: 'roadmap',
              versionNumber: 1,
              objectKey: 'uploads/workspace-default/root/seed-roadmap-v1.docx',
              sizeBytes: 1024,
              mimeType: docxMimeType,
              uploadedBy: 'Workspace User',
              remark: 'Initial version',
              createdAt: new Date(0).toISOString(),
            }
          : null,
      ),
    ),
    listVersions: jest.fn(() =>
      Promise.resolve([
        {
          id: 'version-1',
          nodeId: 'roadmap',
          versionNumber: 1,
          objectKey: 'uploads/workspace-default/root/seed-roadmap-v1.docx',
          sizeBytes: 1024,
          mimeType: docxMimeType,
          uploadedBy: 'Workspace User',
          remark: 'Initial version',
          createdAt: new Date(0).toISOString(),
        },
      ]),
    ),
    createDownloadIntent: jest.fn(
      (intentInput: {
        auditMetadata?: Record<string, unknown>;
        filename: string;
        method: 'stream' | 'manifest';
        nodeId: string;
        purpose: 'download' | 'preview';
        versionId?: string | null;
      }) => {
        const downloadId = `fdl_test_${downloadIntents.size + 1}`;
        const createdAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 300000).toISOString();
        const intent: DownloadIntent = {
          auditMetadata: intentInput.auditMetadata ?? {},
          claimToken: null,
          consumedAt: null,
          createdAt,
          downloadId,
          expiresAt,
          failureCode: null,
          filename: intentInput.filename,
          lifecycle: {
            createdAt,
            errorCode: null,
            errorMessage: null,
            expiresAt,
            retryable: false,
            status: 'pending',
            updatedAt: createdAt,
          },
          method: intentInput.method,
          nodeId: intentInput.nodeId,
          purpose: intentInput.purpose,
          useCount: 0,
          versionId: intentInput.versionId ?? null,
        };
        downloadIntents.set(downloadId, intent);
        return Promise.resolve(intent);
      },
    ),
    findAvailableDownloadIntent: jest.fn(
      (intentInput: {
        downloadId: string;
        nodeId: string;
        versionId?: string | null;
      }) => {
        const intent = downloadIntents.get(intentInput.downloadId);
        if (!isAvailableIntent(intent, intentInput)) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ ...intent });
      },
    ),
    claimDownloadIntent: jest.fn(
      (intentInput: {
        downloadId: string;
        nodeId: string;
        versionId?: string | null;
      }) => {
        const intent = downloadIntents.get(intentInput.downloadId);
        if (!isAvailableIntent(intent, intentInput)) {
          return Promise.resolve(null);
        }
        const claimToken = `claim_${intent.downloadId}_${intent.useCount}`;
        intent.claimToken = claimToken;
        intent.failureCode = null;
        updateDownloadIntentLifecycle(intent, 'running');
        return Promise.resolve({ claimToken, intent: { ...intent } });
      },
    ),
    commitDownloadIntent: jest.fn(
      (intentInput: {
        claimToken: string;
        downloadId: string;
        purpose: 'download' | 'preview';
      }) => {
        const intent = downloadIntents.get(intentInput.downloadId);
        if (
          !intent ||
          intent.claimToken !== intentInput.claimToken ||
          intent.purpose !== intentInput.purpose ||
          new Date(intent.expiresAt).getTime() <= Date.now()
        ) {
          return Promise.resolve(null);
        }
        intent.claimToken = null;
        intent.failureCode = null;
        intent.useCount += 1;
        if (intent.purpose === 'download') {
          intent.consumedAt = new Date().toISOString();
        }
        updateDownloadIntentLifecycle(
          intent,
          intent.purpose === 'download' ? 'completed' : 'running',
        );
        return Promise.resolve({ ...intent });
      },
    ),
    failDownloadIntent: jest.fn(
      (intentInput: { claimToken: string; downloadId: string }) => {
        const intent = downloadIntents.get(intentInput.downloadId);
        if (!intent || intent.claimToken !== intentInput.claimToken) {
          return Promise.resolve(false);
        }
        intent.claimToken = null;
        intent.failureCode = 'DOWNLOAD_FAILED';
        updateDownloadIntentLifecycle(intent, 'failed', 'DOWNLOAD_FAILED');
        return Promise.resolve(true);
      },
    ),
    completeUpload: jest.fn(
      (
        dto: CompleteUploadDto & {
          conflictStrategy?: 'overwrite' | 'rename' | 'skip' | 'version';
          conflictTargetNodeId?: string;
          conflictTargetObjectKey?: string;
          ownerUserId?: string;
          requestedFileName?: string;
        },
        completionClaim?: { sessionId: string; completionToken: string },
      ) => {
        const persistClaim = (node: FileNodeResponse) => {
          if (!completionClaim) return node;
          const session = sessions.get(completionClaim.sessionId);
          if (
            !session ||
            session.completionToken !== completionClaim.completionToken
          ) {
            throw new ConflictException('Upload completion claim changed');
          }
          sessions.set(completionClaim.sessionId, {
            ...session,
            nodeId: node.id,
            fileName: node.name,
            completionStartedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          return node;
        };
        const requestedFileName = dto.requestedFileName ?? dto.fileName;
        const conflictStrategy = dto.conflictStrategy ?? 'version';
        const targetIndex = dto.conflictTargetNodeId
          ? nodes.findIndex((node) => node.id === dto.conflictTargetNodeId)
          : -1;
        if (dto.conflictTargetNodeId && targetIndex < 0) {
          throw new ConflictException({
            code: 'UPLOAD_CONFLICT_TARGET_CHANGED',
            message:
              'Upload conflict target changed while the upload was running',
          });
        }
        if (targetIndex >= 0 && nodes[targetIndex].objectKey) {
          const existing = nodes[targetIndex];
          const expectedOwner =
            (dto.spaceScope ?? 'workspace') === 'personal'
              ? (dto.ownerUserId ?? null)
              : existing.ownerUserId;
          if (
            existing.archivedAt ||
            existing.workspaceId !== dto.workspaceId ||
            existing.parentNodeId !== (dto.parentNodeId ?? null) ||
            existing.spaceScope !== (dto.spaceScope ?? 'workspace') ||
            existing.ownerUserId !== expectedOwner ||
            getFileNameConflictKey(existing.name) !==
              getFileNameConflictKey(requestedFileName) ||
            (conflictStrategy === 'overwrite' &&
              existing.objectKey !== dto.conflictTargetObjectKey)
          ) {
            throw new ConflictException({
              code: 'UPLOAD_CONFLICT_TARGET_CHANGED',
              message:
                'Upload conflict target changed while the upload was running',
            });
          }
          if (
            conflictStrategy !== 'overwrite' &&
            conflictStrategy !== 'version'
          ) {
            throw new ConflictException({
              code: 'UPLOAD_CONFLICT_TARGET_CHANGED',
              message:
                'Upload conflict target changed while the upload was running',
            });
          }
          const node = createNode({
            ...existing,
            name: requestedFileName,
            kind: 'doc',
            mimeType: dto.mimeType ?? 'application/octet-stream',
            sizeBytes: dto.sizeBytes,
            objectKey: dto.objectKey,
            owner: dto.owner ?? existing.owner,
            ownerUserId: dto.ownerUserId ?? existing.ownerUserId,
            updatedAt: new Date().toISOString(),
          });
          nodes[targetIndex] = node;
          return Promise.resolve({
            displacedObjectKey:
              conflictStrategy === 'overwrite' ? existing.objectKey : null,
            node: persistClaim(node),
          });
        }
        const scopedSiblings = nodes.filter(
          (node) =>
            !node.archivedAt &&
            node.workspaceId === dto.workspaceId &&
            node.parentNodeId === (dto.parentNodeId ?? null) &&
            node.spaceScope === (dto.spaceScope ?? 'workspace') &&
            ((dto.spaceScope ?? 'workspace') !== 'personal' ||
              node.ownerUserId === (dto.ownerUserId ?? null)),
        );
        const conflictKeys = new Set(
          scopedSiblings.map((node) => getFileNameConflictKey(node.name)),
        );
        let resolvedFileName = requestedFileName;
        if (
          conflictKeys.has(getFileNameConflictKey(requestedFileName)) &&
          conflictStrategy === 'skip'
        ) {
          throw new ConflictException({
            code: 'UPLOAD_CONFLICT_SKIPPED',
            message: 'File upload skipped because a same-name item exists',
          });
        }
        if (conflictStrategy === 'rename') {
          for (
            let index = 2;
            conflictKeys.has(getFileNameConflictKey(resolvedFileName));
            index += 1
          ) {
            resolvedFileName = createSuffixedFileName(
              requestedFileName,
              ` (${index})`,
            );
          }
        } else if (
          conflictKeys.has(getFileNameConflictKey(requestedFileName))
        ) {
          throw new ConflictException(
            'File node name conflicts with an existing item',
          );
        }
        const node = createNode({
          id: `node_${nodes.length + 1}`,
          workspaceId: dto.workspaceId,
          parentNodeId: dto.parentNodeId ?? null,
          name: resolvedFileName,
          kind: 'doc',
          mimeType: dto.mimeType ?? 'application/octet-stream',
          sizeBytes: dto.sizeBytes,
          objectKey: dto.objectKey,
          owner: dto.owner ?? 'Workspace User',
          ownerUserId: dto.ownerUserId ?? null,
          spaceScope: dto.spaceScope ?? 'workspace',
          starred: false,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        nodes.push(node);
        return Promise.resolve({
          displacedObjectKey: null,
          node: persistClaim(node),
        });
      },
    ),
    createPreviewArtifact: jest.fn(
      (
        node: FileNodeResponse,
        status: PreviewIntentResponse['status'],
        previewType: PreviewIntentResponse['previewType'],
      ) =>
        Promise.resolve({
          previewId: 'preview-test',
          nodeId: node.id,
          status,
          legacyPreviewStatus:
            status === 'completed'
              ? ('ready' as const)
              : ('unsupported' as const),
          previewType,
          renderMode: previewType as PreviewIntentResponse['renderMode'],
          statusUrl: `/api/file-nodes/${node.id}/preview/status`,
          capability: node.previewCapability,
          lifecycle: {
            status,
            errorCode: status === 'failed' ? 'PREVIEW_UNSUPPORTED' : null,
            errorMessage: null,
            retryable: false,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            expiresAt: null,
          },
          error: null,
        }),
    ),
    findPreviewArtifact: jest.fn((previewId: string) => {
      const nodeId =
        previewId === 'preview-test'
          ? 'roadmap'
          : previewId === 'preview-personal-b'
            ? 'personal-b'
            : null;
      if (!nodeId) return Promise.resolve(null);
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return Promise.resolve(null);
      return Promise.resolve({
        previewId,
        nodeId,
        actorUserId: null,
        status: 'completed',
        legacyPreviewStatus: 'ready',
        previewType: node.previewCapability.renderMode,
        renderMode: node.previewCapability.renderMode,
        statusUrl: `/api/file-nodes/${nodeId}/preview/status`,
        capability: node.previewCapability,
        lifecycle: {
          status: 'completed' as const,
          errorCode: null,
          errorMessage: null,
          retryable: false,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          expiresAt: null,
        },
        error: null,
      });
    }),
    copyTree: jest.fn(
      (
        source: FileNodeResponse,
        copyInput: { name: string; parentNodeId: string | null },
      ) => {
        const node = createNode({
          ...source,
          id: `copy_${nodes.length + 1}`,
          name: copyInput.name,
          parentNodeId: copyInput.parentNodeId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        nodes.push(node);
        return Promise.resolve(node);
      },
    ),
    recordAudit: jest.fn((action: string) => {
      audits.set(action, (audits.get(action) ?? 0) + 1);
      return Promise.resolve();
    }),
    pruneVersions: jest.fn(() => Promise.resolve([])),
    countAuditEvents: jest.fn((action: string) =>
      Promise.resolve(audits.get(action) ?? 0),
    ),
  } as unknown as FileNodesRepository;

  return {
    repository,
    repositoryMocks: repository as unknown as FileNodesRepositoryMocks,
  };
}

function updateDownloadIntentLifecycle(
  intent: DownloadIntent,
  status: DownloadIntentResponse['lifecycle']['status'],
  errorCode: DownloadIntentResponse['lifecycle']['errorCode'] = null,
) {
  intent.lifecycle = {
    ...intent.lifecycle,
    errorCode,
    errorMessage: null,
    retryable: status === 'failed',
    status,
    updatedAt: new Date().toISOString(),
  };
}

function isAvailableIntent(
  intent: DownloadIntent | undefined,
  input: { nodeId: string; versionId?: string | null },
): intent is DownloadIntent {
  return Boolean(
    intent &&
    intent.nodeId === input.nodeId &&
    intent.versionId === (input.versionId ?? null) &&
    new Date(intent.expiresAt).getTime() > Date.now() &&
    !intent.claimToken &&
    !intent.consumedAt &&
    intent.useCount < (intent.purpose === 'preview' ? 64 : 1),
  );
}
