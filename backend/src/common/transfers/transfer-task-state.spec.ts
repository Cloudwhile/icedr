import {
  canTransitionTransferTask,
  createTransferTaskLifecycle,
  getTransferTaskTransitionSources,
  normalizeTransferTaskStatus,
  transferTaskFailureCodes,
  transferTaskStatuses,
} from './transfer-task-state';

const failureCodeRetryability = [
  ['TRANSFER_FAILED', true],
  ['TRANSFER_EXPIRED', true],
  ['TRANSFER_STALLED', true],
  ['UPLOAD_FAILED', true],
  ['UPLOAD_SESSION_EXPIRED', true],
  ['DOWNLOAD_INTENT_EXPIRED', true],
  ['DOWNLOAD_FAILED', true],
  ['PREVIEW_UNSUPPORTED', false],
  ['PREVIEW_TOO_LARGE', false],
  ['STORAGE_RECONCILE_FAILED', true],
] as const;

describe('transfer task state', () => {
  it.each([
    ['pending', 'running', true],
    ['running', 'paused', true],
    ['paused', 'running', true],
    ['running', 'completed', true],
    ['failed', 'running', true],
    ['completed', 'running', false],
    ['canceled', 'running', false],
    ['expired', 'running', false],
  ] as const)(
    'reports %s -> %s as %s',
    (currentStatus, nextStatus, expected) => {
      expect(canTransitionTransferTask(currentStatus, nextStatus)).toBe(
        expected,
      );
    },
  );

  it.each([
    ['queued', 'pending'],
    ['ready', 'completed'],
    ['unsupported', 'failed'],
    ['cancelled', 'canceled'],
  ] as const)('normalizes legacy status %s to %s', (value, expected) => {
    expect(normalizeTransferTaskStatus(value)).toBe(expected);
  });

  it('matches the complete allowed transition matrix', () => {
    const allowed = {
      pending: ['running', 'completed', 'failed', 'expired', 'canceled'],
      running: ['paused', 'completed', 'failed', 'expired', 'canceled'],
      paused: ['running', 'failed', 'expired', 'canceled'],
      completed: [],
      failed: ['pending', 'running', 'expired', 'canceled'],
      expired: [],
      canceled: [],
    } as const;

    for (const currentStatus of transferTaskStatuses) {
      for (const nextStatus of transferTaskStatuses) {
        expect(canTransitionTransferTask(currentStatus, nextStatus)).toBe(
          currentStatus === nextStatus ||
            (allowed[currentStatus] as readonly string[]).includes(nextStatus),
        );
      }
    }
  });

  it('exposes an elapsed active task as expired', () => {
    expect(
      createTransferTaskLifecycle(
        {
          status: 'running',
          failureCode: null,
          failureMessage: null,
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
          updatedAt: new Date('2026-07-18T00:01:00.000Z'),
          expiresAt: new Date('2026-07-18T00:05:00.000Z'),
        },
        new Date('2026-07-18T00:06:00.000Z'),
      ),
    ).toEqual({
      status: 'expired',
      errorCode: 'TRANSFER_EXPIRED',
      errorMessage: null,
      retryable: true,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:01:00.000Z',
      expiresAt: '2026-07-18T00:05:00.000Z',
    });
  });

  it('treats the exact expiry instant as expired', () => {
    const expiresAt = new Date('2026-07-18T00:05:00.000Z');

    expect(
      createTransferTaskLifecycle(
        {
          status: 'paused',
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
          updatedAt: new Date('2026-07-18T00:01:00.000Z'),
          expiresAt,
        },
        expiresAt,
      ),
    ).toMatchObject({
      status: 'expired',
      errorCode: 'TRANSFER_EXPIRED',
      retryable: true,
    });
  });

  it('fails closed for unknown states and missing failure codes', () => {
    expect(normalizeTransferTaskStatus('mystery')).toBe('failed');
    expect(
      canTransitionTransferTask('mystery' as never, 'mystery' as never),
    ).toBe(false);
    expect(
      createTransferTaskLifecycle({
        status: 'mystery',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
        updatedAt: new Date('2026-07-18T00:01:00.000Z'),
      }),
    ).toMatchObject({
      status: 'failed',
      errorCode: 'TRANSFER_FAILED',
      retryable: true,
    });
  });

  it.each(failureCodeRetryability)(
    'reports failure code %s retryable as %s',
    (failureCode, retryable) => {
      expect(
        createTransferTaskLifecycle({
          status: 'failed',
          failureCode,
          createdAt: new Date('2026-07-18T00:00:00.000Z'),
          updatedAt: new Date('2026-07-18T00:01:00.000Z'),
        }),
      ).toMatchObject({ errorCode: failureCode, retryable });
    },
  );

  it('keeps the failure-code retryability matrix exhaustive', () => {
    const coveredCodes = failureCodeRetryability
      .map(([failureCode]) => failureCode)
      .sort();
    const declaredCodes = [...transferTaskFailureCodes].sort();

    expect(coveredCodes).toEqual(declaredCodes);
    expect(new Set(coveredCodes).size).toBe(coveredCodes.length);
  });

  it('does not expose stale failure metadata on successful tasks', () => {
    expect(
      createTransferTaskLifecycle({
        status: 'completed',
        failureCode: 'UPLOAD_FAILED',
        failureMessage: 'stale failure',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
        updatedAt: new Date('2026-07-18T00:01:00.000Z'),
      }),
    ).toMatchObject({
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      retryable: false,
    });
  });

  it('excludes terminal tasks from running transition sources', () => {
    expect(getTransferTaskTransitionSources('running')).toEqual([
      'pending',
      'running',
      'paused',
      'failed',
    ]);
  });
});
