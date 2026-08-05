export type DriveFileCollectionState =
  | "collection-empty"
  | "error"
  | "folder-empty"
  | "ready"
  | "root-empty"
  | "search-empty"
  | "search-loading"
  | "trash-empty";

export function resolveDriveFileCollectionState({
  activeNav,
  currentFolderId,
  error,
  hasQuery,
  itemCount,
  searchLoading,
}: {
  activeNav: string;
  currentFolderId: string | null;
  error: string | null;
  hasQuery: boolean;
  itemCount: number;
  searchLoading: boolean;
}): DriveFileCollectionState {
  if (itemCount > 0) return "ready";
  if (error) return "error";
  if (searchLoading) return "search-loading";
  if (hasQuery) return "search-empty";
  if (activeNav === "trash") return "trash-empty";
  if (activeNav === "drive") {
    return currentFolderId ? "folder-empty" : "root-empty";
  }
  return "collection-empty";
}
