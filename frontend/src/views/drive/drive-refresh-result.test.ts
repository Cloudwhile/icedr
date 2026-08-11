import { describe, expect, it } from "vitest";
import {
  driveRefreshFailed,
  driveRefreshSkipped,
  driveRefreshSucceeded,
  driveRefreshSuperseded,
  summarizeDriveRefresh,
} from "./drive-refresh-result";

describe("summarizeDriveRefresh", () => {
  it("仅在所有模块成功时返回 success", () => {
    const summary = summarizeDriveRefresh([
      driveRefreshSucceeded("files"),
      driveRefreshSucceeded("shares"),
      driveRefreshSucceeded("shareSettings"),
      driveRefreshSucceeded("transfers"),
      driveRefreshSucceeded("storage"),
    ]);

    expect(summary.status).toBe("success");
    expect(summary.incomplete).toEqual([]);
    expect(summary.succeeded).toHaveLength(5);
  });

  it("部分模块失败时返回 partial 并保留失败信息", () => {
    const summary = summarizeDriveRefresh([
      driveRefreshSucceeded("files"),
      driveRefreshFailed("shares", "分享加载失败", true),
      driveRefreshSucceeded("storage"),
    ]);

    expect(summary.status).toBe("partial");
    expect(summary.incomplete).toEqual([
      { message: "分享加载失败", stale: true, status: "failed", target: "shares" },
    ]);
  });

  it("没有成功模块时返回 failed", () => {
    const summary = summarizeDriveRefresh([
      driveRefreshFailed("files", "文件加载失败", true),
      driveRefreshFailed("shares", "分享加载失败", false),
    ]);

    expect(summary.status).toBe("failed");
    expect(summary.succeeded).toEqual([]);
  });

  it("被替代或跳过的请求不会计为成功", () => {
    const summary = summarizeDriveRefresh([
      driveRefreshSuperseded("files"),
      driveRefreshSkipped("storage"),
    ]);

    expect(summary.status).toBe("failed");
    expect(summary.incomplete.map((outcome) => outcome.status)).toEqual(["superseded", "skipped"]);
  });
});
