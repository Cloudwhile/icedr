import { describe, expect, it } from "vitest";
import { shouldPreventDriveEntryTextSelection } from "./drive-entry-events";

describe("shouldPreventDriveEntryTextSelection", () => {
  it("allows ordinary single-click selection", () => {
    const entry = document.createElement("div");
    const label = document.createElement("span");
    entry.append(label);

    expect(shouldPreventDriveEntryTextSelection(1, label, entry)).toBe(false);
  });

  it("prevents browser word selection on the second entry click", () => {
    const entry = document.createElement("div");
    const label = document.createElement("span");
    entry.append(label);

    expect(shouldPreventDriveEntryTextSelection(2, label, entry)).toBe(true);
  });

  it("keeps nested rename inputs selectable", () => {
    const entry = document.createElement("div");
    const input = document.createElement("input");
    entry.append(input);

    expect(shouldPreventDriveEntryTextSelection(2, input, entry)).toBe(false);
  });

  it("prevents selection when the entry itself is a button", () => {
    const entry = document.createElement("button");
    const label = document.createElement("span");
    entry.append(label);

    expect(shouldPreventDriveEntryTextSelection(2, label, entry)).toBe(true);
  });
});
