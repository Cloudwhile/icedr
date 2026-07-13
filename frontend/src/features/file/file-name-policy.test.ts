import { describe, expect, it } from "vitest";
import {
  getDriveFileNameConflictKey,
  maxDriveFileNameBytes,
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
    expect(
      validateDriveFileName(`report${String.fromCharCode(0x85)}.pdf`),
    ).toMatchObject({
      code: "invalid-characters",
      ok: false,
    });
    expect(validateDriveFileName("CON.txt")).toMatchObject({
      code: "reserved",
      ok: false,
    });
  });

  it("rejects Windows reserved names that use superscript digits", () => {
    expect(validateDriveFileName("COM¹.txt")).toMatchObject({
      code: "reserved",
      ok: false,
    });
    expect(validateDriveFileName("LPT³")).toMatchObject({
      code: "reserved",
      ok: false,
    });
  });

  it("rejects unsafe endings and long names", () => {
    expect(validateDriveFileName("report.")).toMatchObject({
      code: "trailing-space-or-dot",
      ok: false,
    });
    expect(validateDriveFileName("a".repeat(maxDriveFileNameBytes + 1))).toMatchObject({
      code: "too-long",
      ok: false,
    });
  });

  it("enforces the file name limit in UTF-8 bytes", () => {
    expect(validateDriveFileName("界".repeat(85))).toEqual({
      name: "界".repeat(85),
      ok: true,
    });
    expect(validateDriveFileName("界".repeat(86))).toMatchObject({
      code: "too-long",
      ok: false,
    });
  });

  it("rejects malformed Unicode file names", () => {
    expect(
      validateDriveFileName(`broken-${String.fromCharCode(0xd800)}.txt`),
    ).toMatchObject({ code: "invalid-characters", ok: false });
    expect(
      validateDriveFileName(`broken-${String.fromCharCode(0xdc00)}.txt`),
    ).toMatchObject({ code: "invalid-characters", ok: false });
    expect(
      validateDriveFileName(`broken-${String.fromCharCode(0xd800)}`),
    ).toMatchObject({ code: "invalid-characters", ok: false });
  });

  it("creates case-insensitive conflict keys", () => {
    expect(getDriveFileNameConflictKey("  ICEDR Roadmap.docx  ")).toBe("icedr roadmap.docx");
    expect(getDriveFileNameConflictKey("Résumé.pdf")).toBe(
      getDriveFileNameConflictKey("Résumé.pdf"),
    );
  });
});
