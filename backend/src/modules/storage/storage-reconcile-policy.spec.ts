import {
  isPreviewObjectReferenceProtected,
  isTransferObjectReferenceProtected,
  isUploadSessionObjectReferenceProtected,
  isUploadSessionStagingCleanupProtected,
  type ReconcileProtectionWindow,
} from './storage-reconcile-policy';

describe('storage reconcile protection policy', () => {
  const window: ReconcileProtectionWindow = {
    completionClaimStaleBefore: new Date('2026-07-18T01:45:00.000Z'),
    now: new Date('2026-07-18T02:00:00.000Z'),
    staleBefore: new Date('2026-07-18T01:00:00.000Z'),
  };

  it('fails safe for unknown transfer and preview states', () => {
    const reference = {
      expiresAt: null,
      status: 'future-state',
      updatedAt: new Date(0),
    };

    expect(isTransferObjectReferenceProtected(reference, window)).toBe(true);
    expect(isPreviewObjectReferenceProtected(reference, window)).toBe(true);
  });

  it.each(['pending', 'queued', 'paused'])(
    'expires a stale legacy %s reference without a fixed expiry',
    (status) => {
      expect(
        isTransferObjectReferenceProtected(
          {
            expiresAt: null,
            status,
            updatedAt: new Date('2026-07-18T00:59:59.999Z'),
          },
          window,
        ),
      ).toBe(false);
    },
  );

  it('keeps recent legacy active references and fixed paused expiry', () => {
    expect(
      isTransferObjectReferenceProtected(
        {
          expiresAt: null,
          status: 'queued',
          updatedAt: new Date('2026-07-18T01:00:00.000Z'),
        },
        window,
      ),
    ).toBe(true);
    expect(
      isTransferObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T03:00:00.000Z'),
          status: 'paused',
          updatedAt: new Date(0),
        },
        window,
      ),
    ).toBe(true);
  });

  it('expires running references by heartbeat or fixed expiry', () => {
    expect(
      isTransferObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T03:00:00.000Z'),
          status: 'running',
          updatedAt: new Date('2026-07-18T00:59:59.999Z'),
        },
        window,
      ),
    ).toBe(false);
    expect(
      isTransferObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T02:00:00.000Z'),
          status: 'running',
          updatedAt: new Date('2026-07-18T01:59:00.000Z'),
        },
        window,
      ),
    ).toBe(false);
  });

  it('keeps a retryable failed upload until its fixed session boundary', () => {
    expect(
      isTransferObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T03:00:00.000Z'),
          status: 'failed',
          updatedAt: new Date(0),
        },
        window,
      ),
    ).toBe(true);
    expect(
      isTransferObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T02:00:00.000Z'),
          status: 'failed',
          updatedAt: new Date('2026-07-18T01:59:00.000Z'),
        },
        window,
      ),
    ).toBe(false);
  });

  it('keeps unexpired completed previews and releases them at the expiry boundary', () => {
    expect(
      isPreviewObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T02:00:00.001Z'),
          status: 'ready',
          updatedAt: new Date(0),
        },
        window,
      ),
    ).toBe(true);
    expect(
      isPreviewObjectReferenceProtected(
        {
          expiresAt: new Date('2026-07-18T02:00:00.000Z'),
          status: 'completed',
          updatedAt: new Date('2026-07-18T01:59:00.000Z'),
        },
        window,
      ),
    ).toBe(false);
  });

  it('releases stale active previews without a fixed expiry', () => {
    expect(
      isPreviewObjectReferenceProtected(
        {
          expiresAt: null,
          status: 'pending',
          updatedAt: new Date(0),
        },
        window,
      ),
    ).toBe(false);
  });

  it('protects upload completion leases and finalized-to-node recovery windows', () => {
    expect(
      isUploadSessionObjectReferenceProtected(
        {
          completionStartedAt: new Date('2026-07-18T01:59:00.000Z'),
          completionToken: 'active-claim',
          expiresAt: new Date('2026-07-18T01:30:00.000Z'),
          status: 'running',
          storageFinalizedAt: null,
          updatedAt: new Date(0),
        },
        window,
      ),
    ).toBe(true);
    expect(
      isUploadSessionObjectReferenceProtected(
        {
          completionStartedAt: new Date('2026-07-18T01:00:00.000Z'),
          completionToken: 'stale-claim',
          expiresAt: new Date('2026-07-18T03:00:00.000Z'),
          status: 'running',
          storageFinalizedAt: new Date('2026-07-18T01:01:00.000Z'),
          updatedAt: new Date(0),
        },
        window,
      ),
    ).toBe(true);
  });

  it('protects a fresh completion claim from staging cleanup after expiry', () => {
    expect(
      isUploadSessionStagingCleanupProtected(
        {
          completionStartedAt: new Date('2026-07-18T01:59:00.000Z'),
          completionToken: 'active-claim',
          createdAt: new Date('2026-07-17T00:00:00.000Z'),
          expiresAt: new Date('2026-07-18T01:30:00.000Z'),
          status: 'running',
          storageFinalizedAt: null,
          transferId: 'transfer-1',
          updatedAt: new Date(0),
          uploadSessionId: 'session-1',
        },
        window,
      ),
    ).toBe(true);
  });

  it('uses the shared 24 hour deadline for legacy upload sessions', () => {
    const reference = {
      completionStartedAt: null,
      completionToken: null,
      expiresAt: null,
      status: 'running',
      storageFinalizedAt: null,
      transferId: 'transfer-1',
      updatedAt: new Date(0),
      uploadSessionId: 'session-1',
    };

    expect(
      isUploadSessionStagingCleanupProtected(
        {
          ...reference,
          createdAt: new Date('2026-07-17T02:00:00.001Z'),
        },
        window,
      ),
    ).toBe(true);
    expect(
      isUploadSessionStagingCleanupProtected(
        {
          ...reference,
          createdAt: new Date('2026-07-17T02:00:00.000Z'),
        },
        window,
      ),
    ).toBe(false);
  });

  it('fails safe for unknown upload session states during staging cleanup', () => {
    expect(
      isUploadSessionStagingCleanupProtected(
        {
          completionStartedAt: null,
          completionToken: null,
          createdAt: new Date(0),
          expiresAt: new Date(0),
          status: 'future-state',
          storageFinalizedAt: null,
          transferId: 'transfer-1',
          updatedAt: new Date(0),
          uploadSessionId: 'session-1',
        },
        window,
      ),
    ).toBe(true);
  });
});
