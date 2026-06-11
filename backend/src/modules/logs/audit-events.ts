import { randomBytes } from 'crypto';

export type AuditActor = 'workspace' | 'account' | 'visitor' | 'system';

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
  workspaceId?: string;
  shareToken?: string;
  nodeId?: string;
  action?: string;
  limit?: number;
  offset?: number;
};

export type AuditEventPage = {
  items: AuditEventRecord[];
  total: number;
  limit: number;
  offset: number;
};

export const auditedActivityActions = [
  'auth.login',
  'auth.registered',
  'auth.password_reset_completed',
  'file.upload_intent_created',
  'file.upload_completed',
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
  'share.access_session_created',
  'share.preview_requested',
  'share.download_started',
  'transfer.created',
  'transfer.completed',
  'transfer.failed',
  'transfer.paused',
  'transfer.canceled',
  'transfer.deleted',
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
  };
}

export function clampAuditLimit(limit = 100) {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}

export function clampAuditOffset(offset = 0) {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}
