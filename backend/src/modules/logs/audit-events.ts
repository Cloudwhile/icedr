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
