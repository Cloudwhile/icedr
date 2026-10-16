import { describe, expect, it, vi } from "vitest";
import { autoClearCompletedUpload } from "./upload-auto-clear";

describe("autoClearCompletedUpload", () => {
  it("leaves completed rows in place when the preference is disabled", async () => {
    const deleteTransfer = vi.fn();
    const onRemoveLocal = vi.fn();

    await expect(autoClearCompletedUpload({
      deleteTransfer,
      enabled: false,
      onRemoveLocal,
      refreshTransfers: vi.fn(),
      transferId: "transfer-1",
    })).resolves.toBe(false);

    expect(onRemoveLocal).not.toHaveBeenCalled();
    expect(deleteTransfer).not.toHaveBeenCalled();
  });

  it("removes the local row before deleting its persisted record", async () => {
    const calls: string[] = [];

    await expect(autoClearCompletedUpload({
      deleteTransfer: async (transferId) => {
        calls.push(`delete:${transferId}`);
      },
      enabled: true,
      onRemoveLocal: () => calls.push("remove-local"),
      refreshTransfers: vi.fn(),
      transferId: "transfer-1",
    })).resolves.toBe(true);

    expect(calls).toEqual(["remove-local", "delete:transfer-1"]);
  });

  it("refreshes the transfer list when persisted deletion fails", async () => {
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);

    await expect(autoClearCompletedUpload({
      deleteTransfer: vi.fn().mockRejectedValue(new Error("offline")),
      enabled: true,
      onRemoveLocal: vi.fn(),
      refreshTransfers,
      transferId: "transfer-1",
    })).resolves.toBe(false);

    expect(refreshTransfers).toHaveBeenCalledOnce();
  });
});
