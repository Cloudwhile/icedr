"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";
import type { LocalIconName, Palette } from "@/features/file/model";
import {
  closeWorkspaceNotification,
  getWorkspaceNotificationsSnapshot,
  subscribeWorkspaceNotifications,
  triggerWorkspaceNotificationAction,
  type WorkspaceNotificationTone,
} from "./workspace-notification-store";

export function WorkspaceNotificationStack({
  closeLabel,
  palette,
}: {
  closeLabel: string;
  palette: Palette;
}) {
  const visibleNotifications = useSyncExternalStore(
    subscribeWorkspaceNotifications,
    getWorkspaceNotificationsSnapshot,
    getWorkspaceNotificationsSnapshot,
  );

  return (
    <div aria-live="polite" aria-relevant="additions removals" className="workspace-notification-region">
      <AnimatePresence initial={false}>
        {visibleNotifications.map((notification) => (
          <motion.div
            animate={{ opacity: 1, scale: 1, x: 0 }}
            className="workspace-notification"
            data-tone={notification.tone}
            exit={{ opacity: 0, scale: 0.97, x: -18 }}
            initial={{ opacity: 0, scale: 0.975, x: -24 }}
            key={notification.id}
            layout
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="workspace-notification-icon">
              <LocalIcon name={getNotificationIcon(notification.tone)} size={16} />
            </span>
            <span className="workspace-notification-copy">
              <span className="workspace-notification-title">{notification.title}</span>
              {notification.description ? (
                <span className="workspace-notification-description">{notification.description}</span>
              ) : null}
            </span>
            <span className="workspace-notification-actions">
              {notification.actionLabel && notification.onAction ? (
                notification.actionIcon ? (
                  <ToolButton
                    className="workspace-notification-action"
                    label={notification.actionLabel}
                    palette={palette}
                    size="sm"
                    tooltipPlacement="top"
                    onClick={() => triggerWorkspaceNotificationAction(notification.id)}
                  >
                    <LocalIcon name={notification.actionIcon} size={14} />
                  </ToolButton>
                ) : (
                  <button
                    aria-label={notification.actionLabel}
                    className="workspace-notification-action-label"
                    onClick={() => triggerWorkspaceNotificationAction(notification.id)}
                    type="button"
                  >
                    {notification.actionLabel}
                  </button>
                )
              ) : null}
              <ToolButton
                className="workspace-notification-close"
                label={closeLabel}
                palette={palette}
                size="sm"
                tooltipPlacement="top"
                onClick={() => closeWorkspaceNotification(notification.id)}
              >
                <LocalIcon name="cross" size={14} />
              </ToolButton>
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function getNotificationIcon(tone: WorkspaceNotificationTone): LocalIconName {
  if (tone === "error") return "exclamation";
  if (tone === "warning") return "exclamation";
  if (tone === "info") return "info";
  if (tone === "neutral") return "notification";
  return "tick";
}
