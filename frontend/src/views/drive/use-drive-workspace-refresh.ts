import { useCallback, useMemo, useRef, useState } from "react";
import { useOperationContext } from "@/components/drive/use-operation-context";
import {
  driveRefreshFailed,
  driveRefreshTargets,
  summarizeDriveRefresh,
  type DriveRefreshOutcome,
  type DriveRefreshSummary,
  type DriveRefreshTarget,
} from "./drive-refresh-result";

export type DriveRefreshTasks = Record<
  DriveRefreshTarget,
  () => Promise<DriveRefreshOutcome>
>;

type UseDriveWorkspaceRefreshOptions = {
  contextKey?: string;
  disabled: boolean;
  onComplete: (summary: DriveRefreshSummary) => void;
  tasks: DriveRefreshTasks;
};

export function useDriveWorkspaceRefresh({
  contextKey = "",
  disabled,
  onComplete,
  tasks,
}: UseDriveWorkspaceRefreshOptions) {
  const context = useMemo(() => ({ key: contextKey }), [contextKey]);
  const isCurrentContext = useOperationContext(contextKey);
  const [lastResult, setLastResult] = useState<{ context: object; summary: DriveRefreshSummary } | null>(null);
  const [refreshingContext, setRefreshingContext] = useState<object | null>(null);
  const pendingPromiseRef = useRef<{ context: object; promise: Promise<DriveRefreshSummary> } | null>(null);

  const refreshWorkspace = useCallback(() => {
    if (disabled) return Promise.resolve(null);
    if (pendingPromiseRef.current?.context === context) return pendingPromiseRef.current.promise;

    setRefreshingContext(context);
    const promise = runDriveRefreshTasks(tasks)
      .then((summary) => {
        if (isCurrentContext()) {
          setLastResult({ context, summary });
          onComplete(summary);
        }
        return summary;
      })
      .finally(() => {
        if (pendingPromiseRef.current?.promise !== promise) return;
        pendingPromiseRef.current = null;
        if (isCurrentContext()) setRefreshingContext(null);
      });
    pendingPromiseRef.current = { context, promise };
    return promise;
  }, [context, disabled, isCurrentContext, onComplete, tasks]);

  return {
    lastSummary: lastResult?.context === context ? lastResult.summary : null,
    refreshing: refreshingContext === context,
    refreshWorkspace,
  };
}

export async function runDriveRefreshTasks(tasks: DriveRefreshTasks) {
  const outcomes = await Promise.all(driveRefreshTargets.map(async (target) => {
    try {
      return await tasks[target]();
    } catch (error) {
      return driveRefreshFailed(target, getUnexpectedRefreshMessage(error), false);
    }
  }));
  return summarizeDriveRefresh(outcomes);
}

function getUnexpectedRefreshMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unexpected refresh failure";
}
