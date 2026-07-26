import { ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import type { CompleteSetupDto } from '../settings/settings.dto';
import {
  SetupOperationService,
  setupOperationClaimHeartbeatMilliseconds,
  setupOperationClaimLeaseMilliseconds,
  type SetupOperationClaim,
} from './setup-operation.service';

const bootstrapToken = 'configured-setup-bootstrap-token-2026';
const fingerprintSecret = 'stable-auth-security-secret-for-setup-tests';

type OperationMutation = {
  create?: Record<string, unknown>;
  data?: Record<string, unknown>;
  update?: Record<string, unknown>;
  where?: Record<string, unknown>;
};

type OperationRow = {
  claimExpiresAt: Date | null;
  completedAt: Date | null;
  irreversibleStartedAt: Date | null;
  operationKey: string;
  payloadFingerprint: string;
  status: string;
};

type OperationMutationMock<TResult = unknown> = jest.Mock<
  Promise<TResult>,
  [OperationMutation]
>;

describe('SetupOperationService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a claim without storing the setup payload or bootstrap token', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 0 });
    model.create.mockResolvedValue({});

    const claim = await service.claimComplete(createSetupDto());

    expect(claim.claimTokenHash).toHaveLength(43);
    expect(model.create).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(firstCall(model.create));
    expect(serialized).not.toContain('admin-password');
    expect(serialized).not.toContain('admin@example.com');
    expect(serialized).not.toContain(bootstrapToken);
    expect(serialized).not.toContain(fingerprintSecret);
  });

  it('generates the same HMAC fingerprint regardless of object key order', async () => {
    const first = createService();
    const second = createService();
    first.model.updateMany.mockResolvedValue({ count: 0 });
    first.model.create.mockResolvedValue({});
    second.model.updateMany.mockResolvedValue({ count: 0 });
    second.model.create.mockResolvedValue({});

    await first.service.claimComplete(createSetupDto());
    const reordered: CompleteSetupDto = {
      ...createSetupDto(),
      admin: {
        password: 'admin-password',
        email: 'admin@example.com',
        displayName: 'Administrator',
      },
    };
    await second.service.claimComplete(reordered);

    expect(createdFingerprint(first.model)).toBe(
      createdFingerprint(second.model),
    );
  });

  it('keeps recovery fingerprints stable when the setup token rotates', async () => {
    const first = createService({ bootstrapToken: 'first-bootstrap-token' });
    const second = createService({ bootstrapToken: 'rotated-bootstrap-token' });
    first.model.updateMany.mockResolvedValue({ count: 0 });
    first.model.create.mockResolvedValue({});
    second.model.updateMany.mockResolvedValue({ count: 0 });
    second.model.create.mockResolvedValue({});

    await first.service.claimComplete(createSetupDto());
    await second.service.claimComplete(createSetupDto());

    expect(createdFingerprint(first.model)).toBe(
      createdFingerprint(second.model),
    );
  });

  it('keeps recovery fingerprints keyed by the auth security secret', async () => {
    const first = createService({ fingerprintSecret: 'first-hmac-secret' });
    const second = createService({ fingerprintSecret: 'second-hmac-secret' });
    first.model.updateMany.mockResolvedValue({ count: 0 });
    first.model.create.mockResolvedValue({});
    second.model.updateMany.mockResolvedValue({ count: 0 });
    second.model.create.mockResolvedValue({});

    await first.service.claimComplete(createSetupDto());
    await second.service.claimComplete(createSetupDto());

    expect(createdFingerprint(first.model)).not.toBe(
      createdFingerprint(second.model),
    );
  });

  it('reclaims an expired or failed claim atomically', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 1 });

    const reclaimed = await service.claimComplete(createSetupDto());
    expect(reclaimed.claimTokenHash).toHaveLength(43);
    expect(reclaimed.payloadFingerprint).toHaveLength(43);
    expect(model.create).not.toHaveBeenCalled();
    const where = asRecord(firstCall(model.updateMany).where);
    expect(where.completedAt).toBeNull();
    expect(where.operationKey).toBe('setup-exclusive');
  });

  it('rejects a second owner while the current lease is active', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T03:00:00.000Z'));
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 0 });
    model.create.mockRejectedValue(new Error('duplicate key'));
    model.findUnique.mockResolvedValue({
      operationKey: 'setup-exclusive',
      status: 'running',
      payloadFingerprint: 'existing-fingerprint',
      irreversibleStartedAt: null,
      claimExpiresAt: new Date('2026-07-26T03:05:00.000Z'),
      completedAt: null,
    });

    await expectConflictCode(
      service.claimComplete(createSetupDto()),
      'SETUP_IN_PROGRESS',
    );
  });

  it('rejects a different payload after the irreversible stage starts', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 0 });
    model.create.mockRejectedValue(new Error('duplicate key'));
    model.findUnique.mockResolvedValue({
      operationKey: 'setup-exclusive',
      status: 'failed',
      payloadFingerprint: 'different-fingerprint',
      irreversibleStartedAt: new Date('2026-07-26T02:00:00.000Z'),
      claimExpiresAt: null,
      completedAt: null,
    });

    await expectConflictCode(
      service.claimComplete(createSetupDto()),
      'SETUP_PAYLOAD_LOCKED',
    );
  });

  it('marks the irreversible stage and completes only for the current owner', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 1 });
    const claim = createClaim();

    await service.markIrreversible(claim);
    await service.completeWithBootstrap(claim);

    const irreversible = firstCall(model.updateMany);
    expect(asRecord(irreversible.data).irreversibleStartedAt).toBeInstanceOf(
      Date,
    );
    expect(asRecord(irreversible.where).claimTokenHash).toBe(
      claim.claimTokenHash,
    );
    expect(asRecord(irreversible.where).status).toBe('running');

    const settingUpdate = asRecord(firstCall(model.settingUpsert).update);
    expect(asRecord(settingUpdate.value).completed).toBe(true);

    const completed = nthCall(model.updateMany, 2);
    expect(asRecord(completed.data).claimTokenHash).toBeNull();
    expect(asRecord(completed.data).completedAt).toBeInstanceOf(Date);
    expect(asRecord(completed.data).status).toBe('completed');
  });

  it('does not allow a stale owner to complete or release the claim', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 0 });
    const claim = createClaim();

    await expectConflictCode(
      service.completeWithBootstrap(claim),
      'SETUP_CLAIM_LOST',
    );
    await expectConflictCode(
      service.fail(claim, new Error('database password leaked here')),
      'SETUP_CLAIM_LOST',
    );
  });

  it('releases a failed claim without persisting the raw error message', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 1 });

    await service.fail(
      createClaim(),
      new Error('database password leaked here'),
    );

    const serialized = JSON.stringify(firstCall(model.updateMany));
    expect(serialized).not.toContain('database password leaked here');
    const failure = asRecord(firstCall(model.updateMany).data);
    expect(failure.claimExpiresAt).toBeNull();
    expect(failure.claimTokenHash).toBeNull();
    expect(failure.failureCode).toBe('SETUP_FAILED');
    expect(failure.status).toBe('failed');
  });

  it('runs transient setup operations under the same exclusive claim', async () => {
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 1 });
    const action = jest.fn(() => Promise.resolve('done'));

    await expect(
      service.runExclusive(
        'verify-database',
        { host: 'db.example.com' },
        action,
      ),
    ).resolves.toBe('done');

    expect(action).toHaveBeenCalledTimes(1);
    const released = nthCall(model.updateMany, 2);
    expect(asRecord(released.data).claimTokenHash).toBeNull();
    expect(asRecord(released.data).irreversibleStartedAt).toBeNull();
    expect(asRecord(released.data).status).toBe('idle');
  });

  it('returns a successful transient result when claim release fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { model, service } = createService();
    model.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const action = jest.fn(() => Promise.resolve('done'));

    await expect(
      service.runExclusive('mail-settings', {}, action),
    ).resolves.toBe('done');

    expect(action).toHaveBeenCalledTimes(1);
    expect(model.updateMany).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Setup claim release failed after successful mail-settings',
      ),
    );
    warn.mockRestore();
  });

  it('does not run a transient setup operation while completion owns the claim', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T03:00:00.000Z'));
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 0 });
    model.create.mockRejectedValue(new Error('duplicate key'));
    model.findUnique.mockResolvedValue({
      operationKey: 'setup-exclusive',
      status: 'running',
      payloadFingerprint: 'complete-fingerprint',
      irreversibleStartedAt: new Date('2026-07-26T02:59:00.000Z'),
      claimExpiresAt: new Date('2026-07-26T03:05:00.000Z'),
      completedAt: null,
    });
    const action = jest.fn();

    await expectConflictCode(
      service.runExclusive('mail-settings', {}, action),
      'SETUP_PAYLOAD_LOCKED',
    );
    expect(action).not.toHaveBeenCalled();
  });

  it('releases a transient claim through the active client after a database switch', async () => {
    const source = {
      create: jest.fn<Promise<unknown>, [OperationMutation]>(() =>
        Promise.resolve({}),
      ),
      findUnique: jest.fn<Promise<OperationRow | null>, [unknown]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [OperationMutation]>(() =>
        Promise.resolve({ count: 0 }),
      ),
    };
    const target = {
      create: jest.fn<Promise<unknown>, [OperationMutation]>(),
      findUnique: jest.fn<Promise<OperationRow | null>, [unknown]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [OperationMutation]>(() =>
        Promise.resolve({ count: 1 }),
      ),
    };
    let active = source;
    const prisma = {
      get setupOperation() {
        return active;
      },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'auth.securitySecret') return fingerprintSecret;
        if (key === 'setup.bootstrapToken') return bootstrapToken;
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new SetupOperationService(config, prisma);

    await service.runExclusive('verify-database', {}, () => {
      active = target;
      return Promise.resolve();
    });

    expect(source.create).toHaveBeenCalledTimes(1);
    expect(target.updateMany).toHaveBeenCalledTimes(1);
    expect(asRecord(firstCall(target.updateMany).data).status).toBe('idle');
  });

  it('renews the lease while a transient setup operation is still running', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T03:00:00.000Z'));
    const { model, service } = createService();
    model.updateMany.mockResolvedValue({ count: 1 });
    let finishAction: (() => void) | undefined;
    const action = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAction = resolve;
        }),
    );

    const running = service.runExclusive('verify-database', {}, action);
    await jest.advanceTimersByTimeAsync(0);
    expect(action).toHaveBeenCalledTimes(1);

    const elapsedMilliseconds = setupOperationClaimHeartbeatMilliseconds * 16;
    const heartbeatCount =
      elapsedMilliseconds / setupOperationClaimHeartbeatMilliseconds;
    await jest.advanceTimersByTimeAsync(elapsedMilliseconds);
    expect(model.updateMany).toHaveBeenCalledTimes(1 + heartbeatCount);
    const heartbeat = nthCall(model.updateMany, 1 + heartbeatCount);
    expect(asRecord(heartbeat.data).claimExpiresAt).toEqual(
      new Date(
        new Date('2026-07-26T03:00:00.000Z').getTime() +
          elapsedMilliseconds +
          setupOperationClaimLeaseMilliseconds,
      ),
    );

    finishAction?.();
    await running;
    expect(model.updateMany).toHaveBeenCalledTimes(18);
    const callCount = model.updateMany.mock.calls.length;

    await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(model.updateMany).toHaveBeenCalledTimes(callCount);
  });
});

function createService(
  options: { bootstrapToken?: string; fingerprintSecret?: string } = {},
) {
  const model = {
    create: jest.fn<Promise<unknown>, [OperationMutation]>(),
    findUnique: jest.fn<Promise<OperationRow | null>, [unknown]>(),
    settingUpsert: jest.fn<Promise<unknown>, [OperationMutation]>(),
    updateMany: jest.fn<Promise<{ count: number }>, [OperationMutation]>(),
  };
  const prisma = {
    setupOperation: model,
    setting: { upsert: model.settingUpsert },
    $transaction: jest.fn((run: (transaction: unknown) => Promise<unknown>) =>
      run({
        setupOperation: model,
        setting: { upsert: model.settingUpsert },
      }),
    ),
  } as unknown as PrismaService;
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'auth.securitySecret') {
        return options.fingerprintSecret ?? fingerprintSecret;
      }
      if (key === 'setup.bootstrapToken') {
        return options.bootstrapToken ?? bootstrapToken;
      }
      return undefined;
    }),
  } as unknown as ConfigService;
  return {
    model,
    service: new SetupOperationService(config, prisma),
  };
}

function createSetupDto(): CompleteSetupDto {
  return {
    admin: {
      displayName: 'Administrator',
      email: 'admin@example.com',
      password: 'admin-password',
    },
    distributedStorageEnabled: false,
    localEnabled: true,
    oauthEnabled: false,
    passkeyEnabled: false,
    sharePolicy: {
      allowPermanent: false,
      allowedDomains: [],
      anonymousAccess: 'blocked',
      audit: {
        alerts: false,
        anomaly: false,
        downloads: true,
        ip: true,
        userAgent: true,
      },
      defaultExpiresDays: 7,
      emailRule: 'any',
      maxExpiresDays: 30,
    },
    site: { siteName: 'ICEDR' },
  };
}

function createClaim(): SetupOperationClaim {
  return {
    claimTokenHash: 'claim-token-hash',
    payloadFingerprint: 'payload-fingerprint',
  };
}

function createdFingerprint(model: ReturnType<typeof createService>['model']) {
  return String(asRecord(firstCall(model.create).data).payloadFingerprint);
}

function firstCall(mock: OperationMutationMock) {
  return nthCall(mock, 1);
}

function nthCall<TResult>(
  mock: OperationMutationMock<TResult>,
  position: number,
) {
  const call = mock.mock.calls[position - 1];
  if (!call) throw new Error(`Expected mock call ${position}`);
  return call[0];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object record');
  }
  return value as Record<string, unknown>;
}

async function expectConflictCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected conflict ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code });
  }
}
