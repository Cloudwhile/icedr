import { useCallback, useRef, useState } from "react";
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
  disabled: boolean;
  onComplete: (summary: DriveRefreshSummary) => void;
  tasks: DriveRefreshTasks;
};

export function useDriveWorkspaceRefresh({
  disabled,
  onComplete,
  tasks,
}: UseDriveWorkspaceRefreshOptions) {
  const [lastSummary, setLastSummary] = useState<DriveRefreshSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pendingPromiseRef = useRef<Promise<DriveRefreshSummary> | null>(null);

  const refreshWorkspace = useCallback(() => {
    if (disabled) return Promise.resolve(null);
    if (pendingPromiseRef.current) return pendingPromiseRef.current;

    setRefreshing(true);
    const promise = runDriveRefreshTasks(tasks)
      .then((summary) => {
        setLastSummary(summary);
        onComplete(summary);
        return summary;
      })
      .finally(() => {
        if (pendingPromiseRef.current !== promise) return;
        pendingPromiseRef.current = null;
        setRefreshing(false);
      });
    pendingPromiseRef.current = promise;
    return promise;
  }, [disabled, onComplete, tasks]);

  return { lastSummary, refreshing, refreshWorkspace };
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
