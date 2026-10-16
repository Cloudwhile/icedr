import type { WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";

export type BatchOperationFailure = {
  id: string;
  message: string;
};

type BatchOperationSummary = {
  failed: number;
  requested: number;
  succeeded: number;
};

export function getBatchOperationTone(summary: BatchOperationSummary): WorkspaceNotificationTone {
  if (summary.failed === 0) return "success";
  if (summary.succeeded === 0 || summary.failed >= summary.requested) return "error";
  return "warning";
}
