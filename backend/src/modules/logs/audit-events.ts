import { randomBytes } from 'crypto';

export type AuditActor = 'workspace' | 'account' | 'visitor' | 'system';
export type AuditResult = 'success' | 'failed';
export type AuditResourceType = 'file' | 'share' | 'transfer' | 'system';
export type AuditSortBy = 'createdAt' | 'action' | 'actor';
export type AuditSortDirection = 'asc' | 'desc';
export type AuditScope =
  | { kind: 'all' }
  | { kind: 'system' }
  | { kind: 'workspace'; workspaceId: string };

export type AuditEventRecord = {
  id: string;
  action: string;
  actor: AuditActor;
  target: string;
  workspaceId: string | null;
  shareToken: string | null;
  nodeId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorDisplayName: string | null;
  actorEmail: string | null;
  actorUserId: string | null;
  ipAddress: string | null;
  resourceType: AuditResourceType;
  result: AuditResult;
};

export type AuditEventInput = {
  action: string;
  actor: AuditActor;
  target: string;
  workspaceId?: string | null;
  shareToken?: string | null;
  nodeId?: string | null;
  metadata?: Record<string, unknown>;
};

export type AuditEventFilters = {
  scope?: 'all' | 'system' | 'workspace';
  workspaceId?: string;
  shareToken?: string;
  nodeId?: string;
  actor?: AuditActor;
  action?: string;
  result?: AuditResult;
  resourceType?: AuditResourceType;
  ipAddress?: string;
  query?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: AuditSortBy;
  sortDirection?: AuditSortDirection;
  limit?: number;
  offset?: number;
};

export type AuditEventPage = {
  items: AuditEventRecord[];
  total: number;
  limit: number;
  offset: number;
  facets: {
    actors: AuditActor[];
    actions: string[];
  };
  summary: {
    success: number;
    failed: number;
  };
  scope: AuditScope;
  generatedAt: string;
};

export type AuditOverviewMetrics = {
  total: number;
  failed: number;
  dailyTrend: Array<{ date: string; total: number; failed: number }>;
  resourceDistribution: Array<{
    resourceType: AuditResourceType;
    total: number;
  }>;
  recentRiskEvents: AuditEventRecord[];
};

export const auditedActivityActions = [
  'auth.login',
  'auth.login_failed',
  'auth.registered',
  'auth.password_reset_completed',
  'auth.passkey_added',
  'auth.passkey_removed',
  'auth.passkey_renamed',
  'auth.reauthentication_succeeded',
  'auth.reauthentication_failed',
  'auth.recovery_codes_generated',
  'auth.recovery_code_used',
  'auth.method_policy_blocked',
  'file.upload_intent_created',
  'file.upload_completed',
  'file.upload_overwritten',
  'file.download_intent_created',
  'file.batch_download_intents_created',
  'file.download_started',
  'file.preview_requested',
  'file.folder_created',
  'file.renamed',
  'file.moved',
  'file.batch_moved',
  'file.copied',
  'file.content_updated',
  'file.version_created',
  'file.version_downloaded',
  'file.version_restored',
  'file.starred_updated',
  'file.archived',
  'file.batch_archived',
  'file.restored',
  'file.batch_restored',
  'file.permanently_deleted',
  'file.trash_cleaned',
  'file.quota_updated',
  'file.user_quota_updated',
  'file.quota_upload_rejected',
  'file.search_performed',
  'share.created',
  'share.viewed',
  'share.revoked',
  'share.access_code_sent',
  'share.access_code_failed',
  'share.access_code_locked',
  'share.access_denied',
  'share.access_session_created',
  'share.rate_limited',
  'share.preview_requested',
  'share.download_intent_created',
  'share.download_started',
  'transfer.created',
  'transfer.completed',
  'transfer.failed',
  'transfer.paused',
  'transfer.canceled',
  'transfer.expired',
  'transfer.deleted',
  'system.auth_policy_updated',
] as const;

export const auditedActivityActionSet = new Set<string>(auditedActivityActions);

export function isAuthAuditAction(action: string) {
  return action.startsWith('auth.');
}

export function createAuditEvent(input: AuditEventInput): AuditEventRecord {
  return {
    id: `audit_${randomBytes(12).toString('base64url')}`,
    action: input.action,
    actor: input.actor,
    target: input.target,
    workspaceId: input.workspaceId ?? null,
    shareToken: input.shareToken ?? null,
    nodeId: input.nodeId ?? null,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
    actorDisplayName: null,
    actorEmail: null,
    actorUserId: null,
    ipAddress: null,
    resourceType: resolveAuditResourceType(input.action),
    result: resolveAuditResult(input.action, input.metadata ?? {}),
  };
}

export function resolveAuditResourceType(action: string): AuditResourceType {
  if (action.startsWith('file.')) return 'file';
  if (action.startsWith('share.')) return 'share';
  if (action.startsWith('transfer.')) return 'transfer';
  return 'system';
}

export function resolveAuditResult(
  action: string,
  metadata: Record<string, unknown>,
): AuditResult {
  const metadataResult = [metadata.result, metadata.status].find(
    (value): value is string => typeof value === 'string',
  );
  if (
    metadataResult &&
    ['failed', 'failure', 'error', 'denied', 'rejected', 'locked'].includes(
      normalizeAuditResultValue(metadataResult),
    )
  ) {
    return 'failed';
  }
  if (metadata.success === false) return 'failed';
  return /(?:failed|failure|blocked|denied|rejected|locked|rate_limited)$/.test(
    action,
  )
    ? 'failed'
    : 'success';
}

export function normalizeAuditResultValue(value: string) {
  return value.trim().toLowerCase();
}

export function clampAuditLimit(limit = 100) {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function clampAuditOffset(offset = 0) {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}
