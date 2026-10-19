import { useEffect, useRef, useState } from "react";
import { fetchFileNodeContent, updateFileNodeContent } from "@/lib/drive-api";
import { useTranslations } from "@/i18n/react";
import { showAppToast } from "./app-toast-store";

export type PreviewEditStatus = { dirty: boolean; pending: boolean };

export function usePreviewTextEditor(itemId: string, enabled: boolean, onStatusChange: (status: PreviewEditStatus) => void, onSaved?: () => void) {
  const t = useTranslations();
  const [state, setState] = useState({ itemId: "", content: "", saved: "", failed: false });
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const loaded = state.itemId === itemId;
  const dirty = enabled && loaded && state.content !== state.saved;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetchFileNodeContent(itemId).then(({ content }) => {
      if (active) setState({ itemId, content, saved: content, failed: false });
    }).catch(() => {
      if (active) setState({ itemId, content: "", saved: "", failed: true });
    });
    return () => { active = false; };
  }, [enabled, itemId]);

  useEffect(() => {
    onStatusChange({ dirty, pending });
    return () => onStatusChange({ dirty: false, pending: false });
  }, [dirty, onStatusChange, pending]);

  useEffect(() => {
    if (!dirty && !pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, pending]);

  const save = async () => {
    if (!enabled || !loaded || state.failed || !dirty || saving.current) return;
    saving.current = true;
    setPending(true);
    const submitted = state.content;
    try {
      const result = await updateFileNodeContent(itemId, submitted);
      setState((current) => current.itemId === itemId ? {
        ...current,
        content: current.content === submitted ? result.content : current.content,
        saved: result.content,
      } : current);
      showAppToast({ title: t("preview.saved"), tone: "success" });
      onSaved?.();
    } catch {
      showAppToast({ title: t("preview.saveFailed"), tone: "error" });
    } finally {
      saving.current = false;
      setPending(false);
    }
  };

  return {
    content: loaded ? state.content : "",
    dirty,
    failed: loaded && state.failed,
    loading: enabled && !loaded,
    pending,
    save,
    change: (content: string) => setState((current) => ({ ...current, content })),
  };
}
