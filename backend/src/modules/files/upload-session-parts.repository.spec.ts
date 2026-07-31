import { UploadSessionsRepository } from './upload-sessions.repository';
import {
  createUploadSessionRow,
  readPath,
} from './upload-session-test-fixtures';

describe('UploadSessionsRepository part writes', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('claims a part write only while its transfer remains running', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    const updateTransfer = jest.fn(() => Promise.resolve({ count: 1 }));
    const updateSession = jest.fn((input: { data: Record<string, unknown> }) =>
      Promise.resolve([
        createUploadSessionRow({ ...input.data, status: 'running' }),
      ]),
    );
    const tx = {
      uploadSession: { updateManyAndReturn: updateSession },
      transferTask: { updateMany: updateTransfer },
    };
    const repository = new UploadSessionsRepository({
      uploadSession: {
        findUnique: jest.fn(() =>
          Promise.resolve({ transferId: 'transfer_test' }),
        ),
      },
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    const claim = await repository.claimPartWrite('upload_session_test');

    expect(claim?.writeToken).toMatch(/^part_/);
    expect(updateTransfer).toHaveBeenCalledWith({
      where: {
        id: 'transfer_test',
        transferType: 'upload',
        status: 'running',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) as unknown } },
        ],
      },
      data: { updatedAt: expect.any(Date) as unknown },
    });
    expect(
      readPath(updateSession.mock.calls as unknown, [0, 0, 'where']),
    ).toMatchObject({
      id: 'upload_session_test',
      storageFinalizedAt: null,
    });
  });

  it('commits a part and releases only the exact write token atomically', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
    const updateSession = jest
      .fn()
      .mockResolvedValueOnce([
        createUploadSessionRow({ completionToken: 'part-token' }),
      ])
      .mockResolvedValueOnce([
        createUploadSessionRow({ completionToken: null }),
      ]);
    const upsert = jest.fn(() =>
      Promise.resolve({
        sessionId: 'upload_session_test',
        partIndex: 0,
      }),
    );
    const tx = {
      uploadSession: { updateManyAndReturn: updateSession },
      uploadSessionPart: { upsert },
    };
    const repository = new UploadSessionsRepository({
      $transaction: jest.fn(
        (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      ),
    } as never);

    await expect(
      repository.commitPartWrite('part-token', {
        sessionId: 'upload_session_test',
        partIndex: 0,
        startByte: 0,
        endByte: 255,
        sizeBytes: 256,
        eTag: '"etag-0"',
      }),
    ).resolves.toMatchObject({ status: 'running' });

    const updateCalls = updateSession.mock.calls as unknown;
    expect(readPath(updateCalls, [0, 0])).toMatchObject({
      where: {
        id: 'upload_session_test',
        status: 'running',
        completionToken: 'part-token',
        storageFinalizedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: {} }],
      },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(readPath(updateCalls, [1, 0])).toMatchObject({
      where: {
        id: 'upload_session_test',
        status: 'running',
        completionToken: 'part-token',
        storageFinalizedAt: null,
      },
      data: { completionToken: null, completionStartedAt: null },
    });
  });
});
