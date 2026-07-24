import { useCallback, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { showWorkspaceNotification, type WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import {
  copyTextToClipboard,
  createPreviewUrl,
  downloadWorkspaceDriveItem,
  downloadWorkspaceDriveItems,
} from "@/features/file/actions";
import type { DriveItem, DriveUserNav } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  batchArchiveFileNodes,
  batchMoveFileNodes,
  batchRestoreFileNodes,
  copyFileNode,
  moveFileNode,
  permanentlyDeleteFileNode,
  restoreFileNode,
  updateFileNodeState,
  type DriveSpaceScope,
  type FileNodeResponse,
} from "@/lib/drive-api";
import { isFolderWithinItems, type DriveClipboardState } from "./drive-workbench-helpers";

type UseDriveFileActionsOptions = {
  activeItem?: DriveItem;
  activeNav: DriveUserNav;
  currentFolderId: string | null;
  driveItems: DriveItem[];
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  queueWorkspaceLoading: () => void;
  refreshDriveItems: () => Promise<void>;
  refreshStorageUsage: () => Promise<void>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  setWorkspaceLoading: Dispatch<SetStateAction<boolean>>;
  showFeedback: (message: string, tone?: WorkspaceNotificationTone) => void;
  spaceScope: DriveSpaceScope;
  workspaceId: string | null;
  workspaceTimerRef: MutableRefObject<number | null>;
};

export function useDriveFileActions({
  activeItem,
  activeNav,
  currentFolderId,
  driveItems,
  getApiFeedback,
  queueWorkspaceLoading,
  refreshDriveItems,
  refreshStorageUsage,
  setSelected,
  setWorkspaceLoading,
  showFeedback,
  spaceScope,
  workspaceId,
  workspaceTimerRef,
}: UseDriveFileActionsOptions) {
  const t = useTranslations();
  const [driveClipboard, setDriveClipboard] = useState<DriveClipboardState | null>(null);
  const canPasteClipboard = useMemo(() => {
    if (!driveClipboard || activeNav !== "drive") return false;
    if (driveClipboard.workspaceId !== workspaceId || driveClipboard.spaceScope !== spaceScope) return false;
    if (currentFolderId && isFolderWithinItems(currentFolderId, driveClipboard.items, driveItems)) return false;
    if (driveClipboard.mode === "move" && driveClipboard.items.every((item) => item.parentId === currentFolderId)) return false;
    return driveClipboard.items.length > 0;
  }, [activeNav, currentFolderId, driveClipboard, driveItems, spaceScope, workspaceId]);

  const showBatchResult = useCallback((
    summary: { failed: number; requested: number; succeeded: number },
    failed: Array<{ id: string; message: string }> = [],
  ) => {
    showWorkspaceNotification({
      description: failed.length > 0
        ? failed.slice(0, 6).map((item) => `${item.id}: ${item.message}`).join("\n")
        : undefined,
      title: t("files.batchResult", summary),
      tone: summary.failed > 0 ? "neutral" : "success",
    });
  }, [t]);
  const getActionItems = (items: DriveItem[]) => items.length > 0 ? items : activeItem ? [activeItem] : [];
  const copyItemsLink = async (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    await copyTextToClipboard(actionItems.map((item) => createPreviewUrl(item.id)).join("\n"));
    showFeedback(t("app.copied"));
  };
  const downloadItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    if (actionItems.length > 1) {
      void downloadWorkspaceDriveItems(actionItems)
        .then((result) => showBatchResult(result.summary, result.failed))
        .catch((error) => showFeedback(getApiFeedback(error, "share.downloadFailed"), "error"));
      return;
    }
    void downloadWorkspaceDriveItem(actionItems[0], workspaceId ?? undefined)
      .then(() => showFeedback(t("app.downloaded")))
      .catch((error) => showFeedback(getApiFeedback(error, "share.downloadFailed"), "error"));
  };
  const archiveItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    const archiveAction = actionItems.length === 1
      ? updateFileNodeState(actionItems[0].id, { archived: true }).then((node) => ({
        failed: [],
        succeeded: [node],
        summary: { failed: 0, requested: 1, succeeded: 1 },
      }))
      : batchArchiveFileNodes(actionItems.map((item) => item.id));
    void archiveAction
      .then((result) => Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => result))
      .then((result) => {
        setSelected((current) => current.filter((id) => !result.succeeded.some((item) => item.id === id)));
        if (actionItems.length === 1) showFeedback(t("app.archived", { count: 1 }));
        else showBatchResult(result.summary, result.failed);
      })
      .catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const restoreItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    const restoreAction = actionItems.length === 1
      ? restoreFileNode(actionItems[0].id).then((node) => ({
        failed: [],
        succeeded: [node],
        summary: { failed: 0, requested: 1, succeeded: 1 },
      }))
      : batchRestoreFileNodes(actionItems.map((item) => item.id));
    void restoreAction
      .then((result) => Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => result))
      .then((result) => {
        setSelected((current) => current.filter((id) => !result.succeeded.some((item) => item.id === id)));
        if (actionItems.length === 1) showFeedback(t("app.refreshed"));
        else showBatchResult(result.summary, result.failed);
      })
      .catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const deletePermanentlyItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    void Promise.allSettled(actionItems.map((item) => permanentlyDeleteFileNode(item.id)))
      .then((results) => {
        const succeededIds = actionItems
          .filter((_, index) => results[index].status === "fulfilled")
          .map((item) => item.id);
        const failed = actionItems
          .map((item, index) => ({ item, result: results[index] }))
          .filter((entry): entry is { item: DriveItem; result: PromiseRejectedResult } => entry.result.status === "rejected")
          .map(({ item, result }) => ({
            id: item.id,
            message: result.reason instanceof Error ? result.reason.message : t("app.uploadFailed"),
          }));
        return Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => ({
          failed: actionItems.length - succeededIds.length,
          failedItems: failed,
          requested: actionItems.length,
          succeeded: succeededIds.length,
          succeededIds,
        }));
      })
      .then((result) => {
        setSelected((current) => current.filter((id) => !result.succeededIds.includes(id)));
        showBatchResult(result, result.failedItems);
      })
      .catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const setClipboardItems = (items: DriveItem[], mode: DriveClipboardState["mode"]) => {
    const actionItems = getActionItems(items).filter((item) => !item.archivedAt);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    setDriveClipboard({ items: actionItems, mode, spaceScope, workspaceId });
    showFeedback(mode === "copy" ? t("app.copied") : t("app.cut"));
  };
  const pasteClipboard = () => {
    if (!driveClipboard || !canPasteClipboard) {
      showFeedback(t("app.pasteUnavailable"), "neutral");
      return;
    }
    const targetFolderId = currentFolderId;
    const { items, mode } = driveClipboard;
    queueWorkspaceLoading();
    const action = mode === "copy"
      ? Promise.allSettled(items.map((item) => copyFileNode(item.id, { parentNodeId: targetFolderId }))).then((results) => {
        const succeeded = results
          .filter((result): result is PromiseFulfilledResult<FileNodeResponse> => result.status === "fulfilled")
          .map((result) => result.value);
        const failed = results
          .map((result, index) => ({ item: items[index], result }))
          .filter((entry): entry is { item: DriveItem; result: PromiseRejectedResult } => entry.result.status === "rejected")
          .map(({ item, result }) => ({
            id: item.id,
            message: result.reason instanceof Error ? result.reason.message : t("app.uploadFailed"),
          }));
        return Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => {
          if (succeeded.length > 0) setSelected(succeeded.map((node) => node.id));
          return {
            failed,
            succeeded,
            summary: { failed: failed.length, requested: items.length, succeeded: succeeded.length },
          };
        });
      })
      : items.length === 1
        ? moveFileNode(items[0].id, targetFolderId).then((node) => refreshDriveItems().then(() => {
          setSelected((current) => current.filter((id) => id !== items[0].id));
          setDriveClipboard(null);
          return {
            failed: [],
            succeeded: [node],
            summary: { failed: 0, requested: 1, succeeded: 1 },
          };
        }))
        : batchMoveFileNodes(items.map((item) => item.id), targetFolderId).then((result) => refreshDriveItems().then(() => {
          const movedIds = new Set(result.succeeded.map((item) => item.id));
          setSelected((current) => current.filter((id) => !movedIds.has(id)));
          if (result.summary.failed === 0) setDriveClipboard(null);
          else {
            const failedIds = new Set(result.failed.map((item) => item.id));
            setDriveClipboard((current) => current?.mode === "move"
              ? { ...current, items: current.items.filter((item) => failedIds.has(item.id)) }
              : current);
          }
          return result;
        }));

    void action
      .then((result) => {
        if (result.summary.requested === 1 && result.summary.failed === 0) {
          showFeedback(mode === "copy" ? t("app.duplicated") : t("app.moved"));
          return;
        }
        showBatchResult(result.summary, result.failed);
      })
      .catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"))
      .finally(() => {
        if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
        workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
      });
  };

  return {
    archiveItems,
    canPasteClipboard,
    copyItem: (item: DriveItem) => setClipboardItems([item], "copy"),
    copyItems: (items: DriveItem[]) => setClipboardItems(items, "copy"),
    copyItemsLink,
    cutItems: (items: DriveItem[]) => setClipboardItems(items, "move"),
    deletePermanentlyItems,
    downloadItems,
    getActionItems,
    moveItem: (item: DriveItem) => setClipboardItems([item], "move"),
    pasteClipboard,
    restoreItems,
  };
}
