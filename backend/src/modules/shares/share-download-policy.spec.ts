import {
  resolveShareDownloadDecision,
  resolveShareDownloadPolicy,
} from './share-download-policy';
import type { SharePolicyDto, ShareResponse } from './shares.dto';

describe('share download policy', () => {
  const policy: SharePolicyDto = {
    waitValue: 2,
    waitUnit: 'minutes',
    speedValue: 512,
    speedUnit: 'KB/s',
    expiresValue: 7,
    expiresUnit: 'days',
    downloadLimit: '3',
    allowedDomain: '@example.com',
    emailAllowlist: ['Reviewer@Example.com', 'invalid'],
    maxDownloads: 0,
    maxViews: 5,
    rateLimitProfile: 'partner',
  };

  it('resolves one normalized policy for all visitor identities', () => {
    const resolved = resolveShareDownloadPolicy(policy);

    expect(resolved).toMatchObject({
      requiresAccessSession: true,
      requiresEmailVerification: true,
      allowedDomain: 'example.com',
      emailAllowlist: ['reviewer@example.com'],
      downloadLimit: '3',
      maxDownloads: 3,
      maxViews: 5,
      rateLimitProfile: 'partner',
      rules: {
        anonymous: {
          identityType: 'anonymous',
          waitSeconds: 120,
          speedLimit: { value: 512, unit: 'KB/s' },
          bypassWait: false,
          bypassSpeedLimit: false,
        },
        email: {
          identityType: 'email',
          waitSeconds: 120,
          speedLimit: { value: 512, unit: 'KB/s' },
        },
        ica: {
          identityType: 'ica',
          waitSeconds: 0,
          speedLimit: null,
          bypassWait: true,
          bypassSpeedLimit: true,
        },
        workspace: {
          identityType: 'workspace',
          waitSeconds: 0,
          speedLimit: null,
          bypassWait: true,
          bypassSpeedLimit: true,
        },
      },
    });
  });

  it('reports remaining downloads in policy decisions', () => {
    const share = {
      policy,
      downloadPolicy: resolveShareDownloadPolicy(policy),
    } as Pick<ShareResponse, 'downloadPolicy' | 'policy'>;

    expect(
      resolveShareDownloadDecision({
        downloadCount: 2,
        identityType: 'email',
        share,
      }),
    ).toMatchObject({
      identityType: 'email',
      maxDownloads: 3,
      remainingDownloads: 1,
      waitSeconds: 120,
    });

    expect(
      resolveShareDownloadDecision({
        downloadCount: 3,
        identityType: 'ica',
        share,
      }),
    ).toMatchObject({
      identityType: 'ica',
      maxDownloads: 3,
      remainingDownloads: 0,
      waitSeconds: 0,
      speedLimit: null,
    });
  });
});
