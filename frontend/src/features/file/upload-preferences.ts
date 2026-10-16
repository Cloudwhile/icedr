const uploadPreferencesStorageKey = "icedr.ui.uploadPreferences";

export type UploadPreferences = {
  autoClearCompleted: boolean;
  concurrentUploadLimit: number;
};

export const defaultUploadPreferences: UploadPreferences = {
  autoClearCompleted: false,
  concurrentUploadLimit: 3,
};

export function readUploadPreferences(): UploadPreferences {
  if (typeof window === "undefined") return defaultUploadPreferences;

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(uploadPreferencesStorageKey) ?? "null",
    ) as Partial<UploadPreferences> | null;
    const concurrentUploadLimit = Number(stored?.concurrentUploadLimit);
    return {
      autoClearCompleted: stored?.autoClearCompleted === true,
      concurrentUploadLimit: Number.isInteger(concurrentUploadLimit)
        ? Math.min(4, Math.max(1, concurrentUploadLimit))
        : defaultUploadPreferences.concurrentUploadLimit,
    };
  } catch {
    return defaultUploadPreferences;
  }
}

export function persistUploadPreferences(preferences: UploadPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      uploadPreferencesStorageKey,
      JSON.stringify(preferences),
    );
  } catch {
    // Browser storage can be unavailable; the current in-memory choice still works.
  }
}
