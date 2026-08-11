import type { ReactNode } from "react";
import type { LocalIconName } from "@/features/file/model";

export type WorkspaceNotificationTone = "success" | "error" | "info" | "warning" | "neutral";

export type WorkspaceNotificationOptions = {
  actionIcon?: LocalIconName;
  actionLabel?: string;
  debounceMs?: number;
  dedupeKey?: string;
  description?: ReactNode;
  onAction?: () => boolean | void | Promise<boolean | void>;
  title: ReactNode;
  tone?: WorkspaceNotificationTone;
};

export type WorkspaceNotification = Required<Pick<WorkspaceNotificationOptions, "tone">> & {
  actionIcon?: LocalIconName;
  actionLabel?: string;
  createdAt: number;
  dedupeKey?: string;
  description?: ReactNode;
  id: string;
  onAction?: () => boolean | void | Promise<boolean | void>;
  title: ReactNode;
};

const defaultNotificationDebounceMs = 900;
const maxWorkspaceNotifications = 5;
const listeners = new Set<() => void>();
const recentNotificationTimestamps = new Map<string, number>();
const pendingNotificationActions = new Set<string>();
let notificationCounter = 0;
let notifications: WorkspaceNotification[] = [];

export function showWorkspaceNotification({
  actionIcon,
  actionLabel,
  debounceMs = defaultNotificationDebounceMs,
  dedupeKey,
  description,
  onAction,
  title,
  tone = "success",
}: WorkspaceNotificationOptions) {
  const now = Date.now();
  const hasExplicitDedupeKey = dedupeKey !== undefined;

  if (!hasExplicitDedupeKey) {
    const key = createWorkspaceNotificationDedupeKey({ description, title, tone });
    const recentTimestamp = recentNotificationTimestamps.get(key);
    if (recentTimestamp && now - recentTimestamp < debounceMs) return null;

    recentNotificationTimestamps.set(key, now);
    pruneRecentNotificationTimestamps(now);
  }

  const id = `workspace-notification-${now}-${notificationCounter++}`;
  notifications = [
    ...notifications.filter((notification) => !hasExplicitDedupeKey || notification.dedupeKey !== dedupeKey),
    {
      actionIcon,
      actionLabel,
      createdAt: now,
      dedupeKey,
      description,
      id,
      onAction,
      title,
      tone,
    },
  ].slice(-maxWorkspaceNotifications);
  emitWorkspaceNotifications();
  return id;
}

export function closeWorkspaceNotification(id: string) {
  notifications = notifications.filter((notification) => notification.id !== id);
  emitWorkspaceNotifications();
}

export async function triggerWorkspaceNotificationAction(id: string) {
  const notification = notifications.find((candidate) => candidate.id === id);
  if (!notification?.onAction || pendingNotificationActions.has(id)) return false;

  pendingNotificationActions.add(id);
  try {
    const accepted = await notification.onAction();
    if (accepted === false) return false;

    notifications = notifications.filter((candidate) => candidate.id !== id);
    emitWorkspaceNotifications();
    return true;
  } finally {
    pendingNotificationActions.delete(id);
  }
}

export function subscribeWorkspaceNotifications(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorkspaceNotificationsSnapshot() {
  return notifications;
}

function emitWorkspaceNotifications() {
  listeners.forEach((listener) => listener());
}

function createWorkspaceNotificationDedupeKey({
  description,
  title,
  tone,
}: {
  description?: ReactNode;
  title: ReactNode;
  tone: WorkspaceNotificationTone;
}) {
  return [tone, normalizeNotificationNode(title), normalizeNotificationNode(description)].join(":");
}

function normalizeNotificationNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(normalizeNotificationNode).join("|");
  return "notification-node";
}

function pruneRecentNotificationTimestamps(now: number) {
  if (recentNotificationTimestamps.size < 64) return;
  recentNotificationTimestamps.forEach((timestamp, key) => {
    if (now - timestamp > 10_000) recentNotificationTimestamps.delete(key);
  });
}
