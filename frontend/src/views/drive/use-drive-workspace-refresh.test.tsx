import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  driveRefreshSucceeded,
  type DriveRefreshTarget,
} from "./drive-refresh-result";
import {
  runDriveRefreshTasks,
  useDriveWorkspaceRefresh,
  type DriveRefreshTasks,
} from "./use-drive-workspace-refresh";

describe("useDriveWorkspaceRefresh", () => {
  it("将同一时刻的重复刷新合并为一个请求", async () => {
    const files = deferred<ReturnType<typeof driveRefreshSucceeded>>();
    const tasks = createTasks({ files: vi.fn(() => files.promise) });
    const onComplete = vi.fn();
    const { result } = renderHook(() => useDriveWorkspaceRefresh({
      disabled: false,
      onComplete,
      tasks,
    }));

    let first!: ReturnType<typeof result.current.refreshWorkspace>;
    let second!: ReturnType<typeof result.current.refreshWorkspace>;
    act(() => {
      first = result.current.refreshWorkspace();
      second = result.current.refreshWorkspace();
    });

    expect(first).toBe(second);
    expect(tasks.files).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    files.resolve(driveRefreshSucceeded("files"));
    await act(async () => {
      await first;
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(false);
  });

  it("禁用期间不启动刷新", async () => {
    const tasks = createTasks();
    const { result } = renderHook(() => useDriveWorkspaceRefresh({
      disabled: true,
      onComplete: vi.fn(),
      tasks,
    }));

    await expect(result.current.refreshWorkspace()).resolves.toBeNull();
    Object.values(tasks).forEach((task) => expect(task).not.toHaveBeenCalled());
  });
});

describe("runDriveRefreshTasks", () => {
  it("把意外抛错转换为失败结果并继续汇总其他模块", async () => {
    const tasks = createTasks({
      shares: vi.fn(async () => {
        throw new Error("分享接口不可用");
      }),
    });

    const summary = await runDriveRefreshTasks(tasks);

    expect(summary.status).toBe("partial");
    expect(summary.incomplete).toContainEqual({
      message: "分享接口不可用",
      stale: false,
      status: "failed",
      target: "shares",
    });
  });
});

function createTasks(overrides: Partial<DriveRefreshTasks> = {}): DriveRefreshTasks {
  const createSuccessTask = (target: DriveRefreshTarget) => vi.fn(async () => driveRefreshSucceeded(target));
  return {
    files: overrides.files ?? createSuccessTask("files"),
    shares: overrides.shares ?? createSuccessTask("shares"),
    shareSettings: overrides.shareSettings ?? createSuccessTask("shareSettings"),
    storage: overrides.storage ?? createSuccessTask("storage"),
    transfers: overrides.transfers ?? createSuccessTask("transfers"),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
