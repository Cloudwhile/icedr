type AutoClearCompletedUploadOptions = {
  deleteTransfer: (transferId: string) => Promise<unknown>;
  enabled: boolean;
  onRemoveLocal: () => void;
  refreshTransfers: () => Promise<unknown> | void;
  transferId: string | null | undefined;
};

export async function autoClearCompletedUpload({
  deleteTransfer,
  enabled,
  onRemoveLocal,
  refreshTransfers,
  transferId,
}: AutoClearCompletedUploadOptions) {
  if (!enabled || !transferId) return false;

  onRemoveLocal();
  try {
    await deleteTransfer(transferId);
    return true;
  } catch {
    try {
      await refreshTransfers();
    } catch {
      // The next scheduled/manual refresh can reconcile the list.
    }
    return false;
  }
}
