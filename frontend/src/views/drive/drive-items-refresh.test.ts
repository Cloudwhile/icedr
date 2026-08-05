import { describe, expect, it, vi } from "vitest";
import { createLatestDriveItemsRequestRunner } from "./drive-items-refresh";

describe("createLatestDriveItemsRequestRunner", () => {
  it("B 先成功时忽略随后完成的 A 成功结果", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const state = createStateRecorder();
    const runLatest = createLatestDriveItemsRequestRunner();

    const requestA = runLatest(() => a.promise, state.succeed, state.fail);
    const requestB = runLatest(() => b.promise, state.succeed, state.fail);

    b.resolve("B");
    await expect(requestB).resolves.toBe(true);
    a.resolve("A");
    await expect(requestA).resolves.toBe(false);

    expect(state.succeed).toHaveBeenCalledTimes(1);
    expect(state.value).toBe("B");
    expect(state.error).toBeNull();
  });

  it("B 先成功时忽略随后失败的 A，不清空 B 的最新状态", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const state = createStateRecorder();
    const runLatest = createLatestDriveItemsRequestRunner();

    const requestA = runLatest(() => a.promise, state.succeed, state.fail);
    const requestB = runLatest(() => b.promise, state.succeed, state.fail);

    b.resolve("B");
    await expect(requestB).resolves.toBe(true);
    a.reject(new Error("A 加载失败"));
    await expect(requestA).resolves.toBe(false);

    expect(state.fail).not.toHaveBeenCalled();
    expect(state.value).toBe("B");
    expect(state.error).toBeNull();
  });

  it("A 在 B 等待期间先成功时仍视为过期，只提交随后完成的 B", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const state = createStateRecorder();
    const runLatest = createLatestDriveItemsRequestRunner();

    const requestA = runLatest(() => a.promise, state.succeed, state.fail);
    const requestB = runLatest(() => b.promise, state.succeed, state.fail);

    a.resolve("A");
    await expect(requestA).resolves.toBe(false);
    expect(state.succeed).not.toHaveBeenCalled();

    b.resolve("B");
    await expect(requestB).resolves.toBe(true);
    expect(state.value).toBe("B");
  });

  it("A 在 B 等待期间先失败时不写错误，只提交 B 的失败", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const state = createStateRecorder();
    const runLatest = createLatestDriveItemsRequestRunner();

    const requestA = runLatest(() => a.promise, state.succeed, state.fail);
    const requestB = runLatest(() => b.promise, state.succeed, state.fail);

    a.reject(new Error("A 加载失败"));
    await expect(requestA).resolves.toBe(false);
    expect(state.fail).not.toHaveBeenCalled();

    b.reject(new Error("B 加载失败"));
    await expect(requestB).resolves.toBe(false);
    expect(state.fail).toHaveBeenCalledTimes(1);
    expect(state.error).toBe("B 加载失败");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createStateRecorder() {
  const state = {
    error: null as string | null,
    value: null as string | null,
    succeed: vi.fn((value: string) => {
      state.value = value;
      state.error = null;
    }),
    fail: vi.fn((error: unknown) => {
      state.value = null;
      state.error = error instanceof Error ? error.message : String(error);
    }),
  };
  return state;
}
