import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultUploadPreferences,
  persistUploadPreferences,
  readUploadPreferences,
} from "./upload-preferences";

beforeEach(() => {
  window.localStorage.clear();
});

describe("upload preferences", () => {
  it("uses the honest UI defaults when no stored value exists", () => {
    expect(readUploadPreferences()).toEqual(defaultUploadPreferences);
  });

  it("persists the concurrency and auto-clear choices", () => {
    persistUploadPreferences({
      autoClearCompleted: true,
      concurrentUploadLimit: 1,
    });

    expect(readUploadPreferences()).toEqual({
      autoClearCompleted: true,
      concurrentUploadLimit: 1,
    });
  });

  it.each([
    [0, 1],
    [9, 4],
    [2.5, 3],
  ])("normalizes stored concurrency %s to %s", (stored, expected) => {
    window.localStorage.setItem(
      "icedr.ui.uploadPreferences",
      JSON.stringify({ concurrentUploadLimit: stored }),
    );

    expect(readUploadPreferences().concurrentUploadLimit).toBe(expected);
  });
});
