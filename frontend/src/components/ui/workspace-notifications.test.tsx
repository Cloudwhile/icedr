import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import {
  closeWorkspaceNotification,
  getWorkspaceNotificationsSnapshot,
  showWorkspaceNotification,
  triggerWorkspaceNotificationAction,
} from "./workspace-notification-store";
import { WorkspaceNotificationStack } from "./workspace-notifications";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  },
}));

vi.mock("./app-icon", () => ({
  LocalIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("./tool-button", () => ({
  ToolButton: ({
    children,
    className,
    label,
    onClick,
  }: {
    children: ReactNode;
    className?: string;
    label: string;
    onClick?: () => void;
  }) => (
    <button aria-label={label} className={className} onClick={onClick} type="button">
      {children}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  for (const notification of getWorkspaceNotificationsSnapshot()) {
    closeWorkspaceNotification(notification.id);
  }
  vi.clearAllMocks();
});

describe("workspace notifications", () => {
  it("runs an accepted action at most once and then closes its notification", async () => {
    const action = deferred<boolean>();
    const onAction = vi.fn(() => action.promise);
    const id = showWorkspaceNotification({
      actionLabel: "Undo",
      debounceMs: 0,
      dedupeKey: "action-once",
      onAction,
      title: "Moved to trash",
    });

    expect(id).not.toBeNull();
    const firstTrigger = triggerWorkspaceNotificationAction(id!);
    await expect(triggerWorkspaceNotificationAction(id!)).resolves.toBe(false);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(getWorkspaceNotificationsSnapshot()).toHaveLength(1);

    action.resolve(true);
    await expect(firstTrigger).resolves.toBe(true);
    expect(getWorkspaceNotificationsSnapshot()).toHaveLength(0);
  });

  it("keeps a notification when its action is not accepted", async () => {
    const id = showWorkspaceNotification({
      actionLabel: "Undo",
      dedupeKey: "busy-undo",
      onAction: () => false,
      title: "Moved to trash",
    });

    await expect(triggerWorkspaceNotificationAction(id!)).resolves.toBe(false);
    expect(getWorkspaceNotificationsSnapshot()).toHaveLength(1);
  });

  it("keeps only the latest notification for an explicit dedupe key", () => {
    showWorkspaceNotification({ dedupeKey: "unique-archive", title: "First" });
    showWorkspaceNotification({ dedupeKey: "unique-archive", title: "Second" });

    expect(getWorkspaceNotificationsSnapshot()).toHaveLength(1);
    expect(getWorkspaceNotificationsSnapshot()[0]?.title).toBe("Second");
  });

  it("debounces notifications that use the generated content key", () => {
    const firstId = showWorkspaceNotification({ title: "Repeated refresh result" });
    const secondId = showWorkspaceNotification({ title: "Repeated refresh result" });

    expect(firstId).not.toBeNull();
    expect(secondId).toBeNull();
    expect(getWorkspaceNotificationsSnapshot()).toHaveLength(1);
  });

  it("renders an icon action with an accessible label", async () => {
    const onAction = vi.fn();
    act(() => {
      showWorkspaceNotification({
        actionIcon: "arrow_left",
        actionLabel: "Undo",
        debounceMs: 0,
        dedupeKey: "accessible-action",
        onAction,
        title: "Moved to trash",
      });
    });

    render(<WorkspaceNotificationStack closeLabel="Close" palette={palettes.light} />);
    const action = screen.getByRole("button", { name: "Undo" });
    expect(action.querySelector('[data-icon="arrow_left"]')).toBeInTheDocument();

    fireEvent.click(action);

    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Moved to trash")).not.toBeInTheDocument());
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
