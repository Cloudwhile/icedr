import { randomBytes } from 'crypto';

export type AuditActor = 'workspace' | 'visitor' | 'system';

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
};

export const auditedActivityActions = [
  'auth.login',
  'auth.registered',
  'auth.password_reset_completed',
  'file.upload_completed',
  'file.download_started',
  'file.folder_created',
  'file.moved',
  'file.batch_moved',
  'file.copied',
  'file.archived',
  'file.batch_archived',
  'file.permanently_deleted',
  'share.created',
  'share.revoked',
  'share.download_started',
  'transfer.completed',
  'transfer.failed',
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
