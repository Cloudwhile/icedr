import { createTransferTaskLifecycle } from '../../common/transfers/transfer-task-state';
import {
  type UploadSession,
  type UploadSessionPart,
  UploadSessionsRepository,
} from './upload-sessions.repository';
import type { TestUploadSession } from './file-upload-test-fixtures.helper';

export type UploadSessionMocks = {
  cancelSession: jest.Mock;
  claimCompletion: jest.Mock;
  claimPartWrite: jest.Mock;
  commitPartWrite: jest.Mock;
  completeCompletionClaim: jest.Mock;
  create: jest.Mock;
  failCompletionClaim: jest.Mock;
  listParts: jest.Mock;
  markStorageFinalized: jest.Mock;
  persistCompletionNode: jest.Mock;
  refreshCompletionClaim: jest.Mock;
  releasePartWrite: jest.Mock;
  resumeSession: jest.Mock;
  setLegacyExpiry: jest.Mock;
  transitionFailureState: jest.Mock;
  updateStatus: jest.Mock;
};

export function createUploadSessionsRepositoryMock(input: {
  sessions: Map<string, TestUploadSession>;
  sessionParts: Map<string, UploadSessionPart[]>;
}) {
  const { sessions, sessionParts } = input;
  let sessionCounter = 0;
  const uploadSessions = {
    create: jest.fn(
      (createInput: Parameters<UploadSessionsRepository['create']>[0]) => {
        const createdAt = new Date().toISOString();
        const session: TestUploadSession = {
          id: `upload-session-test-${++sessionCounter}`,
          transferId: createInput.transferId,
          nodeId: null,
          workspaceId: createInput.workspaceId,
          ownerUserId: createInput.ownerUserId ?? null,
          spaceScope: createInput.spaceScope ?? 'workspace',
          conflictStrategy: createInput.conflictStrategy,
          objectKey: createInput.objectKey,
          multipartUploadId: createInput.multipartUploadId ?? null,
          resumeKey: createInput.resumeKey ?? null,
          fileName: createInput.fileName,
          parentNodeId: createInput.parentNodeId ?? null,
          mimeType: createInput.mimeType,
          sizeBytes: createInput.sizeBytes,
          chunkSizeBytes: createInput.chunkSizeBytes,
          status: 'running',
          failureCode: null,
          expiresAt: createInput.expiresAt.toISOString(),
          completionToken: null,
          completionStartedAt: null,
          storageFinalizedAt: null,
          lifecycle: createTransferTaskLifecycle({
            status: 'running',
            createdAt,
            updatedAt: createdAt,
            expiresAt: createInput.expiresAt,
          }),
          createdAt,
          updatedAt: createdAt,
        };
        sessions.set(session.id, session);
        return Promise.resolve(session);
      },
    ),
    findReusable: jest.fn(
      (findInput: Parameters<UploadSessionsRepository['findReusable']>[0]) => {
        const session = Array.from(sessions.values()).find(
          (item) =>
            item.workspaceId === findInput.workspaceId &&
            item.ownerUserId === (findInput.ownerUserId ?? null) &&
            item.spaceScope === (findInput.spaceScope ?? 'workspace') &&
            item.conflictStrategy === findInput.conflictStrategy &&
            item.resumeKey === findInput.resumeKey &&
            item.fileName === findInput.fileName &&
            item.parentNodeId === (findInput.parentNodeId ?? null) &&
            item.sizeBytes === findInput.sizeBytes &&
            item.completionToken === null &&
            item.storageFinalizedAt === null &&
            ['running', 'paused', 'failed'].includes(item.status),
        );
        return Promise.resolve(session ?? null);
      },
    ),
    findById: jest.fn((id: string) =>
      Promise.resolve(sessions.get(id) ?? null),
    ),
    listParts: jest.fn((sessionId: string) =>
      Promise.resolve([...(sessionParts.get(sessionId) ?? [])]),
    ),
    upsertPart: jest.fn(
      (partInput: Parameters<UploadSessionsRepository['upsertPart']>[0]) => {
        const part = createPart(partInput);
        putPart(sessionParts, part);
        return Promise.resolve(part);
      },
    ),
    claimPartWrite: jest.fn((id: string) => {
      const session = sessions.get(id);
      if (!session || session.status !== 'running' || session.completionToken) {
        return Promise.resolve(null);
      }
      const now = new Date().toISOString();
      const writeToken = `part_${id}`;
      const claimed = {
        ...session,
        completionToken: writeToken,
        completionStartedAt: now,
        updatedAt: now,
      };
      sessions.set(id, claimed);
      return Promise.resolve({ ...claimed, writeToken });
    }),
    commitPartWrite: jest.fn(
      (
        writeToken: string,
        partInput: Parameters<UploadSessionsRepository['upsertPart']>[0],
      ) => {
        const session = sessions.get(partInput.sessionId);
        if (!session || session.completionToken !== writeToken) {
          return Promise.resolve(null);
        }
        putPart(sessionParts, createPart(partInput));
        const updated = {
          ...session,
          completionToken: null,
          completionStartedAt: null,
          updatedAt: new Date().toISOString(),
        };
        sessions.set(partInput.sessionId, updated);
        return Promise.resolve(updated);
      },
    ),
    releasePartWrite: jest.fn((id: string, writeToken: string) => {
      const session = sessions.get(id);
      if (!session || session.completionToken !== writeToken) {
        return Promise.resolve(false);
      }
      sessions.set(id, {
        ...session,
        completionToken: null,
        completionStartedAt: null,
        updatedAt: new Date().toISOString(),
      });
      return Promise.resolve(true);
    }),
    setLegacyExpiry: jest.fn((id: string, expiresAt: Date) => {
      const session = sessions.get(id);
      if (!session) return Promise.resolve(null);
      const updatedAt = new Date().toISOString();
      const lifecycle = createTransferTaskLifecycle({
        status: session.status,
        failureCode: session.failureCode,
        createdAt: session.createdAt,
        updatedAt,
        expiresAt,
      });
      const updated = {
        ...session,
        expiresAt: expiresAt.toISOString(),
        status: lifecycle.status,
        failureCode: lifecycle.errorCode,
        lifecycle,
        updatedAt,
      };
      sessions.set(id, updated);
      return Promise.resolve(updated);
    }),
    updateStatus: jest.fn(
      (
        id: string,
        status: UploadSession['status'],
        options: {
          expiresAt?: Date;
          expectedStatus?: UploadSession['status'];
          failureCode?: UploadSession['failureCode'];
          nodeId?: string | null;
        } = {},
      ) => {
        const session = sessions.get(id);
        if (!session) return Promise.resolve(null);
        if (
          (options.expectedStatus &&
            session.status !== options.expectedStatus) ||
          session.completionToken
        ) {
          return Promise.resolve(null);
        }
        const updatedAt = new Date().toISOString();
        const expiresAt = options.expiresAt?.toISOString() ?? session.expiresAt;
        const failureCode =
          status === 'failed'
            ? (options.failureCode ?? 'UPLOAD_FAILED')
            : status === 'expired'
              ? (options.failureCode ?? 'UPLOAD_SESSION_EXPIRED')
              : null;
        const updated: TestUploadSession = {
          ...session,
          ...(options.nodeId !== undefined ? { nodeId: options.nodeId } : {}),
          status,
          failureCode,
          expiresAt,
          lifecycle: createTransferTaskLifecycle({
            status,
            failureCode,
            createdAt: session.createdAt,
            updatedAt,
            expiresAt,
          }),
          updatedAt,
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    resumeSession: jest.fn(
      (id: string, expectedStatus: UploadSession['status']) => {
        const session = sessions.get(id);
        if (
          !session ||
          session.status !== expectedStatus ||
          !['running', 'paused', 'failed'].includes(session.status) ||
          session.completionToken ||
          session.storageFinalizedAt ||
          !session.expiresAt ||
          new Date(session.expiresAt).getTime() <= Date.now()
        ) {
          return Promise.resolve(null);
        }
        const updatedAt = new Date().toISOString();
        const updated: TestUploadSession = {
          ...session,
          status: 'running',
          failureCode: null,
          updatedAt,
          lifecycle: createTransferTaskLifecycle({
            status: 'running',
            createdAt: session.createdAt,
            updatedAt,
            expiresAt: session.expiresAt,
          }),
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    transitionFailureState: jest.fn(
      (
        id: string,
        status: 'failed' | 'expired',
        options: { failureCode?: UploadSession['failureCode'] } = {},
      ) => {
        const session = sessions.get(id);
        if (!session) return Promise.resolve(null);
        const updatedAt = new Date().toISOString();
        const failureCode =
          status === 'expired'
            ? 'UPLOAD_SESSION_EXPIRED'
            : (options.failureCode ?? 'UPLOAD_FAILED');
        const updated: TestUploadSession = {
          ...session,
          completionToken: null,
          completionStartedAt: null,
          status,
          failureCode,
          updatedAt,
          lifecycle: createTransferTaskLifecycle({
            status,
            failureCode,
            createdAt: session.createdAt,
            updatedAt,
            expiresAt: session.expiresAt,
          }),
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    cancelSession: jest.fn(
      (id: string, expectedStatus: UploadSession['status']) => {
        const session = sessions.get(id);
        if (!session) return Promise.resolve(null);
        if (session.status === 'canceled') return Promise.resolve(session);
        if (
          session.status !== expectedStatus ||
          session.completionToken ||
          (session.expiresAt &&
            new Date(session.expiresAt).getTime() <= Date.now())
        ) {
          return Promise.resolve(null);
        }
        const updatedAt = new Date().toISOString();
        const updated: TestUploadSession = {
          ...session,
          completionToken: null,
          completionStartedAt: null,
          failureCode: null,
          status: 'canceled',
          updatedAt,
          lifecycle: createTransferTaskLifecycle({
            status: 'canceled',
            createdAt: session.createdAt,
            updatedAt,
            expiresAt: session.expiresAt,
          }),
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    claimCompletion: jest.fn(
      (id: string, expectedStatus: 'running' | 'failed') => {
        const session = sessions.get(id);
        if (
          !session ||
          session.status !== expectedStatus ||
          (session.expiresAt &&
            new Date(session.expiresAt).getTime() <= Date.now()) ||
          session.completionToken
        ) {
          return Promise.resolve(null);
        }
        const now = new Date().toISOString();
        const completionToken = `completion_${id}`;
        const claimed: TestUploadSession = {
          ...session,
          completionToken,
          completionStartedAt: now,
          failureCode: null,
          status: 'running',
          updatedAt: now,
          lifecycle: createTransferTaskLifecycle({
            status: 'running',
            createdAt: session.createdAt,
            updatedAt: now,
            expiresAt: session.expiresAt,
          }),
        };
        sessions.set(id, claimed);
        return Promise.resolve({ ...claimed, completionToken });
      },
    ),
    markStorageFinalized: jest.fn((id: string, completionToken: string) => {
      const session = sessions.get(id);
      if (!session || session.completionToken !== completionToken) {
        return Promise.resolve(null);
      }
      const now = new Date().toISOString();
      const updated: TestUploadSession = {
        ...session,
        completionStartedAt: now,
        storageFinalizedAt: now,
        updatedAt: now,
      };
      sessions.set(id, updated);
      return Promise.resolve(updated);
    }),
    refreshCompletionClaim: jest.fn((id: string, completionToken: string) => {
      const session = sessions.get(id);
      if (!session || session.completionToken !== completionToken) {
        return Promise.resolve(null);
      }
      const now = new Date().toISOString();
      const updated: TestUploadSession = {
        ...session,
        completionStartedAt: now,
        updatedAt: now,
      };
      sessions.set(id, updated);
      return Promise.resolve(updated);
    }),
    persistCompletionNode: jest.fn(
      (id: string, completionToken: string, nodeId: string) => {
        const session = sessions.get(id);
        if (!session || session.completionToken !== completionToken) {
          return Promise.resolve(null);
        }
        const now = new Date().toISOString();
        const updated: TestUploadSession = {
          ...session,
          completionStartedAt: now,
          nodeId,
          updatedAt: now,
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    completeCompletionClaim: jest.fn(
      (id: string, completionToken: string, nodeId: string) => {
        const session = sessions.get(id);
        if (
          !session ||
          session.completionToken !== completionToken ||
          session.nodeId !== nodeId
        ) {
          return Promise.resolve(null);
        }
        const now = new Date().toISOString();
        const updated: TestUploadSession = {
          ...session,
          completionToken: null,
          failureCode: null,
          status: 'completed',
          updatedAt: now,
          lifecycle: createTransferTaskLifecycle({
            status: 'completed',
            createdAt: session.createdAt,
            updatedAt: now,
            expiresAt: session.expiresAt,
          }),
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    failCompletionClaim: jest.fn(
      (
        id: string,
        completionToken: string,
        failureCode: string = 'UPLOAD_FAILED',
      ) => {
        const session = sessions.get(id);
        if (!session || session.completionToken !== completionToken) {
          return Promise.resolve(null);
        }
        const now = new Date().toISOString();
        const expired = Boolean(
          session.expiresAt &&
          new Date(session.expiresAt).getTime() <= Date.now(),
        );
        const status = expired ? 'expired' : 'failed';
        const resolvedFailureCode = expired
          ? 'UPLOAD_SESSION_EXPIRED'
          : failureCode;
        const updated: TestUploadSession = {
          ...session,
          completionToken: null,
          completionStartedAt: null,
          failureCode: resolvedFailureCode as UploadSession['failureCode'],
          status,
          updatedAt: now,
          lifecycle: createTransferTaskLifecycle({
            status,
            failureCode: resolvedFailureCode,
            createdAt: session.createdAt,
            updatedAt: now,
            expiresAt: session.expiresAt,
          }),
        };
        sessions.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
  } as unknown as UploadSessionsRepository;

  return {
    uploadSessions,
    uploadSessionMocks: uploadSessions as unknown as UploadSessionMocks,
  };
}

function createPart(
  input: Parameters<UploadSessionsRepository['upsertPart']>[0],
): UploadSessionPart {
  return {
    sessionId: input.sessionId,
    partIndex: input.partIndex,
    startByte: input.startByte,
    endByte: input.endByte,
    sizeBytes: input.sizeBytes,
    eTag: input.eTag ?? null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function putPart(
  sessionParts: Map<string, UploadSessionPart[]>,
  part: UploadSessionPart,
) {
  const parts = (sessionParts.get(part.sessionId) ?? []).filter(
    (item) => item.partIndex !== part.partIndex,
  );
  parts.push(part);
  parts.sort((left, right) => left.partIndex - right.partIndex);
  sessionParts.set(part.sessionId, parts);
}
