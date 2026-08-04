import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { getChildItems, type DriveItem, type DriveUserNav } from "@/features/file/model";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { useTranslations } from "@/i18n/react";
import { searchFileNodes, type DriveSpaceScope } from "@/lib/drive-api";
import type { RegisteredShare } from "@/features/share/registry";
import {
  defaultDriveSearchFilters,
  getSizeRangeFilter,
  getUpdatedFromFilter,
  hasActiveDriveSearchFilters,
  sortDriveItems,
  type DriveSearchFilters,
  type DriveSortBy,
  type DriveSortDirection,
} from "./drive-search-model";
import { withShareFlags } from "./drive-workbench-helpers";

const searchPageSize = 100;

type UseDriveSearchOptions = {
  activeNav: DriveUserNav;
  allKnownItems: DriveItem[];
  archivedItems: DriveItem[];
  currentFolderId: string | null;
  currentFolderName?: string;
  currentSpaceRootLabel: string;
  driveItems: DriveItem[];
  getApiFeedback: (error: unknown, fallbackKey?: string, scope?: "form" | "global" | "share") => string;
  registeredSharesRef: MutableRefObject<RegisteredShare[]>;
  searchEnabled: boolean;
  spaceScope: DriveSpaceScope;
  workspaceId: string | null;
};

export function useDriveSearch({
  activeNav,
  allKnownItems,
  archivedItems,
  currentFolderId,
  currentFolderName,
  currentSpaceRootLabel,
  driveItems,
  getApiFeedback,
  registeredSharesRef,
  searchEnabled,
  spaceScope,
  workspaceId,
}: UseDriveSearchOptions) {
  const t = useTranslations();
  const [filtersActive, setFiltersActive] = useState(false);
  const [searchFilters, setSearchFilters] = useState<DriveSearchFilters>(defaultDriveSearchFilters);
  const [searchItems, setSearchItems] = useState<DriveItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResultKey, setSearchResultKey] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchCursor, setSearchCursor] = useState({ key: "", offset: 0 });
  const [searchRetryVersion, setSearchRetryVersion] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [query, setQuery] = useState("");

  const hasSearchFilters = useMemo(() => hasActiveDriveSearchFilters(searchFilters), [searchFilters]);
  const serverSearchActive = Boolean(workspaceId && searchEnabled && (query.trim().length > 0 || hasSearchFilters));
  const searchContextParentNodeId = searchFilters.state === "context" && activeNav === "drive"
    ? currentFolderId
    : undefined;
  const searchRequestKey = useMemo(() => JSON.stringify({
    activeNavForView: activeNav,
    filters: searchFilters,
    parentNodeId: searchContextParentNodeId ?? null,
    query: query.trim(),
    spaceScope,
    workspaceId,
  }), [activeNav, query, searchContextParentNodeId, searchFilters, spaceScope, workspaceId]);
  const searchOffset = searchCursor.key === searchRequestKey ? searchCursor.offset : 0;
  const searchCanLoadMore = serverSearchActive && searchResultKey === searchRequestKey && !searchLoading && searchItems.length < searchTotal;
  const searchLoadingMore = searchLoading && searchOffset > 0;
  const fileModuleSourceItems = useMemo(() => {
    if (!serverSearchActive) return allKnownItems;
    const searchIds = new Set(searchItems.map((item) => item.id));
    return [...searchItems, ...allKnownItems.filter((item) => !searchIds.has(item.id))];
  }, [allKnownItems, searchItems, serverSearchActive]);
  const filteredFiles = useMemo(() => {
    const sortForView = (items: DriveItem[]) => sortDriveItems(items, searchFilters);
    if (serverSearchActive) {
      let scope = searchItems;
      if (activeNav === "starred") scope = scope.filter((item) => item.starred);
      return sortForView(scope);
    }
    if (activeNav === "shared") return sortForView(driveItems.filter((item) => item.shared));
    if (activeNav === "starred") return sortForView(driveItems.filter((item) => item.starred));
    if (activeNav === "recent") return sortForView(driveItems);
    if (activeNav === "trash") return sortForView(archivedItems);
    return sortForView(getChildItems(currentFolderId, driveItems));
  }, [activeNav, archivedItems, currentFolderId, driveItems, searchFilters, searchItems, serverSearchActive]);
  const searchScopeLabel = useMemo(() => {
    if (activeNav === "drive") return currentFolderName ?? currentSpaceRootLabel;
    if (activeNav === "settings") return t("app.settings");
    return t(`nav.${activeNav}`);
  }, [activeNav, currentFolderName, currentSpaceRootLabel, t]);

  useEffect(() => {
    if (!serverSearchActive || !workspaceId) {
      const clearTimer = window.setTimeout(() => {
        setSearchItems([]);
        setSearchError(null);
        setSearchResultKey("");
        setSearchTotal(0);
        setSearchLoading(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const state = searchFilters.state === "context"
        ? activeNav === "trash" ? "archived" : "active"
        : searchFilters.state;
      const shared = activeNav === "shared" ? "shared" : searchFilters.shared;
      const createdFrom = getUpdatedFromFilter(searchFilters.created);
      const updatedFrom = getUpdatedFromFilter(searchFilters.updated);
      const sizeRange = getSizeRangeFilter(searchFilters.size);

      setSearchLoading(true);
      setSearchError(null);
      void searchFileNodes({
        workspaceId,
        query: query.trim() || undefined,
        state,
        shared,
        ...(searchContextParentNodeId !== undefined ? { parentNodeId: searchContextParentNodeId } : {}),
        spaceScope,
        ...(searchFilters.type !== "all" ? { type: searchFilters.type } : {}),
        ...(createdFrom ? { createdFrom } : {}),
        ...(updatedFrom ? { updatedFrom } : {}),
        ...sizeRange,
        sortBy: activeNav === "recent" ? "updatedAt" : searchFilters.sortBy,
        sortDirection: activeNav === "recent" ? "desc" : searchFilters.sortDirection,
        limit: searchPageSize,
        offset: searchOffset,
      }).then((result) => {
        if (cancelled) return;
        const nextItems = withShareFlags(result.items.map(mapFileNodeToDriveItem), registeredSharesRef.current);
        setSearchItems((current) => {
          if (searchOffset === 0) return nextItems;
          const currentIds = new Set(current.map((item) => item.id));
          return [...current, ...nextItems.filter((item) => !currentIds.has(item.id))];
        });
        setSearchTotal(result.total);
        setSearchResultKey(searchRequestKey);
        setSearchError(null);
      }).catch((error) => {
        if (cancelled) return;
        setSearchError(getApiFeedback(error, "files.loadFailed"));
      }).finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeNav, getApiFeedback, query, registeredSharesRef, searchContextParentNodeId, searchFilters, searchOffset, searchRequestKey, searchRetryVersion, serverSearchActive, spaceScope, workspaceId]);

  const applyDriveSort = (sortBy: DriveSortBy, sortDirection: DriveSortDirection) => {
    setSearchFilters((filters) => ({
      ...filters,
      sortBy,
      sortDirection: filters.sortBy === sortBy
        ? filters.sortDirection === "asc" ? "desc" : "asc"
        : sortDirection,
    }));
  };
  const clearSearchFilters = () => {
    setSearchFilters(defaultDriveSearchFilters);
    setFiltersActive(false);
  };
  const loadMoreSearchResults = () => {
    setSearchCursor((cursor) => ({
      key: searchRequestKey,
      offset: (cursor.key === searchRequestKey ? cursor.offset : 0) + searchPageSize,
    }));
  };
  const resetSearchResults = () => {
    setSearchItems([]);
    setSearchResultKey("");
    setSearchTotal(0);
    setSearchCursor({ key: "", offset: 0 });
  };
  const retrySearch = () => setSearchRetryVersion((version) => version + 1);

  return {
    applyDriveSort,
    clearSearchFilters,
    fileModuleSourceItems,
    filteredFiles,
    filtersActive,
    hasSearchFilters,
    loadMoreSearchResults,
    query,
    resetSearchResults,
    retrySearch,
    searchCanLoadMore,
    searchError,
    searchFilters,
    searchLoading,
    searchLoadingMore,
    searchScopeLabel,
    searchTotal,
    serverSearchActive,
    setQuery,
    setSearchFilters,
    toggleFilters: () => setFiltersActive((value) => !value),
  };
}
