import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import { getDriveFileNameErrorMessageKey, validateDriveFileName } from "@/features/file/file-name-policy";
import type { DriveItem } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { renameFileNode } from "@/lib/drive-api";
import { formatExtensionLabel, getNameExtension } from "./drive-workbench-helpers";

export type ExtensionRenamePrompt = {
  from: string;
  item: DriveItem;
  name: string;
  requestId: number;
  to: string;
};

type PendingExtensionRename = {
  requestId: number;
  resolve: (renamed: boolean) => void;
};

type UseDriveItemRenameOptions = {
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  refreshDriveItems: () => Promise<unknown>;
  setSelected: Dispatch<SetStateAction<string[]>>;
  showFeedback: (message: string, tone?: WorkspaceNotificationTone) => void;
};

export function useDriveItemRename({
  getApiFeedback,
  refreshDriveItems,
  setSelected,
  showFeedback,
}: UseDriveItemRenameOptions) {
  const t = useTranslations();
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [extensionRenamePrompt, setExtensionRenamePrompt] = useState<ExtensionRenamePrompt | null>(null);
  const [extensionRenamePending, setExtensionRenamePending] = useState(false);
  const extensionRenamePendingRef = useRef(false);
  const requestCounterRef = useRef(0);
  const pendingExtensionRenameRef = useRef<PendingExtensionRename | null>(null);

  const performRename = useCallback(async (item: DriveItem, name: string) => {
    try {
      await renameFileNode(item.id, name);
      await refreshDriveItems();
      setSelected([item.id]);
      setRenamingItemId(null);
      showFeedback(t("app.renamed"));
      return true;
    } catch (error) {
      showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
      return false;
    }
  }, [getApiFeedback, refreshDriveItems, setSelected, showFeedback, t]);

  const settleExtensionRename = useCallback((requestId: number, renamed: boolean) => {
    const pending = pendingExtensionRenameRef.current;
    if (!pending || pending.requestId !== requestId) return;
    pendingExtensionRenameRef.current = null;
    setExtensionRenamePrompt(null);
    pending.resolve(renamed);
  }, []);

  const cancelExtensionRename = useCallback(() => {
    if (extensionRenamePendingRef.current || !extensionRenamePrompt) return;
    settleExtensionRename(extensionRenamePrompt.requestId, false);
  }, [extensionRenamePrompt, settleExtensionRename]);

  const confirmExtensionRename = useCallback(() => {
    const prompt = extensionRenamePrompt;
    if (!prompt || extensionRenamePendingRef.current) return;
    extensionRenamePendingRef.current = true;
    setExtensionRenamePending(true);
    void performRename(prompt.item, prompt.name)
      .then((renamed) => settleExtensionRename(prompt.requestId, renamed))
      .finally(() => {
        extensionRenamePendingRef.current = false;
        setExtensionRenamePending(false);
      });
  }, [extensionRenamePrompt, performRename, settleExtensionRename]);

  const commitRenameItem = useCallback(async (item: DriveItem, rawName: string) => {
    const name = rawName.trim();
    if (!name || name === item.name) {
      setRenamingItemId(null);
      return true;
    }

    const nameValidation = validateDriveFileName(name);
    if (!nameValidation.ok) {
      showFeedback(t(getDriveFileNameErrorMessageKey(nameValidation.code), nameValidation.values), "error");
      return false;
    }

    if (item.hasContent) {
      const previousExtension = getNameExtension(item.name);
      const nextExtension = getNameExtension(name);
      if (previousExtension !== nextExtension) {
        if (extensionRenamePendingRef.current) return false;
        pendingExtensionRenameRef.current?.resolve(false);
        const requestId = ++requestCounterRef.current;
        const result = new Promise<boolean>((resolve) => {
          pendingExtensionRenameRef.current = { requestId, resolve };
        });
        setExtensionRenamePrompt({
          from: formatExtensionLabel(previousExtension, t("files.noExtension")),
          item,
          name,
          requestId,
          to: formatExtensionLabel(nextExtension, t("files.noExtension")),
        });
        return result;
      }
    }

    return performRename(item, name);
  }, [performRename, showFeedback, t]);

  useEffect(() => () => {
    pendingExtensionRenameRef.current?.resolve(false);
    pendingExtensionRenameRef.current = null;
  }, []);

  return {
    cancelExtensionRename,
    commitRenameItem,
    confirmExtensionRename,
    extensionRenamePending,
    extensionRenamePrompt,
    renamingItemId,
    requestRenameItem: (item: DriveItem) => {
      setSelected([item.id]);
      setRenamingItemId(item.id);
    },
    setRenamingItemId,
  };
}
