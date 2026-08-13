"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  registerNavigationBlocker,
  type BlockedNavigation,
} from "@/compat/navigation";
import type { Palette } from "@/features/file/model";
import {
  UnsavedChangesDialog,
  type UnsavedChangesDialogAction,
  type UnsavedChangesDialogLabels,
} from "./unsaved-changes-dialog";
import {
  createUnsavedChangesStore,
  UnsavedChangesContext,
} from "./unsaved-changes-context";

export type { UnsavedChangesDialogLabels } from "./unsaved-changes-dialog";

export function AdminUnsavedChangesProvider({
  children,
  labels,
  onActionError,
  palette,
}: {
  children: ReactNode;
  labels: UnsavedChangesDialogLabels;
  onActionError?: (
    error: unknown,
    action: UnsavedChangesDialogAction,
  ) => void;
  palette: Palette;
}) {
  const [store] = useState(createUnsavedChangesStore);
  const pendingNavigationRef = useRef<BlockedNavigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<UnsavedChangesDialogAction | null>(null);
  const [pendingNavigation, setPendingNavigation] =
    useState<BlockedNavigation | null>(null);
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const hasDirtySections = store.hasDirtySections();

  useEffect(() => {
    return registerNavigationBlocker((navigation) => {
      if (!store.hasDirtySections()) return false;
      if (pendingNavigationRef.current) return true;
      pendingNavigationRef.current = navigation;
      setPendingNavigation(navigation);
      setError(null);
      return true;
    });
  }, [store]);

  useEffect(() => {
    if (!hasDirtySections) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasDirtySections]);

  const closeDialog = useCallback(() => {
    if (pendingAction) return;
    pendingNavigationRef.current = null;
    setPendingNavigation(null);
    setError(null);
  }, [pendingAction]);

  const continueNavigation = useCallback((navigation: BlockedNavigation) => {
    pendingNavigationRef.current = null;
    setPendingNavigation(null);
    setError(null);
    navigation.retry();
  }, []);

  const performAction = useCallback(
    async (action: UnsavedChangesDialogAction) => {
      const navigation = pendingNavigationRef.current;
      if (!navigation || pendingAction) return;

      setPendingAction(action);
      setError(null);
      const callbacks = store.readDirtySections().map((section) =>
        action === "save" ? section.onSave : section.onDiscard,
      );

      try {
        const results = await Promise.allSettled(
          callbacks.map((callback) => Promise.resolve().then(callback)),
        );
        const failedResult = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failedResult) throw failedResult.reason;
        setPendingAction(null);
        continueNavigation(navigation);
      } catch (actionError) {
        setError(
          action === "save"
            ? labels.saveFailed
            : (labels.discardFailed ?? labels.saveFailed),
        );
        onActionError?.(actionError, action);
        setPendingAction(null);
      }
    },
    [
      continueNavigation,
      labels.discardFailed,
      labels.saveFailed,
      onActionError,
      pendingAction,
      store,
    ],
  );

  return (
    <UnsavedChangesContext.Provider value={store}>
      {children}
      <UnsavedChangesDialog
        error={error}
        labels={labels}
        onCancel={closeDialog}
        onDiscard={() => void performAction("discard")}
        onSave={() => void performAction("save")}
        open={pendingNavigation !== null}
        palette={palette}
        pendingAction={pendingAction}
      />
    </UnsavedChangesContext.Provider>
  );
}
