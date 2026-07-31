import { describe, expect, it } from "vitest";
import { summarizeUploadProgress, type UploadProgressSource } from "./upload-progress";

type ProgressRow = UploadProgressSource & {
  id: string;
};

function createRow(
  id: string,
  input: Partial<ProgressRow> = {},
): ProgressRow {
  return {
    id,
    progress: 0,
    status: "running",
    totalBytes: 100,
    ...input,
  };
}

describe("summarizeUploadProgress", () => {
  it("uses byte weights and includes completed and failed members of an active batch", () => {
    const summary = summarizeUploadProgress([
      createRow("active", {
        batchId: "batch-a",
        progress: 10,
        totalBytes: 900,
      }),
      createRow("completed", {
        batchId: "batch-a",
        progress: 0,
        status: "completed",
      }),
      createRow("failed", {
        batchId: "batch-a",
        progress: 20,
        status: "failed",
      }),
      createRow("unrelated", {
        batchId: "batch-b",
        progress: 100,
        status: "completed",
        totalBytes: 10_000,
      }),
    ]);

    expect(summary.batchIds).toEqual(["batch-a"]);
    expect(summary.activeRows.map((row) => row.id)).toEqual(["active"]);
    expect(summary.memberRows.map((row) => row.id)).toEqual([
      "active",
      "completed",
      "failed",
    ]);
    expect(summary.progress).toBe(19.1);
    expect(summary.estimated).toBe(false);
  });

  it("aggregates every active row when more than six tasks are visible", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      createRow(`row-${index}`, {
        batchId: "batch-many",
        progress: (index + 1) * 10,
      }),
    );

    const summary = summarizeUploadProgress(rows);

    expect(summary.activeRows).toHaveLength(8);
    expect(summary.memberRows).toHaveLength(8);
    expect(summary.progress).toBe(45);
  });

  it("gives missing-byte members an explicit estimated weight instead of ignoring them", () => {
    const summary = summarizeUploadProgress([
      createRow("known", {
        batchId: "batch-mixed",
        progress: 100,
        totalBytes: 100,
      }),
      createRow("unknown", {
        batchId: "batch-mixed",
        progress: 0,
        totalBytes: undefined,
      }),
    ]);

    expect(summary.progress).toBe(50);
    expect(summary.estimated).toBe(true);
    expect(summary.missingByteRowCount).toBe(1);
  });

  it("keeps independent unbatched active tasks without adopting unrelated history", () => {
    const summary = summarizeUploadProgress([
      createRow("active-unbatched", { progress: 40 }),
      createRow("completed-unbatched", {
        progress: 100,
        status: "completed",
      }),
      createRow("canceled", {
        batchId: "batch-a",
        progress: 50,
        status: "canceled",
      }),
    ]);

    expect(summary.memberRows.map((row) => row.id)).toEqual([
      "active-unbatched",
    ]);
    expect(summary.progress).toBe(40);
  });
});
