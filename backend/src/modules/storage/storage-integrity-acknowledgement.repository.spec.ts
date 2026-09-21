import type { PrismaService } from '../../database/prisma.service';
import { StorageIntegrityAcknowledgementRepository } from './storage-integrity-acknowledgement.repository';

const checkedAt = new Date('2026-08-14T00:00:00.000Z');

type AuditWrite = {
  data: {
    action: string;
    metadata: Record<string, unknown>;
    nodeId: string | null;
    workspaceId: string | null;
  };
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    acknowledgedAt: null,
    acknowledgedBy: null,
    actualHash: 'b'.repeat(64),
    attempts: 1,
    bytesRead: 12n,
    checkedAt,
    errorCode: 'checksum-mismatch',
    errorMessage: 'sensitive storage detail',
    expectedHash: 'a'.repeat(64),
    expectedSizeBytes: 12n,
    id: 'result-1',
    nodeId: 'node-1',
    objectKey: 'private/secret-object',
    sizeBytes: 12n,
    sourceResultId: null,
    status: 'mismatch',
    targetKey: 'node:node-1',
    taskId: 'task-1',
    versionId: null,
    workspaceId: 'workspace-a',
    ...overrides,
  };
}

function setup(initial = result()) {
  const acknowledgedAt = new Date('2026-08-14T01:00:00.000Z');
  const acknowledged = result({
    ...initial,
    acknowledgedAt,
    acknowledgedBy: 'admin-1',
  });
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce(initial)
    .mockResolvedValue(acknowledged);
  const transaction = {
    auditEvent: {
      create: jest.fn((input: AuditWrite) => {
        void input;
        return Promise.resolve({});
      }),
    },
    blobIntegrityResult: {
      findUnique,
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    fileNode: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    fileVersion: {
      findFirst: jest.fn(),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
  };
  const repository = new StorageIntegrityAcknowledgementRepository({
    $transaction: (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
  } as unknown as PrismaService);
  return { acknowledgedAt, repository, transaction };
}

describe('StorageIntegrityAcknowledgementRepository', () => {
  it('acknowledges a current node finding and records only safe audit metadata', async () => {
    const { acknowledgedAt, repository, transaction } = setup();

    await expect(
      repository.acknowledgeResult('result-1', 'admin-1'),
    ).resolves.toMatchObject({
      kind: 'acknowledged',
      result: {
        acknowledgedAt: acknowledgedAt.toISOString(),
        acknowledgedBy: 'admin-1',
        id: 'result-1',
      },
    });
    expect(transaction.blobIntegrityResult.updateMany).toHaveBeenCalledWith({
      data: {
        acknowledgedAt: expect.any(Date) as unknown,
        acknowledgedBy: 'admin-1',
      },
      where: {
        acknowledgedAt: null,
        checkedAt,
        id: 'result-1',
        nodeId: 'node-1',
        objectKey: 'private/secret-object',
        status: 'mismatch',
        versionId: null,
      },
    });

    expect(transaction.fileNode.updateMany).toHaveBeenCalledWith({
      data: {
        integrityAcknowledgedAt: expect.any(Date) as unknown,
        integrityAcknowledgedBy: 'admin-1',
      },
      where: {
        id: 'node-1',
        integrityStatus: 'mismatch',
        lastVerifiedAt: checkedAt,
        objectKey: 'private/secret-object',
        workspaceId: 'workspace-a',
      },
    });
    expect(transaction.fileVersion.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
    const audit = transaction.auditEvent.create.mock.calls[0]?.[0]?.data;
    expect(audit).toMatchObject({
      action: 'system.storage_integrity_result_acknowledged',
      nodeId: 'node-1',
      workspaceId: 'workspace-a',
      metadata: {
        actorUserId: 'admin-1',
        nodeId: 'node-1',
        resultId: 'result-1',
        taskId: 'task-1',
        status: 'mismatch',
        workspaceId: 'workspace-a',
      },
    });
    const payload = JSON.stringify(audit);
    expect(payload).not.toContain('private/secret-object');
    expect(payload).not.toContain('a'.repeat(64));
    expect(payload).not.toContain('b'.repeat(64));
    expect(payload).not.toContain('sensitive storage detail');
  });

  it('acknowledges only the current matching version finding', async () => {
    const initial = result({
      status: 'failed',
      targetKey: 'version:version-1',
      versionId: 'version-1',
    });
    const { repository, transaction } = setup(initial);

    await repository.acknowledgeResult('result-1', 'admin-1');

    expect(transaction.fileVersion.updateMany).toHaveBeenCalledWith({
      data: {
        integrityAcknowledgedAt: expect.any(Date) as unknown,
        integrityAcknowledgedBy: 'admin-1',
      },
      where: {
        id: 'version-1',
        integrityStatus: 'failed',
        lastVerifiedAt: checkedAt,
        nodeId: 'node-1',
        objectKey: 'private/secret-object',
        node: { workspaceId: 'workspace-a' },
      },
    });
    expect(transaction.fileNode.updateMany).not.toHaveBeenCalled();
    expect(
      transaction.auditEvent.create.mock.calls[0]?.[0]?.data.metadata,
    ).toMatchObject({
      nodeId: 'node-1',
      resultId: 'result-1',
      status: 'failed',
      taskId: 'task-1',
      versionId: 'version-1',
      workspaceId: 'workspace-a',
    });
  });

  it('acknowledges a node finding after its object moved into a version', async () => {
    const { repository, transaction } = setup();
    transaction.fileNode.updateMany.mockResolvedValueOnce({ count: 0 });
    transaction.fileVersion.findFirst.mockResolvedValueOnce({
      id: 'version-after-replacement',
    });

    await repository.acknowledgeResult('result-1', 'admin-1');

    expect(transaction.fileVersion.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      where: {
        integrityStatus: 'mismatch',
        lastVerifiedAt: checkedAt,
        nodeId: 'node-1',
        objectKey: 'private/secret-object',
        node: { workspaceId: 'workspace-a' },
      },
    });
    expect(transaction.fileVersion.updateMany).toHaveBeenCalledWith({
      data: {
        integrityAcknowledgedAt: expect.any(Date) as unknown,
        integrityAcknowledgedBy: 'admin-1',
      },
      where: {
        id: 'version-after-replacement',
        integrityStatus: 'mismatch',
        lastVerifiedAt: checkedAt,
        nodeId: 'node-1',
        objectKey: 'private/secret-object',
      },
    });
  });

  it('returns an existing acknowledgement without writing or auditing again', async () => {
    const alreadyAcknowledged = result({
      acknowledgedAt: checkedAt,
      acknowledgedBy: 'admin-original',
    });
    const { repository, transaction } = setup(alreadyAcknowledged);

    await expect(
      repository.acknowledgeResult('result-1', 'admin-1'),
    ).resolves.toMatchObject({
      kind: 'already-acknowledged',
      result: {
        acknowledgedAt: checkedAt.toISOString(),
        acknowledgedBy: 'admin-original',
      },
    });
    expect(transaction.blobIntegrityResult.updateMany).not.toHaveBeenCalled();
    expect(transaction.fileNode.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects matched results inside the acknowledgement transaction', async () => {
    const { repository, transaction } = setup(result({ status: 'matched' }));

    await expect(
      repository.acknowledgeResult('result-1', 'admin-1'),
    ).resolves.toEqual({ kind: 'invalid-status' });
    expect(transaction.blobIntegrityResult.updateMany).not.toHaveBeenCalled();
    expect(transaction.fileNode.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
