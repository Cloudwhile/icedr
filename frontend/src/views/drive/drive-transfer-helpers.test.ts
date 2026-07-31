import { describe, expect, it, vi } from "vitest";
import {
  isUploadRecoveryPersistenceContextCurrent,
  prepareUploadQueueGroups,
} from "./drive-transfer-helpers";

describe("prepareUploadQueueGroups", () => {
  it("allocates every batch member before the concurrent scheduler starts", () => {
    const createDraftId = vi
      .fn()
      .mockImplementation(
        () => `draft-${createDraftId.mock.calls.length}`,
      );

    const queuedGroups = prepareUploadQueueGroups(
      [["a.txt", "a.txt"], ["b.txt"], ["c.txt", "d.txt"]],
      createDraftId,
    );

    expect(createDraftId).toHaveBeenCalledTimes(5);
    expect(queuedGroups).toEqual([
      [
        { draftId: "draft-1", item: "a.txt" },
        { draftId: "draft-2", item: "a.txt" },
      ],
      [{ draftId: "draft-3", item: "b.txt" }],
      [
        { draftId: "draft-4", item: "c.txt" },
        { draftId: "draft-5", item: "d.txt" },
      ],
    ]);
  });

  it("rejects upload callbacks from an older owner or workspace generation", () => {
    const expected = {
      generation: 3,
      ownerUserId: "owner-a",
      workspaceId: "workspace-a",
    };

    expect(
      isUploadRecoveryPersistenceContextCurrent(expected, expected),
    ).toBe(true);
    expect(
      isUploadRecoveryPersistenceContextCurrent(expected, {
        ...expected,
        generation: 4,
      }),
    ).toBe(false);
    expect(
      isUploadRecoveryPersistenceContextCurrent(expected, {
        ...expected,
        ownerUserId: "owner-b",
      }),
    ).toBe(false);
    expect(
      isUploadRecoveryPersistenceContextCurrent(expected, {
        ...expected,
        workspaceId: "workspace-b",
      }),
    ).toBe(false);
  });
});
