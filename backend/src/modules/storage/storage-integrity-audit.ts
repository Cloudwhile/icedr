import type { Prisma } from '../../generated/prisma/client';
import { createAuditEvent } from '../logs/audit-events';

export type StorageIntegrityAuditAction =
  | 'system.storage_integrity_task_started'
  | 'system.storage_integrity_task_completed'
  | 'system.storage_integrity_task_failed'
  | 'system.storage_integrity_mismatch_detected'
  | 'system.storage_integrity_failure_detected'
  | 'system.storage_integrity_result_acknowledged'
  | 'system.storage_integrity_retry_started';

export async function recordStorageIntegrityAudit(
  client: Pick<Prisma.TransactionClient, 'auditEvent'>,
  input: {
    action: StorageIntegrityAuditAction;
    actorUserId?: string | null;
    errorCode?: string | null;
    status?: 'mismatch' | 'failed';
    mode?: 'backfill' | 'verify';
    nodeId?: string | null;
    progress?: {
      bytesRead: number;
      failed: number;
      matched: number;
      mismatches: number;
      processed: number;
      total: number;
    };
    result?: 'failed' | 'success';
    resultId?: string | null;
    scope?: 'all' | 'workspace';
    taskId: string;
    versionId?: string | null;
    workspaceId?: string | null;
  },
) {
  const event = createAuditEvent({
    action: input.action,
    actor: input.actorUserId ? 'account' : 'system',
    metadata: {
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.progress ? input.progress : {}),
      ...(input.result ? { result: input.result } : {}),
      ...(input.resultId ? { resultId: input.resultId } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      source: 'storage-integrity-task',
      taskId: input.taskId,
      ...(input.versionId ? { versionId: input.versionId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    },
    nodeId: input.nodeId ?? null,
    target: input.taskId,
    workspaceId: input.workspaceId ?? null,
  });
  await client.auditEvent.create({
    data: {
      action: event.action,
      actor: event.actor,
      createdAt: new Date(event.createdAt),
      id: event.id,
      metadata: event.metadata as Prisma.InputJsonValue,
      nodeId: event.nodeId,
      shareToken: null,
      target: event.target,
      workspaceId: event.workspaceId,
    },
  });
}
