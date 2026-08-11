import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  showWorkspaceNotification,
  type WorkspaceNotificationOptions,
  type WorkspaceNotificationTone,
} from "@/components/ui/workspace-notification-store";
import type { DriveItem } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  batchArchiveFileNodes,
  batchRestoreFileNodes,
  permanentlyDeleteFileNode,
  restoreFileNode,
  updateFileNodeState,
  type BatchFileNodeOperationResponse,
} from "@/lib/drive-api";

type UseDriveDestructiveActionsOptions = {
  activeItem?: DriveItem;
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  refreshDriveItems: () => Promise<unknown>;
  refreshStorageUsage: () => Promise<unknown>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  showFeedback: (message: string, tone?: WorkspaceNotificationTone) => void;
};

type FileOperationResult = BatchFileNodeOperationResponse;

export function useDriveDestructiveActions({
  activeItem,
  getApiFeedback,
  refreshDriveItems,
  refreshStorageUsage,
  setSelected,
  showFeedback,
}: UseDriveDestructiveActionsOptions) {
  const t = useTranslations();
  const archiveLockRef = useRef(false);
  const restoreLockRef = useRef(false);
  const permanentDeleteLockRef = useRef(false);
  const archiveNotificationSequenceRef = useRef(0);
  const permanentDeleteItemsRef = useRef<DriveItem[]>([]);
  const [archivePending, setArchivePending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [permanentDeletePending, setPermanentDeletePending] = useState(false);
  const [permanentDeleteItems, setPermanentDeleteItems] = useState<DriveItem[]>([]);

  const resolveActionItems = useCallback((items: DriveItem[]) => (
    items.length > 0 ? items : activeItem ? [activeItem] : []
  ), [activeItem]);

  const refreshAfterMutation = useCallback(async () => {
    await Promise.allSettled([refreshDriveItems(), refreshStorageUsage()]);
  }, [refreshDriveItems, refreshStorageUsage]);

  const showBatchResult = useCallback((
    result: FileOperationResult,
    notificationExtras: Pick<
      WorkspaceNotificationOptions,
      "actionIcon" | "actionLabel" | "dedupeKey" | "onAction"
    > = {},
  ) => {
    const notification = {
      description: result.failed.length > 0
        ? result.failed.slice(0, 6).map((item) => `${item.id}: ${item.message}`).join("\n")
        : undefined,
      title: t("files.batchResult", result.summary),
      tone: result.summary.failed > 0 ? "neutral" as const : "success" as const,
      ...notificationExtras,
    };
    showWorkspaceNotification(notification);
  }, [t]);

  const restoreIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return false;
    if (restoreLockRef.current) {
      showFeedback(t("app.actionInProgress"), "neutral");
      return false;
    }

    restoreLockRef.current = true;
    setRestorePending(true);
    try {
      const result = ids.length === 1
        ? await restoreFileNode(ids[0]).then((node) => createSuccessfulResult([node]))
        : await batchRestoreFileNodes(ids);
      await refreshAfterMutation();
      const succeededIds = result.succeeded.map((item) => item.id);
      setSelected((current) => current.filter((id) => !succeededIds.includes(id)));
      if (ids.length === 1 && result.summary.failed === 0) {
        showFeedback(t("app.restored", { count: result.summary.succeeded }));
      } else {
        showBatchResult(result);
      }
    } catch (error) {
      showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
    } finally {
      restoreLockRef.current = false;
      setRestorePending(false);
    }
    return true;
  }, [getApiFeedback, refreshAfterMutation, setSelected, showBatchResult, showFeedback, t]);

  const archiveItems = useCallback(async (items: DriveItem[]) => {
    const actionItems = resolveActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    if (archiveLockRef.current) return;

    archiveLockRef.current = true;
    setArchivePending(true);
    try {
      const result = actionItems.length === 1
        ? await updateFileNodeState(actionItems[0].id, { archived: true })
          .then((node) => createSuccessfulResult([node]))
        : await batchArchiveFileNodes(actionItems.map((item) => item.id));
      await refreshAfterMutation();
      const succeededIds = result.succeeded.map((item) => item.id);
      setSelected((current) => current.filter((id) => !succeededIds.includes(id)));

      const undoNotification = succeededIds.length > 0
        ? {
          actionIcon: "refresh" as const,
          actionLabel: t("actions.undo"),
          dedupeKey: `drive-archive-${++archiveNotificationSequenceRef.current}-${[...succeededIds].sort().join("|")}`,
          onAction: () => restoreIds(succeededIds),
        }
        : {};

      if (actionItems.length === 1 && result.summary.failed === 0) {
        const notification = {
          title: t("app.archived", { count: result.summary.succeeded }),
          tone: "success" as const,
          ...undoNotification,
        };
        showWorkspaceNotification(notification);
      } else {
        showBatchResult(result, undoNotification);
      }
    } catch (error) {
      showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
    } finally {
      archiveLockRef.current = false;
      setArchivePending(false);
    }
  }, [getApiFeedback, refreshAfterMutation, resolveActionItems, restoreIds, setSelected, showBatchResult, showFeedback, t]);

  const restoreItems = useCallback(async (items: DriveItem[]) => {
    const actionItems = resolveActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    await restoreIds(actionItems.map((item) => item.id));
  }, [resolveActionItems, restoreIds, showFeedback, t]);

  const deletePermanentlyItems = useCallback((items: DriveItem[]) => {
    const actionItems = resolveActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    if (permanentDeleteLockRef.current || permanentDeleteItemsRef.current.length > 0) return;

    permanentDeleteItemsRef.current = [...actionItems];
    setPermanentDeleteItems([...actionItems]);
  }, [resolveActionItems, showFeedback, t]);

  const cancelPermanentDelete = useCallback(() => {
    if (permanentDeleteLockRef.current) return;
    permanentDeleteItemsRef.current = [];
    setPermanentDeleteItems([]);
  }, []);

  const confirmPermanentDelete = useCallback(async () => {
    const actionItems = permanentDeleteItemsRef.current;
    if (actionItems.length === 0 || permanentDeleteLockRef.current) return;

    permanentDeleteLockRef.current = true;
    setPermanentDeletePending(true);
    try {
      const settled = await Promise.allSettled(
        actionItems.map((item) => permanentlyDeleteFileNode(item.id)),
      );
      const succeededIds = actionItems
        .filter((_, index) => settled[index].status === "fulfilled")
        .map((item) => item.id);
      const failed = actionItems
        .map((item, index) => ({ item, result: settled[index] }))
        .filter((entry): entry is { item: DriveItem; result: PromiseRejectedResult } => (
          entry.result.status === "rejected"
        ))
        .map(({ item, result }) => ({
          id: item.id,
          message: result.reason instanceof Error ? result.reason.message : t("app.uploadFailed"),
        }));
      await refreshAfterMutation();
      setSelected((current) => current.filter((id) => !succeededIds.includes(id)));
      showBatchResult({
        failed,
        succeeded: [],
        summary: {
          failed: failed.length,
          requested: actionItems.length,
          succeeded: succeededIds.length,
        },
      });
    } catch (error) {
      showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
    } finally {
      permanentDeleteLockRef.current = false;
      permanentDeleteItemsRef.current = [];
      setPermanentDeleteItems([]);
      setPermanentDeletePending(false);
    }
  }, [getApiFeedback, refreshAfterMutation, setSelected, showBatchResult, showFeedback, t]);

  return {
    archiveItems,
    archivePending,
    cancelPermanentDelete,
    confirmPermanentDelete,
    deletePermanentlyItems,
    permanentDeleteItems,
    permanentDeleteOpen: permanentDeleteItems.length > 0,
    permanentDeletePending,
    restoreItems,
    restorePending,
  };
}

function createSuccessfulResult(succeeded: BatchFileNodeOperationResponse["succeeded"]): FileOperationResult {
  return {
    failed: [],
    succeeded,
    summary: {
      failed: 0,
      requested: succeeded.length,
      succeeded: succeeded.length,
    },
  };
}
