"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

export function useDriveDetailsPanel({
  loading,
  open,
  setOpen,
}: {
  loading: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const returnItemIdRef = useRef<string | null>(null);
  const focusPendingRef = useRef(false);

  const openDetailsPanel = useCallback((returnItemId?: string | null) => {
    returnItemIdRef.current = returnItemId ?? null;
    focusPendingRef.current = true;
    setOpen(true);
  }, [setOpen]);

  const closeDetailsPanel = useCallback(() => {
    const returnItemId = returnItemIdRef.current;
    focusPendingRef.current = false;
    setOpen(false);
    window.requestAnimationFrame(() => {
      const returnTarget = returnItemId
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-drive-item-id]")).find(
            (candidate) => candidate.dataset.driveItemId === returnItemId,
          )
        : null;
      (returnTarget ?? document.querySelector<HTMLElement>(".drive-workspace-body [tabindex='0']"))?.focus();
    });
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[role="menu"], [role="dialog"][aria-modal="true"]')
      ) return;
      event.preventDefault();
      closeDetailsPanel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeDetailsPanel, open]);

  useEffect(() => {
    if (!open || loading || !focusPendingRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const focusTarget = document.querySelector<HTMLElement>(
        ".drive-details-panel [data-drive-details-focus], .drive-details-panel[tabindex]",
      );
      focusTarget?.focus();
      focusPendingRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, open]);

  return { closeDetailsPanel, openDetailsPanel };
}
