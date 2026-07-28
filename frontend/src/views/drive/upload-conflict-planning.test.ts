import { describe, expect, it, vi } from "vitest";
import {
  analyzeUploadConflicts,
  planUploadConflictResolution,
  runUploadGroups,
} from "./upload-conflict-planning";

type Candidate = {
  id: string;
  name: string;
};

function candidate(id: string, name: string): Candidate {
  return { id, name };
}

describe("upload conflict planning", () => {
  it("detects existing and in-batch conflicts by canonical name", () => {
    const existingConflict = candidate("existing", " report.TXT ");
    const firstDuplicate = candidate("first", "Résumé.txt");
    const secondDuplicate = candidate("second", "Résumé.TXT");
    const unique = candidate("unique", "notes.txt");

    const analysis = analyzeUploadConflicts(
      [existingConflict, firstDuplicate, secondDuplicate, unique],
      ["Report.txt"],
    );

    expect(analysis.conflictingFiles.map((file) => file.id)).toEqual([
      "existing",
      "first",
      "second",
    ]);
    expect(analysis.groups).toHaveLength(3);
  });

  it("keeps the first in-batch file for skip when the directory has no old file", () => {
    const first = candidate("first", "Report.txt");
    const second = candidate("second", "report.TXT");
    const analysis = analyzeUploadConflicts([first, second], []);

    const plan = planUploadConflictResolution(analysis, "skip");

    expect(plan.uploadGroups).toEqual([[first]]);
    expect(plan.skippedFiles).toEqual([second]);
  });

  it("skips the whole canonical group when the directory already has a conflict", () => {
    const first = candidate("first", "Report.txt");
    const second = candidate("second", "report.TXT");
    const analysis = analyzeUploadConflicts([first, second], ["REPORT.txt"]);

    const plan = planUploadConflictResolution(analysis, "skip");

    expect(plan.uploadGroups).toEqual([]);
    expect(plan.skippedFiles).toEqual([first, second]);
  });

  it.each(["rename", "overwrite", "version"] as const)(
    "keeps canonical groups intact for %s",
    (strategy) => {
      const first = candidate("first", "Report.txt");
      const second = candidate("second", "report.TXT");
      const unique = candidate("unique", "notes.txt");
      const analysis = analyzeUploadConflicts([first, unique, second], []);

      const plan = planUploadConflictResolution(analysis, strategy);

      expect(plan.uploadGroups).toEqual([[first, second], [unique]]);
      expect(plan.skippedFiles).toEqual([]);
    },
  );

  it("starts canonical groups in parallel but serializes items within each group", async () => {
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const start = vi.fn((item: Candidate) => {
      started.push(item.id);
      return new Promise<void>((resolve) => {
        releases.set(item.id, resolve);
      });
    });
    const firstA = candidate("a-1", "a.txt");
    const secondA = candidate("a-2", "A.TXT");
    const firstB = candidate("b-1", "b.txt");
    const secondB = candidate("b-2", "B.TXT");

    const running = runUploadGroups(
      [[firstA, secondA], [firstB, secondB]],
      start,
    );

    expect(started).toEqual(["a-1", "b-1"]);

    releases.get("a-1")?.();
    await vi.waitFor(() => expect(started).toEqual(["a-1", "b-1", "a-2"]));
    expect(started).not.toContain("b-2");

    releases.get("b-1")?.();
    await vi.waitFor(() => expect(started).toContain("b-2"));
    releases.get("a-2")?.();
    releases.get("b-2")?.();
    await running;
  });

  it("continues a canonical group after a rejected start", async () => {
    const started: string[] = [];
    const first = candidate("first", "report.txt");
    const second = candidate("second", "REPORT.TXT");

    await runUploadGroups([[first, second]], (item) => {
      started.push(item.id);
      return item === first ? Promise.reject(new Error("failed")) : Promise.resolve();
    });

    expect(started).toEqual(["first", "second"]);
  });

  it("limits concurrent groups and assigns queued groups in input order", async () => {
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    let activeGroups = 0;
    let maxActiveGroups = 0;
    const files = ["first", "second", "third", "fourth"].map((id) => (
      candidate(id, `${id}.txt`)
    ));

    const running = runUploadGroups(
      files.map((file) => [file]),
      (item) => {
        started.push(item.id);
        activeGroups += 1;
        maxActiveGroups = Math.max(maxActiveGroups, activeGroups);
        return new Promise<void>((resolve) => {
          releases.set(item.id, () => {
            activeGroups -= 1;
            resolve();
          });
        });
      },
      2,
    );

    expect(started).toEqual(["first", "second"]);
    expect(maxActiveGroups).toBe(2);

    releases.get("first")?.();
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "second", "third"]);
    });

    releases.get("second")?.();
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "second", "third", "fourth"]);
    });

    releases.get("third")?.();
    releases.get("fourth")?.();
    await running;
    expect(maxActiveGroups).toBe(2);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to one worker for invalid concurrency limit %s",
    async (maxConcurrentGroups) => {
      const releases = new Map<string, () => void>();
      const started: string[] = [];
      const first = candidate("first", "first.txt");
      const second = candidate("second", "second.txt");

      const running = runUploadGroups(
        [[first], [second]],
        (item) => {
          started.push(item.id);
          return new Promise<void>((resolve) => {
            releases.set(item.id, resolve);
          });
        },
        maxConcurrentGroups,
      );

      expect(started).toEqual(["first"]);
      releases.get("first")?.();
      await vi.waitFor(() => expect(started).toEqual(["first", "second"]));
      releases.get("second")?.();
      await running;
    },
  );
});
