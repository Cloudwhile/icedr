import { describe, expect, it } from "vitest";
import {
  getDriveFileNameConflictKey,
  maxDriveFileNameLength,
  validateDriveFileName,
} from "./file-name-policy";

describe("drive file name policy", () => {
  it("trims valid file names", () => {
    expect(validateDriveFileName("  Customer Notes.pdf  ")).toEqual({
      name: "Customer Notes.pdf",
      ok: true,
    });
  });

  it("rejects path separators and reserved names", () => {
    expect(validateDriveFileName("../report.pdf")).toMatchObject({
      code: "invalid-characters",
      ok: false,
    });
    expect(validateDriveFileName("CON.txt")).toMatchObject({
      code: "reserved",
      ok: false,
    });
  });

  it("rejects unsafe endings and long names", () => {
    expect(validateDriveFileName("report.")).toMatchObject({
      code: "trailing-space-or-dot",
      ok: false,
    });
    expect(validateDriveFileName("a".repeat(maxDriveFileNameLength + 1))).toMatchObject({
      code: "too-long",
      ok: false,
    });
  });

  it("creates case-insensitive conflict keys", () => {
    expect(getDriveFileNameConflictKey("  ICEDR Roadmap.docx  ")).toBe("icedr roadmap.docx");
  });
});
