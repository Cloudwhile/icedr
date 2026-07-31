import { PasskeyStateConflictError } from './passkey.repository';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { PasskeyService } from './passkey.service';
import { BootstrapStateService } from '../../admin/setup/bootstrap-state.service';

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest.fn(),
  generateRegistrationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));

const user = {
  id: 'user_1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'member' as const,
  avatarUrl: null,
  locale: 'en',
  theme: null,
  timezone: null,
  createdAt: new Date(0).toISOString(),
};

function createService(bootstrapCompleted = true) {
  const passkeyRepository = {
    assertRateLimit: jest.fn(() => Promise.resolve()),
    claimChallenge: jest.fn(() =>
      Promise.resolve({
        id: 'ceremony_1',
        challenge: 'stored-challenge',
        claimToken: 'claim-token',
        flow: 'passkey-authentication',
        metadata: {},
        userId: null,
      }),
    ),
    completeAuthentication: jest.fn(() => Promise.resolve({ userId: user.id })),
    completeRegistration: jest.fn(() =>
      Promise.resolve({
        id: 'passkey_1',
        userId: user.id,
        credentialId: 'credential-1',
        publicKey: 'public-key',
        counter: 0n,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true,
        name: 'Windows · Chrome',
        aaguid: 'aaguid',
        createdUserAgent: 'Spec Browser',
        createdIpHash: 'ip-hash',
        lastUsedUserAgent: null,
        lastUsedIpHash: null,
        createdAt: new Date(0),
        lastUsedAt: null,
      }),
    ),
    deletePasskey: jest.fn(() => Promise.resolve(true)),
    createChallenge: jest.fn(() => Promise.resolve({ id: 'ceremony_1' })),
    findValidStepUpToken: jest.fn(() =>
      Promise.resolve({ tokenHash: 'step-up-hash' }),
    ),
    findPasskeyByCredentialId: jest.fn(() =>
      Promise.resolve({
        id: 'passkey_1',
        userId: user.id,
        credentialId: 'credential-1',
        publicKey: Buffer.from('public-key').toString('base64url'),
        counter: 0n,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true,
        name: 'Windows · Chrome',
        aaguid: 'aaguid',
        createdUserAgent: 'Spec Browser',
        createdIpHash: 'ip-hash',
        lastUsedUserAgent: null,
        lastUsedIpHash: null,
        createdAt: new Date(0),
        lastUsedAt: null,
      }),
    ),
    hashOpaqueToken: jest.fn(() => 'step-up-hash'),
    listPasskeysForUser: jest.fn(() => Promise.resolve([])),
    recordChallengeFailure: jest.fn(() => Promise.resolve(1)),
  };
  const authRepository = {
    getSettings: jest.fn(() =>
      Promise.resolve({
        localEnabled: true,
        oauthEnabled: false,
        passkeyEnabled: true,
        minimumAuthenticationMethods: 1,
        updatedAt: new Date(0).toISOString(),
      }),
    ),
    findUserById: jest.fn(() => Promise.resolve(user)),
  };
  const settingsService = {
    getPasskeySettings: jest.fn(() =>
      Promise.resolve({
        origin: 'https://drive.example.com',
        rpId: 'drive.example.com',
        rpName: 'ICEDR',
      }),
    ),
    passkeyConfigured: jest.fn(() => true),
  };
  const adminGuard = {
    requireSession: jest.fn(() =>
      Promise.resolve({
        tokenHash: 'session-hash',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        user,
      }),
    ),
  };
  const config = { get: jest.fn() };
  const mailService = {
    sendSecurityNotification: jest.fn(() => Promise.resolve()),
  };
  const auditService = {
    record: jest.fn(() => Promise.resolve()),
    recordSuccess: jest.fn(() => Promise.resolve()),
  };
  const bootstrapState = {
    requireCompleted: jest.fn(() =>
      bootstrapCompleted
        ? Promise.resolve()
        : Promise.reject(
            new ServiceUnavailableException({
              code: 'SETUP_REQUIRED',
              message: 'Initial setup must be completed',
            }),
          ),
    ),
  } as unknown as BootstrapStateService;

  return {
    auditService,
    mailService,
    passkeyRepository,
    service: new PasskeyService(
      passkeyRepository as never,
      authRepository as never,
      settingsService as never,
      adminGuard as never,
      config as never,
      mailService as never,
      auditService as never,
      bootstrapState,
    ),
  };
}

function request() {
  return {
    get: jest.fn((name: string) =>
      name.toLowerCase() === 'user-agent' ? 'Spec Browser' : undefined,
    ),
    ip: '203.0.113.7',
    socket: { remoteAddress: '203.0.113.7' },
  } as unknown as Request;
}

describe('PasskeyService ceremony options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects anonymous Passkey options before rate limiting while setup is incomplete', async () => {
    const { passkeyRepository, service } = createService(false);

    await expect(
      service.createAuthenticationOptions(request()),
    ).rejects.toMatchObject({ response: { code: 'SETUP_REQUIRED' } });
    expect(passkeyRepository.assertRateLimit).not.toHaveBeenCalled();
    expect(generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it('creates username-less authentication options without an email or credential allow-list', async () => {
    jest.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'authentication-challenge',
      rpId: 'drive.example.com',
      timeout: 60_000,
      userVerification: 'required',
    });
    const { passkeyRepository, service } = createService();

    const result = await service.createAuthenticationOptions(request());

    expect(result.ceremonyId).toBe('ceremony_1');
    expect(result.expectedOrigin).toBe('https://drive.example.com');
    expect(result.options.challenge).toBe('authentication-challenge');
    expect(result.options.userVerification).toBe('required');

    expect(generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: 'drive.example.com',
      userVerification: 'required',
    });
    expect(passkeyRepository.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: 'authentication-challenge',
        flow: 'passkey-authentication',
        userId: null,
      }),
    );
    expect(
      passkeyRepository.createChallenge.mock.calls[0]?.[0],
    ).not.toHaveProperty('email');
  });

  it('registers a discoverable credential under the stable internal user id', async () => {
    jest.mocked(generateRegistrationOptions).mockResolvedValue({
      attestation: 'none',
      challenge: 'registration-challenge',
      excludeCredentials: [],
      pubKeyCredParams: [],
      rp: { id: 'drive.example.com', name: 'ICEDR' },
      timeout: 60_000,
      user: {
        displayName: 'User',
        id: 'dXNlcl8x',
        name: 'user_1',
      },
    });
    const { passkeyRepository, service } = createService();

    const result = await service.createRegistrationOptions(
      { stepUpToken: 'step-up-token' },
      'Bearer session',
      request(),
    );

    expect(result.expectedOrigin).toBe('https://drive.example.com');

    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        userDisplayName: 'User',
        userID: Buffer.from('user_1'),
        userName: 'user_1',
      }),
    );
    expect(passkeyRepository.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'passkey-registration',
        stepUpTokenHash: 'step-up-hash',
        userId: 'user_1',
      }),
    );
  });

  it('returns a stable compatible 401 when recent authentication is required', async () => {
    const { passkeyRepository, service } = createService();
    passkeyRepository.findValidStepUpToken.mockResolvedValueOnce(null as never);

    await expect(
      service.createRegistrationOptions(
        { stepUpToken: 'expired-step-up-token' },
        'Bearer session',
        request(),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_REAUTH_REQUIRED',
        error: 'Unauthorized',
        message: 'Recent authentication is required',
        statusCode: 401,
      },
      status: 401,
    });
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });
});

describe('PasskeyService ceremony verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires user verification and commits authentication as one repository operation', async () => {
    jest.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'credential-1',
        newCounter: 7,
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'https://drive.example.com',
        rpID: 'drive.example.com',
      },
    });
    const { passkeyRepository, service } = createService();
    const response = {
      id: 'credential-1',
      rawId: 'credential-1',
      response: {
        authenticatorData: 'authenticator-data',
        clientDataJSON: 'client-data',
        signature: 'signature',
      },
      type: 'public-key',
      clientExtensionResults: {},
    };

    const result = await service.verifyAuthentication(
      { ceremonyId: 'ceremony_1', response },
      request(),
    );

    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'stored-challenge',
        expectedOrigin: 'https://drive.example.com',
        expectedRPID: 'drive.example.com',
        requireUserVerification: true,
      }),
    );
    expect(passkeyRepository.completeAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        ceremonyId: 'ceremony_1',
        claimToken: 'claim-token',
        counter: 7,
        credentialId: 'credential-1',
      }),
    );
    expect(result.token).toMatch(/^sess_/);
    expect(result.user).toEqual(user);
  });

  it('records a failed attempt and releases the ceremony claim', async () => {
    jest
      .mocked(verifyAuthenticationResponse)
      .mockRejectedValue(new Error('signature mismatch'));
    const { passkeyRepository, service } = createService();

    await expect(
      service.verifyAuthentication(
        {
          ceremonyId: 'ceremony_1',
          response: {
            id: 'credential-1',
            rawId: 'credential-1',
            response: {},
            type: 'public-key',
            clientExtensionResults: {},
          },
        },
        request(),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PASSKEY_VERIFICATION_FAILED',
      },
    });
    expect(passkeyRepository.recordChallengeFailure).toHaveBeenCalledWith(
      'ceremony_1',
      'claim-token',
    );
    expect(passkeyRepository.completeAuthentication).not.toHaveBeenCalled();
  });

  it('requires user verification and commits registration with its step-up token', async () => {
    jest.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: 'aaguid',
        credential: {
          id: 'credential-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        origin: 'https://drive.example.com',
        rpID: 'drive.example.com',
      },
    });
    const { passkeyRepository, service } = createService();
    passkeyRepository.claimChallenge.mockResolvedValue({
      id: 'ceremony_1',
      challenge: 'stored-challenge',
      claimToken: 'claim-token',
      flow: 'passkey-registration',
      metadata: { stepUpTokenHash: 'step-up-hash' },
      userId: user.id,
    });

    await service.verifyRegistration(
      {
        ceremonyId: 'ceremony_1',
        response: {
          id: 'credential-1',
          rawId: 'credential-1',
          response: {},
          type: 'public-key',
          clientExtensionResults: {},
        },
      },
      'Bearer session',
      request(),
    );

    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'stored-challenge',
        expectedOrigin: 'https://drive.example.com',
        expectedRPID: 'drive.example.com',
        requireUserVerification: true,
      }),
    );
    expect(passkeyRepository.completeRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        ceremonyId: 'ceremony_1',
        claimToken: 'claim-token',
        stepUpTokenHash: 'step-up-hash',
        userId: user.id,
      }),
    );
  });

  it('reports the authentication policy when deletion would remove the last usable method', async () => {
    const { passkeyRepository, service } = createService();
    passkeyRepository.deletePasskey.mockRejectedValue(
      new PasskeyStateConflictError('Authentication method policy'),
    );

    await expect(
      service.deletePasskey(
        'passkey_1',
        { stepUpToken: 'stepup-token-long-enough' },
        'Bearer session',
        request(),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_METHOD_POLICY_REQUIRED',
      },
    });
  });
});
