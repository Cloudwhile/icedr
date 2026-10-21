import { createElement } from "react";
import { BatchOperationFailureDescription } from "@/components/drive/batch-operation-feedback";
import { showWorkspaceNotification } from "@/components/ui/workspace-notification-store";
import type { useTranslations } from "@/i18n/react";
import type { UploadTaskMeta } from "./drive-transfer-helpers";

type UploadBatchMember = { id: string; name: string };
type UploadBatchOutcome = "completed" | "failed" | "canceled" | "skipped";

export function createUploadBatchFeedback({
  autoClearCompleted,
  batchId,
  getApiFeedback,
  members,
  retryMeta,
  t,
}: {
  autoClearCompleted: boolean;
  batchId: string;
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  members: UploadBatchMember[];
  retryMeta: UploadTaskMeta;
  t: ReturnType<typeof useTranslations>;
}) {
  const outcomes = new Map<string, UploadBatchOutcome>();
  const failures = new Map<string, string>();
  let notified = false;

  const settle = (id: string, outcome: UploadBatchOutcome, error?: unknown) => {
    if (notified || outcomes.has(id)) return;
    outcomes.set(id, outcome);
    if (outcome === "failed") failures.set(id, getApiFeedback(error, "app.uploadFailed", "form"));
    // A paused member remains unsettled until it resumes or is explicitly canceled.
    if (outcomes.size !== members.length) return;
    notified = true;
    const counts = { canceled: 0, failed: 0, requested: members.length, skipped: 0, succeeded: 0 };
    outcomes.forEach((value) => {
      if (value === "completed") counts.succeeded += 1;
      else counts[value] += 1;
    });
    showWorkspaceNotification({
      dedupeKey: `upload-batch:${batchId}`,
      description: failures.size > 0 ? createElement(BatchOperationFailureDescription, {
        failures: Array.from(failures, ([id, message]) => ({ id, message })),
        items: members,
      }) : undefined,
      title: t(counts.canceled || counts.skipped ? "upload.batchInterruptedResult" : "upload.batchResult", counts),
      tone: counts.failed > 0
        ? counts.succeeded > 0 ? "warning" : "error"
        : counts.canceled || counts.skipped ? "neutral" : "success",
    });
  };

  return (id: string): UploadTaskMeta => ({
    autoClearCompleted,
    onCompleted: () => settle(id, "completed"),
    onFailed: (error) => settle(id, "failed", error),
    onSettled: (outcome) => settle(id, outcome),
    retryMeta,
  });
}
