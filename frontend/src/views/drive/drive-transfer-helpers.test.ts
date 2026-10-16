import { describe, expect, it, vi } from "vitest";
import {
  isUploadRecoveryPersistenceContextCurrent,
  mergeTransferRows,
  prepareUploadQueueGroups,
} from "./drive-transfer-helpers";

describe("prepareUploadQueueGroups", () => {
  it("places recoverable uploads before newer ordinary transfers", () => {
    const rows = mergeTransferRows(
      [
        {
          createdAt: "2026-10-17T12:00:00.000Z",
          id: "ordinary",
        },
      ] as Parameters<typeof mergeTransferRows>[0],
      [
        {
          createdAt: "2026-10-17T10:00:00.000Z",
          id: "recoverable",
          recoveryRequired: true,
        },
      ] as Parameters<typeof mergeTransferRows>[1],
    );

    expect(rows.map(({ id }) => id)).toEqual(["recoverable", "ordinary"]);
  });

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
