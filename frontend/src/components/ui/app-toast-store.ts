import { isValidElement, type ReactNode } from "react";

export type AppToastTone = "success" | "error" | "info" | "warning" | "neutral";

export type AppToastOptions = {
  debounceMs?: number;
  dedupeKey?: string;
  description?: ReactNode;
  duration?: number;
  title: ReactNode;
  tone?: AppToastTone;
};

export type AppToastSnapshot = Required<Pick<AppToastOptions, "duration" | "tone">> & {
  createdAt: number;
  description?: ReactNode;
  id: string;
  title: ReactNode;
};

const defaultToastDebounceMs = 1100;
const defaultToastDurationMs = 1500;
const listeners = new Set<() => void>();
const recentToastTimestamps = new Map<string, number>();
let activeToast: AppToastSnapshot | null = null;
let toastCounter = 0;

export function showAppToast({
  debounceMs = defaultToastDebounceMs,
  dedupeKey,
  description,
  duration = defaultToastDurationMs,
  title,
  tone = "success",
}: AppToastOptions) {
  const toastKey = dedupeKey ?? createToastDedupeKey({ description, title, tone });
  const now = Date.now();
  const recentTimestamp = recentToastTimestamps.get(toastKey);

  if (recentTimestamp && now - recentTimestamp < debounceMs) return null;

  recentToastTimestamps.set(toastKey, now);
  pruneRecentToastTimestamps(now);

  const id = `app-toast-${now}-${toastCounter++}`;
  activeToast = {
    createdAt: now,
    description,
    duration: Math.max(600, duration),
    id,
    title,
    tone,
  };
  emitAppToast();
  return id;
}

export function closeAppToast(id?: string | null) {
  if (!activeToast || (id && activeToast.id !== id)) return;
  activeToast = null;
  emitAppToast();
}

export function subscribeAppToast(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppToastSnapshot() {
  return activeToast;
}

function emitAppToast() {
  listeners.forEach((listener) => listener());
}

function createToastDedupeKey({
  description,
  title,
  tone,
}: {
  description?: ReactNode;
  title: ReactNode;
  tone: AppToastTone;
}) {
  return [tone, normalizeToastNode(title), normalizeToastNode(description)].join(":");
}

function normalizeToastNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(normalizeToastNode).join("|");
  if (isValidElement(node)) return "react-element";
  return "toast-node";
}

function pruneRecentToastTimestamps(now: number) {
  if (recentToastTimestamps.size < 48) return;
  recentToastTimestamps.forEach((timestamp, key) => {
    if (now - timestamp > 10_000) recentToastTimestamps.delete(key);
  });
}
