import {
  normalizePolicyDomain,
  normalizePolicyEmailAllowlist,
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

  it('falls back to KB/s for invalid speed units', () => {
    const resolved = resolveShareDownloadPolicy({
      ...policy,
      speedUnit: 'bogus' as SharePolicyDto['speedUnit'],
    });

    expect(resolved.rules.anonymous.speedLimit).toEqual({
      value: 512,
      unit: 'KB/s',
    });
  });

  it('does not require access sessions for invalid download limits', () => {
    expect(
      resolveShareDownloadPolicy({
        ...policy,
        allowedDomain: '',
        emailAllowlist: [],
        downloadLimit: '0',
        maxDownloads: 0,
        waitValue: 0,
      }),
    ).toMatchObject({
      maxDownloads: 0,
      requiresAccessSession: false,
    });
    expect(
      resolveShareDownloadPolicy({
        ...policy,
        allowedDomain: '',
        emailAllowlist: [],
        downloadLimit: 'abc',
        maxDownloads: 0,
        waitValue: 0,
      }),
    ).toMatchObject({
      maxDownloads: 0,
      requiresAccessSession: false,
    });
  });

  it('normalizes policy domains defensively', () => {
    expect(normalizePolicyDomain(null)).toBe('');
    expect(normalizePolicyDomain(undefined)).toBe('');
    expect(normalizePolicyDomain(' @Example.COM ')).toBe('example.com');
  });

  it('normalizes email allowlists defensively', () => {
    expect(normalizePolicyEmailAllowlist(null)).toEqual([]);
    expect(normalizePolicyEmailAllowlist(undefined)).toEqual([]);
    expect(normalizePolicyEmailAllowlist('reviewer@example.com')).toEqual([]);
    expect(
      normalizePolicyEmailAllowlist([
        null,
        undefined,
        ' Reviewer@Example.com ',
        'reviewer@example.com',
        'invalid',
        42,
        'owner@example.org',
      ]),
    ).toEqual(['reviewer@example.com', 'owner@example.org']);
  });
});
