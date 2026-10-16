import { describe, expect, it, vi } from "vitest";
import {
  createUploadConflictPromptQueue,
  type UploadConflictPrompt,
} from "./upload-conflict-prompt-queue";

function prompt(batchCount: number, name: string): UploadConflictPrompt {
  return {
    batchCount,
    conflictCount: 1,
    fileNames: [name],
  };
}

describe("upload conflict prompt queue", () => {
  it("keeps a later batch queued until the active batch is resolved", async () => {
    const onPromptChange = vi.fn();
    const queue = createUploadConflictPromptQueue(onPromptChange);
    const first = queue.request(prompt(2, "first.txt"));
    const second = queue.request(prompt(1, "second.txt"));

    expect(onPromptChange).toHaveBeenLastCalledWith(prompt(2, "first.txt"));
    expect(onPromptChange).not.toHaveBeenCalledWith(prompt(1, "second.txt"));

    queue.resolve("rename");
    await expect(first).resolves.toBe("rename");
    expect(onPromptChange).toHaveBeenLastCalledWith(prompt(1, "second.txt"));

    queue.resolve("skip");
    await expect(second).resolves.toBe("skip");
    expect(onPromptChange).toHaveBeenLastCalledWith(null);
  });

  it("resolves an explicitly discarded batch without changing the next batch", async () => {
    const onPromptChange = vi.fn();
    const queue = createUploadConflictPromptQueue(onPromptChange);
    const first = queue.request(prompt(3, "report.txt"));
    const secondPrompt = prompt(2, "photo.jpg");
    const second = queue.request(secondPrompt);

    expect(queue.resolve(null)).toBe(true);
    await expect(first).resolves.toBeNull();
    expect(onPromptChange).toHaveBeenLastCalledWith(secondPrompt);
    queue.resolve("version");
    await expect(second).resolves.toBe("version");
  });

  it("resolves every waiting batch when disposed", async () => {
    const queue = createUploadConflictPromptQueue(() => undefined);
    const first = queue.request(prompt(1, "first.txt"));
    const second = queue.request(prompt(1, "second.txt"));

    queue.dispose();

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });
});
