import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  driveRefreshFailed,
  driveRefreshSkipped,
  driveRefreshSucceeded,
  driveRefreshSuperseded,
  summarizeDriveRefresh,
} from "./drive-refresh-result";
import { useDriveRefreshFeedback } from "./use-drive-refresh-feedback";

const notificationMocks = vi.hoisted(() => ({
  showWorkspaceNotification: vi.fn(),
}));

vi.mock("@/components/ui/workspace-notification-store", () => notificationMocks);
vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (
    values?.modules ? `${key}:${values.modules}` : key
  ),
}));

describe("useDriveRefreshFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("失败模块文案排除 skipped 和 superseded 目标", () => {
    const summary = summarizeDriveRefresh([
      driveRefreshFailed("shares", "分享加载失败", true),
      driveRefreshSkipped("storage"),
      driveRefreshSuperseded("files"),
      driveRefreshSucceeded("transfers"),
    ]);
    const { result } = renderHook(() => useDriveRefreshFeedback("en_US"));

    act(() => result.current(summary));

    expect(notificationMocks.showWorkspaceNotification).toHaveBeenCalledTimes(1);
    const notification = notificationMocks.showWorkspaceNotification.mock.calls[0][0];
    expect(notification.description).toContain("app.refreshTarget.shares");
    expect(notification.description).not.toContain("app.refreshTarget.storage");
    expect(notification.description).not.toContain("app.refreshTarget.files");
    expect(notification.description).toContain("app.refreshStaleHint");
  });
});
