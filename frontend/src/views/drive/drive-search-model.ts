import type { DriveItem } from "@/features/file/model";
import type { FileNodeListState, FileNodeSearchQuery } from "@/lib/drive-api";

export type SearchTypeFilter = "all" | NonNullable<FileNodeSearchQuery["type"]>;
export type SearchStateFilter = "context" | FileNodeListState;
export type SearchSharedFilter = NonNullable<FileNodeSearchQuery["shared"]>;
export type SearchUpdatedFilter = "all" | "7d" | "30d" | "90d";
export type SearchSizeFilter = "all" | "small" | "medium" | "large";
export type DriveSortBy = NonNullable<FileNodeSearchQuery["sortBy"]>;
export type DriveSortDirection = NonNullable<FileNodeSearchQuery["sortDirection"]>;

export type DriveSearchFilters = {
  shared: SearchSharedFilter;
  size: SearchSizeFilter;
  sortBy: DriveSortBy;
  sortDirection: DriveSortDirection;
  state: SearchStateFilter;
  type: SearchTypeFilter;
  created: SearchUpdatedFilter;
  updated: SearchUpdatedFilter;
};

export const defaultDriveSearchFilters: DriveSearchFilters = {
  shared: "all",
  size: "all",
  sortBy: "updatedAt",
  sortDirection: "desc",
  state: "context",
  type: "all",
  created: "all",
  updated: "all",
};

export function hasActiveDriveSearchFilters(filters: DriveSearchFilters) {
  return (
    filters.shared !== defaultDriveSearchFilters.shared ||
    filters.size !== defaultDriveSearchFilters.size ||
    filters.state !== defaultDriveSearchFilters.state ||
    filters.type !== defaultDriveSearchFilters.type ||
    filters.created !== defaultDriveSearchFilters.created ||
    filters.updated !== defaultDriveSearchFilters.updated
  );
}

export function getUpdatedFromFilter(value: SearchUpdatedFilter) {
  if (value === "all") return undefined;
  const days = value === "7d" ? 7 : value === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function getSizeRangeFilter(value: SearchSizeFilter) {
  if (value === "small") return { maxSizeBytes: 1024 * 1024 };
  if (value === "medium") return { minSizeBytes: 1024 * 1024, maxSizeBytes: 100 * 1024 * 1024 };
  if (value === "large") return { minSizeBytes: 100 * 1024 * 1024 };
  return {};
}

export function sortDriveItems(items: DriveItem[], filters: Pick<DriveSearchFilters, "sortBy" | "sortDirection">) {
  const direction = filters.sortDirection === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (filters.sortBy === "name") {
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) * direction;
    }
    if (filters.sortBy === "sizeBytes") {
      return compareNullableNumber(left.sizeBytes, right.sizeBytes) * direction;
    }
    const leftTime = filters.sortBy === "createdAt" ? left.createdAt : left.modifiedAt;
    const rightTime = filters.sortBy === "createdAt" ? right.createdAt : right.modifiedAt;
    return compareNullableNumber(getTimeValue(leftTime), getTimeValue(rightTime)) * direction;
  });
}

function compareNullableNumber(left: number | null | undefined, right: number | null | undefined) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}

function getTimeValue(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}
