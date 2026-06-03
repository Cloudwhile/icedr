import type { ShareAccessIdentityType } from './share-access.dto';
import type { SharePolicyDto, ShareResponse } from './shares.dto';

export type ShareDownloadSpeedLimit = {
  value: number;
  unit: 'KB/s' | 'MB/s';
} | null;

export type ShareDownloadRule = {
  identityType: ShareAccessIdentityType;
  waitSeconds: number;
  speedLimit: ShareDownloadSpeedLimit;
  bypassWait: boolean;
  bypassSpeedLimit: boolean;
};

export type ShareDownloadPolicy = {
  requiresAccessSession: boolean;
  requiresEmailVerification: boolean;
  allowedDomain: string;
  emailAllowlist: string[];
  maxDownloads: number;
  maxViews: number;
  downloadLimit: string;
  rateLimitProfile: string;
  rules: Record<ShareAccessIdentityType, ShareDownloadRule>;
};

export type ShareDownloadPolicyDecision = ShareDownloadRule & {
  downloadLimit: string;
  maxDownloads: number;
  remainingDownloads: number | null;
  requiresAccessSession: boolean;
  requiresEmailVerification: boolean;
};

export function resolveShareDownloadPolicy(
  policy: SharePolicyDto,
): ShareDownloadPolicy {
  const waitSeconds = getPolicyWaitSeconds(policy);
  const visitorSpeedLimit = getPolicySpeedLimit(policy);
  const allowedDomain = normalizePolicyDomain(policy.allowedDomain);
  const emailAllowlist = normalizePolicyEmailAllowlist(policy.emailAllowlist);
  const downloadLimit = policy.downloadLimit?.trim() ?? '';
  const maxDownloads = resolveMaxDownloads(policy);
  const maxViews = Math.max(0, Math.trunc(policy.maxViews ?? 0));
  const requiresEmailVerification =
    Boolean(allowedDomain) || emailAllowlist.length > 0;
  const requiresAccessSession =
    requiresEmailVerification || waitSeconds > 0 || maxDownloads > 0;

  return {
    requiresAccessSession,
    requiresEmailVerification,
    allowedDomain,
    emailAllowlist,
    maxDownloads,
    maxViews,
    downloadLimit,
    rateLimitProfile: policy.rateLimitProfile?.trim() ?? '',
    rules: {
      anonymous: createRule('anonymous', waitSeconds, visitorSpeedLimit, {
        bypassWait: false,
        bypassSpeedLimit: false,
      }),
      email: createRule('email', waitSeconds, visitorSpeedLimit, {
        bypassWait: false,
        bypassSpeedLimit: false,
      }),
      ica: createRule('ica', 0, null, {
        bypassWait: true,
        bypassSpeedLimit: true,
      }),
      workspace: createRule('workspace', 0, null, {
        bypassWait: true,
        bypassSpeedLimit: true,
      }),
    },
  };
}

export function resolveShareDownloadDecision({
  downloadCount,
  identityType,
  share,
}: {
  downloadCount: number;
  identityType: ShareAccessIdentityType;
  share: Pick<ShareResponse, 'downloadPolicy' | 'policy'>;
}): ShareDownloadPolicyDecision {
  const policy =
    share.downloadPolicy ?? resolveShareDownloadPolicy(share.policy);
  const rule = policy.rules[identityType] ?? policy.rules.anonymous;
  const remainingDownloads =
    policy.maxDownloads > 0
      ? Math.max(0, policy.maxDownloads - Math.max(0, downloadCount))
      : null;

  return {
    ...rule,
    downloadLimit: policy.downloadLimit,
    maxDownloads: policy.maxDownloads,
    remainingDownloads,
    requiresAccessSession: policy.requiresAccessSession,
    requiresEmailVerification: policy.requiresEmailVerification,
  };
}

export function toSharePolicyAuditMetadata(
  decision: ShareDownloadPolicyDecision,
) {
  return {
    identityType: decision.identityType,
    waitSeconds: decision.waitSeconds,
    speedLimit: decision.speedLimit,
    bypassWait: decision.bypassWait,
    bypassSpeedLimit: decision.bypassSpeedLimit,
    downloadLimit: decision.downloadLimit,
    maxDownloads: decision.maxDownloads,
    remainingDownloads: decision.remainingDownloads,
    requiresAccessSession: decision.requiresAccessSession,
    requiresEmailVerification: decision.requiresEmailVerification,
  };
}

export function getPolicyWaitSeconds(policy: SharePolicyDto) {
  const value = Math.max(0, Math.trunc(policy.waitValue ?? 0));
  return policy.waitUnit === 'minutes' ? value * 60 : value;
}

export function resolveMaxDownloads(policy: SharePolicyDto) {
  const explicit = Math.max(0, Math.trunc(policy.maxDownloads ?? 0));
  if (explicit > 0) return explicit;
  const parsed = Number.parseInt(policy.downloadLimit || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function createRule(
  identityType: ShareAccessIdentityType,
  waitSeconds: number,
  speedLimit: ShareDownloadSpeedLimit,
  flags: { bypassWait: boolean; bypassSpeedLimit: boolean },
): ShareDownloadRule {
  return {
    identityType,
    waitSeconds,
    speedLimit,
    bypassWait: flags.bypassWait,
    bypassSpeedLimit: flags.bypassSpeedLimit,
  };
}

function getPolicySpeedLimit(policy: SharePolicyDto): ShareDownloadSpeedLimit {
  const value = Math.max(0, Math.trunc(policy.speedValue ?? 0));
  const unit = policy.speedUnit === 'MB/s' ? 'MB/s' : 'KB/s';
  return value > 0 ? { value, unit } : null;
}

export function normalizePolicyDomain(domain?: string | null) {
  if (!domain) return '';
  const normalized = domain.trim().toLowerCase();
  return normalized.startsWith('@') ? normalized.slice(1) : normalized;
}

export function normalizePolicyEmailAllowlist(emails: unknown) {
  if (!Array.isArray(emails)) return [];
  return [
    ...new Set(
      emails
        .filter((email): email is string => typeof email === 'string')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    ),
  ];
}
