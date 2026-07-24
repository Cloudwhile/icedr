import type { Prisma, TransferTask } from '../../generated/prisma/client';
import { createAuditEvent } from '../logs/audit-events';

export type UploadTransferAuditAction =
  | 'transfer.completed'
  | 'transfer.failed'
  | 'transfer.expired'
  | 'transfer.canceled';

export async function recordUploadTransferAudit(
  client: Pick<Prisma.TransactionClient, 'auditEvent'>,
  action: UploadTransferAuditAction,
  transfer: TransferTask,
  metadata: Record<string, unknown> = {},
) {
  const event = createAuditEvent({
    action,
    actor: 'workspace',
    target: transfer.id,
    workspaceId: transfer.workspaceId,
    nodeId: transfer.nodeId,
    metadata: {
      source: 'transfers-service',
      transferType: transfer.transferType,
      hasContent: Boolean(transfer.objectKey),
      status: transfer.status,
      failureCode: transfer.failureCode,
      result: action === 'transfer.failed' ? 'failed' : 'success',
      ...metadata,
    },
  });
  await client.auditEvent.create({
    data: {
      id: event.id,
      action: event.action,
      actor: event.actor,
      target: event.target,
      workspaceId: event.workspaceId,
      shareToken: event.shareToken,
      nodeId: event.nodeId,
      metadata: event.metadata as Prisma.InputJsonValue,
      createdAt: new Date(event.createdAt),
    },
  });
}
