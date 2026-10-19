export type DriveViewPreference = "list" | "grid";

const storageKey = "icedr.ui.viewMode";

export function readViewPreference(): DriveViewPreference {
  try {
    return window.localStorage.getItem(storageKey) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

export function persistViewPreference(mode: DriveViewPreference) {
  try {
    window.localStorage.setItem(storageKey, mode);
  } catch {
    // Keep the current view usable when browser storage is unavailable.
  }
}
