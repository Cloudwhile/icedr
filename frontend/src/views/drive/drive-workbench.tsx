"use client";

import { usePathname, useRouter } from "@/compat/navigation";
import { isAdminUser } from "@/features/auth/permissions";
import { useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { showAppToast } from "@/components/ui/app-toast-store";
import { showWorkspaceNotification, type WorkspaceNotificationTone } from "@/components/ui/workspace-notification-store";
import { WorkspaceNotificationStack } from "@/components/ui/workspace-notifications";
import { DriveFilePreviewDialog } from "@/components/ui/drive-file-preview-dialog";
import { FileOpenWithDialog } from "@/components/ui/file-open-with-dialog";
import { DriveUploadHud } from "@/components/ui/drive-upload-hud";
import { UploadConflictDialog } from "@/components/ui/upload-conflict-dialog";
import { AppLoading, LdrsLoadingState, WorkspaceSkeleton } from "@/components/common/ui/loading-state";
import { findDriveItem, getChildItems, getFolderPath, getItemKind, type DriveItem, type DriveUserNav, type LanguageOption, type Locale, type Palette, type ThemeMode, type ThemePreference } from "@/features/file/model";
import { copyTextToClipboard, createPreviewUrl, createShareUrl, createUploadDriveFileTask, downloadWorkspaceDriveItem, downloadWorkspaceDriveItems, isUploadDriveFileControlError, type UploadConflictStrategy, type UploadDriveFileProgress, type UploadDriveFileTask } from "@/features/file/actions";
import { getDriveFileNameConflictKey, getDriveFileNameErrorMessageKey, validateDriveFileName } from "@/features/file/file-name-policy";
import { createGeneratedFileTemplate, type GeneratedFileKind } from "@/features/file/generated-files";
import { canOpenFilePreview, getDefaultFileOpenWith, getFileOpenWithOptions, getFileOpenWithStorageKey, type FileOpenWithApp } from "@/features/file/open-with";
import { batchArchiveFileNodes, batchMoveFileNodes, batchRestoreFileNodes, clearStoredAuthToken, copyFileNode, createFolderNode, defaultPublicSiteSettings, deleteTransfer, DriveApiError, fetchFileNode, fetchFileNodesByState, fetchPublicSiteSettings, fetchStorageUsage, fetchTransfers, fetchWorkspaces, fetchWorkspaceShareSettings, getDriveApiErrorMessage, isAuthExpiredApiError, logoutLocalUser, moveFileNode, permanentlyDeleteFileNode, renameFileNode, resolvePublicSiteName, restoreFileNode, searchFileNodes, updateFileNodeState, type AuthUser, type DriveSpaceScope, type FileNodeResponse, type PublicSiteSettings, type StorageUsage, type WorkspaceResponse, type WorkspaceShareSettings } from "@/lib/drive-api";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { DriveShareDialog } from "./drive-share-dialog";
import { LegalFooter } from "./legal-footer";
import { fetchRegisteredSharesForWorkspace, revokeRegisteredShare, type RegisteredShare } from "@/features/share/registry";
import type { TransferRow, UploadTelemetry } from "./drive-types";
import { DetailsPanel } from "./drive-details-panel";
import { AppHeader, Sidebar, WorkspaceBar } from "./drive-layout";
import type { AppMenuItem } from "@/components/ui/app-menu";
import { FilesModule } from "./drive-files";
import { LinksModule } from "./drive-modules";
import { TransfersModule } from "./drive-transfers";
import { LocalIcon } from "./drive-primitives";
import { DriveSettingsWorkspace } from "./drive-settings";
import { DriveFilterPanel } from "./drive-search";
import { defaultDriveSearchFilters, getSizeRangeFilter, getUpdatedFromFilter, hasActiveDriveSearchFilters, sortDriveItems, type DriveSearchFilters, type DriveSortBy, type DriveSortDirection } from "./drive-search-model";

function HiddenFileInput({
  inputRef,
  onChange
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const t = useTranslations();
  return <input ref={inputRef} type="file" multiple title={t("app.upload")} aria-label={t("app.upload")} onChange={onChange} style={{
    display: "none"
  }} />;
}
function withShareFlags(items: DriveItem[], shares: RegisteredShare[]) {
  const activeSharedIds = new Set(shares.filter(share => share.status !== "revoked" && !share.revokedAt && share.status !== "expired").flatMap(share => [...share.rootItemIds, ...share.allowedItemIds]));
  return items.map(item => ({
    ...item,
    shared: activeSharedIds.has(item.id)
  }));
}
function mergeTransferRows(rows: TransferRow[], telemetryRows: UploadTelemetry[]) {
  const merged = new Map<string, TransferRow>();
  rows.forEach(row => merged.set(row.id, row));
  telemetryRows.forEach(telemetry => {
    const existing = merged.get(telemetry.id);
    merged.set(telemetry.id, {
      ...existing,
      ...telemetry,
      createdAt: existing?.createdAt ?? telemetry.createdAt
    });
  });
  return Array.from(merged.values()).sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function getRememberedFileOpenWith(item: DriveItem) {
  if (typeof window === "undefined") return null;
  const remembered = window.localStorage.getItem(getFileOpenWithStorageKey(item));
  if (!remembered) return null;
  return getFileOpenWithOptions(item).some((option) => option.value === remembered)
    ? remembered as FileOpenWithApp
    : null;
}

function getPreviewOpenWith(item: DriveItem) {
  return getRememberedFileOpenWith(item) ?? getDefaultFileOpenWith(item);
}

function createUniqueDriveName(defaultName: string, siblingItems: DriveItem[]) {
  const existingNames = new Set(siblingItems.map(item => item.name.toLocaleLowerCase()));
  if (!existingNames.has(defaultName.toLocaleLowerCase())) return defaultName;

  const { baseName, extension } = splitNameForDuplicate(defaultName);
  let index = 2;
  let candidate = `${baseName} (${index})${extension}`;
  while (existingNames.has(candidate.toLocaleLowerCase())) {
    index += 1;
    candidate = `${baseName} (${index})${extension}`;
  }
  return candidate;
}

function splitNameForDuplicate(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return { baseName: name, extension: "" };
  return {
    baseName: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  };
}

type UploadTaskMeta = {
  onCompleted: (createdNode: FileNodeResponse) => void;
  onFailed?: (error: unknown) => void;
};
type UploadConflictPromptState = {
  conflictCount: number;
  fileNames: string[];
};

function getNameExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLocaleLowerCase();
}

function formatExtensionLabel(extension: string, emptyLabel: string) {
  return extension ? `.${extension}` : emptyLabel;
}

function createLocalUploadTransferId(counter: number) {
  return `local-upload-${Date.now()}-${counter}`;
}

function isLocalUploadTransferId(id: string) {
  return id.startsWith("local-upload-");
}

function isFolderWithinItems(folderId: string, items: DriveItem[], sourceItems: DriveItem[]) {
  const blockedIds = new Set(items.filter((item) => getItemKind(item) === "folder").map((item) => item.id));
  if (blockedIds.has(folderId)) return true;
  let current = findDriveItem(folderId, sourceItems);
  while (current?.parentId) {
    if (blockedIds.has(current.parentId)) return true;
    current = findDriveItem(current.parentId, sourceItems);
  }
  return false;
}

function getPendingUploadBytes(rows: UploadTelemetry[], spaceScope: DriveSpaceScope) {
  return rows.reduce((total, row) => (
    (row.spaceScope ?? "workspace") === spaceScope &&
    (row.status === "queued" || row.status === "running" || row.status === "paused")
      ? total + Math.max(0, row.totalBytes)
      : total
  ), 0);
}

function hasUploadStorageCapacity(usage: StorageUsage | null, pendingBytes: number, incomingBytes: number) {
  const quotaBytes = usage?.quotaBytes;
  if (!quotaBytes || quotaBytes <= 0) return true;
  return usage.usedBytes + pendingBytes + Math.max(0, incomingBytes) <= quotaBytes;
}

function isStorageCapacityError(error: unknown) {
  if (!(error instanceof DriveApiError)) return false;
  const message = error.message.toLocaleLowerCase();
  return (
    error.status === 400 &&
    (message.includes("quota") ||
      message.includes("storage") ||
      message.includes("space") ||
      message.includes("配额") ||
      message.includes("空间"))
  );
}

function localizeWorkspaceName(workspace: WorkspaceResponse | undefined, t: ReturnType<typeof useTranslations>) {
  if (!workspace) return t("app.workspaceSpace");
  if (workspace.id === "workspace-default" || workspace.name === "Default Workspace") return t("app.defaultWorkspace");
  return workspace.name;
}

function isThemePreferenceValue(value: string | null | undefined): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

function isTimeZonePreferenceValue(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value === "system") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

type DriveWorkspaceModule = "drive" | "links" | "transfers" | "settings";
type DriveClipboardMode = "copy" | "move";
type DriveClipboardState = {
  items: DriveItem[];
  mode: DriveClipboardMode;
  spaceScope: DriveSpaceScope;
  workspaceId: string | null;
};

const driveNavPaths: Record<DriveUserNav, string> = {
  drive: "/",
  links: "/links",
  recent: "/recent",
  settings: "/settings",
  shared: "/shared",
  starred: "/starred",
  transfers: "/transfers",
  trash: "/trash",
};

const searchPageSize = 100;

function normalizeDrivePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function DriveWorkbench({
  currentUser,
  initialActiveNav,
  initialPreviewItemId,
  languageOptions,
  locale,
  palette,
  setLocale,
  setThemePreference,
  setTimeZonePreference,
  themeMode,
  themePreference,
  timeZone,
  timeZonePreference
}: {
  currentUser: AuthUser | null;
  initialPreviewItemId?: string | null;
  languageOptions: LanguageOption[];
  locale: Locale;
  palette: Palette;
  setLocale: React.Dispatch<React.SetStateAction<Locale>>;
  setThemePreference: React.Dispatch<React.SetStateAction<ThemePreference>>;
  setTimeZonePreference: React.Dispatch<React.SetStateAction<string>>;
  themeMode: ThemeMode;
  themePreference: ThemePreference;
  timeZone: string;
  timeZonePreference: string;
  initialActiveNav?: DriveUserNav;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const activeNav = initialActiveNav ?? "drive";
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<DriveItem[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [spaceScope, setSpaceScope] = useState<DriveSpaceScope>("workspace");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [registeredShares, setRegisteredShares] = useState<RegisteredShare[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [filtersActive, setFiltersActive] = useState(false);
  const [searchFilters, setSearchFilters] = useState<DriveSearchFilters>(defaultDriveSearchFilters);
  const [searchItems, setSearchItems] = useState<DriveItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchCursor, setSearchCursor] = useState({ key: "", offset: 0 });
  const [searchTotal, setSearchTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{ itemId: string; openWith: FileOpenWithApp | null } | null>(null);
  const [openWithDialogItem, setOpenWithDialogItem] = useState<DriveItem | null>(null);
  const [transferRows, setTransferRows] = useState<TransferRow[]>([]);
  const [uploadTelemetry, setUploadTelemetry] = useState<Record<string, UploadTelemetry>>({});
  const [controllableTransferIds, setControllableTransferIds] = useState<string[]>([]);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootLoadingStage, setBootLoadingStage] = useState<"progress" | "blocking" | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [profileUserOverride, setProfileUserOverride] = useState<AuthUser | null>(null);
  const [driveClipboard, setDriveClipboard] = useState<DriveClipboardState | null>(null);
  const [shareSettings, setShareSettings] = useState<WorkspaceShareSettings | null>(null);
  const [shareSettingsError, setShareSettingsError] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
  const [uploadConflictPrompt, setUploadConflictPrompt] = useState<UploadConflictPromptState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadConflictResolverRef = useRef<((strategy: UploadConflictStrategy | null) => void) | null>(null);
  const uploadDraftCounterRef = useRef(0);
  const unmountedRef = useRef(false);
  const uploadTaskMetaRef = useRef(new Map<string, UploadTaskMeta>());
  const uploadTasksRef = useRef(new Map<string, UploadDriveFileTask>());
  const workspaceTimerRef = useRef<number | null>(null);
  const bootLoadingStartedRef = useRef(0);
  const initialPreviewOpenedRef = useRef(false);
  const workspaceIdRef = useRef<string | null>(null);
  const spaceScopeRef = useRef<DriveSpaceScope>("workspace");
  const registeredSharesRef = useRef<RegisteredShare[]>([]);
  const activeUser = profileUserOverride?.id === currentUser?.id ? profileUserOverride : currentUser;
  const activeUserId = activeUser?.id;
  const activateNav = useCallback((nextNav: DriveUserNav, navigation: "push" | "replace" = "push") => {
    const nextPath = driveNavPaths[nextNav] ?? "/";
    if (nextNav !== "drive") setCurrentFolderId(null);
    if (normalizeDrivePathname(pathname) === nextPath) return;
    if (navigation === "replace") {
      router.replace(nextPath);
      return;
    }
    router.push(nextPath);
  }, [pathname, router]);
  const activeUserLocale = activeUser?.locale;
  const activeUserTheme = activeUser?.theme;
  const activeUserTimeZone = activeUser?.timezone;
  const uploadActor = activeUser?.displayName || activeUser?.email || undefined;
  const brandLogo = siteSettings.authLogoDataUrl || "/logo.png";
  const currentWorkspace = workspaces.find(workspace => workspace.id === workspaceId);
  const currentWorkspaceName = localizeWorkspaceName(currentWorkspace, t);
  const currentSpaceRootLabel = spaceScope === "personal" ? t("nav.drive") : t("app.workspaceSpace");
  const allKnownItems = useMemo(() => [...driveItems, ...archivedItems], [archivedItems, driveItems]);
  const selectedItems = useMemo(() => allKnownItems.filter(item => selected.includes(item.id)), [allKnownItems, selected]);
  const activeItem = selectedItems[0];
  const focusedItem = focusedItemId ? findDriveItem(focusedItemId, allKnownItems) : undefined;
  const previewItem = previewState?.itemId ? findDriveItem(previewState.itemId, allKnownItems) : undefined;
  const folderPath = useMemo(() => getFolderPath(currentFolderId, allKnownItems), [allKnownItems, currentFolderId]);
  const currentFolder = folderPath.at(-1);
  const currentDirectoryItems = useMemo(() => getChildItems(currentFolderId, driveItems), [currentFolderId, driveItems]);
  const linkRows = useMemo(() => registeredShares.filter(share => share.status !== "revoked" && !share.revokedAt), [registeredShares]);
  const visibleTransferRows = useMemo(() => mergeTransferRows(transferRows, Object.values(uploadTelemetry)), [transferRows, uploadTelemetry]);
  const requestedModule: DriveWorkspaceModule = ["links", "transfers", "settings"].includes(activeNav) ? activeNav as DriveWorkspaceModule : "drive";
  const activeModule: DriveWorkspaceModule = requestedModule;
  const activeNavForView = activeModule === requestedModule ? activeNav : "drive";
  const canPasteClipboard = useMemo(() => {
    if (!driveClipboard || activeNavForView !== "drive") return false;
    if (driveClipboard.workspaceId !== workspaceId || driveClipboard.spaceScope !== spaceScope) return false;
    if (currentFolderId && isFolderWithinItems(currentFolderId, driveClipboard.items, driveItems)) return false;
    if (driveClipboard.mode === "move" && driveClipboard.items.every((item) => item.parentId === currentFolderId)) return false;
    return driveClipboard.items.length > 0;
  }, [activeNavForView, currentFolderId, driveClipboard, driveItems, spaceScope, workspaceId]);
  const detailsTargetAvailable = Boolean(focusedItem || selectedItems.length > 0 || currentFolder);
  const showDetailsPanel = detailsOpen && activeModule !== "settings" && detailsTargetAvailable;
  const workspaceRefreshLoading = workspaceLoading || bootLoading;
  const showSettingsSkeleton = workspaceRefreshLoading && activeModule === "settings";
  const showWorkspaceLoader = workspaceRefreshLoading && activeModule !== "settings";
  const workspaceBusy = showSettingsSkeleton || showWorkspaceLoader;
  const hasSearchFilters = useMemo(() => hasActiveDriveSearchFilters(searchFilters), [searchFilters]);
  const serverSearchActive = Boolean(workspaceId && activeModule === "drive" && (query.trim().length > 0 || hasSearchFilters));
  const searchContextParentNodeId =
    searchFilters.state === "context" && activeNavForView === "drive"
      ? currentFolderId
      : undefined;
  const searchRequestKey = useMemo(() => JSON.stringify({
    activeNavForView,
    filters: searchFilters,
    parentNodeId: searchContextParentNodeId ?? null,
    query: query.trim(),
    spaceScope,
    workspaceId,
  }), [activeNavForView, query, searchContextParentNodeId, searchFilters, spaceScope, workspaceId]);
  const searchOffset = searchCursor.key === searchRequestKey ? searchCursor.offset : 0;
  const searchCanLoadMore = serverSearchActive && searchItems.length < searchTotal;
  const searchLoadingMore = searchLoading && searchOffset > 0;
  const fileModuleSourceItems = useMemo(() => {
    if (!serverSearchActive) return allKnownItems;
    const searchIds = new Set(searchItems.map((item) => item.id));
    return [...searchItems, ...allKnownItems.filter((item) => !searchIds.has(item.id))];
  }, [allKnownItems, searchItems, serverSearchActive]);
  const getApiFeedback = useCallback((
    error: unknown,
    fallbackKey = "errors.unknown",
    scope: "form" | "global" | "share" = "global",
  ) => {
    if (isAuthExpiredApiError(error)) clearStoredAuthToken();
    return getDriveApiErrorMessage(error, t, { fallbackKey, scope });
  }, [t]);

  useEffect(() => {
    if (!activeUserId) return;
    if (activeUserLocale) setLocale(activeUserLocale);
    if (isThemePreferenceValue(activeUserTheme)) setThemePreference(activeUserTheme);
    if (isTimeZonePreferenceValue(activeUserTimeZone)) setTimeZonePreference(activeUserTimeZone);
  }, [activeUserId, activeUserLocale, activeUserTheme, activeUserTimeZone, setLocale, setThemePreference, setTimeZonePreference]);

  const filteredFiles = useMemo(() => {
    const sortForView = (items: DriveItem[]) => sortDriveItems(items, searchFilters);
    if (serverSearchActive) {
      let scope = searchItems;
      if (activeNavForView === "starred") scope = scope.filter(item => item.starred);
      return sortForView(scope);
    }
    if (activeNavForView === "shared") return sortForView(driveItems.filter(item => item.shared));
    if (activeNavForView === "starred") return sortForView(driveItems.filter(item => item.starred));
    if (activeNavForView === "recent") return sortForView(driveItems);
    if (activeNavForView === "trash") return sortForView(archivedItems);
    return sortForView(getChildItems(currentFolderId, driveItems));
  }, [activeNavForView, archivedItems, currentFolderId, driveItems, searchFilters, searchItems, serverSearchActive]);
  const searchScopeLabel = useMemo(() => {
    if (activeNavForView === "drive") return currentFolder?.name ?? currentSpaceRootLabel;
    if (activeNavForView === "settings") return t("app.settings");
    return t(`nav.${activeNavForView}`);
  }, [activeNavForView, currentFolder?.name, currentSpaceRootLabel, t]);
  useEffect(() => {
    if (!serverSearchActive || !workspaceId) {
      const clearTimer = window.setTimeout(() => {
        setSearchItems([]);
        setSearchTotal(0);
        setSearchLoading(false);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (searchOffset === 0) {
        setSearchItems([]);
        setSearchTotal(0);
      }
      const state = searchFilters.state === "context"
        ? activeNavForView === "trash"
          ? "archived"
          : "active"
        : searchFilters.state;
      const shared = activeNavForView === "shared" ? "shared" : searchFilters.shared;
      const createdFrom = getUpdatedFromFilter(searchFilters.created);
      const updatedFrom = getUpdatedFromFilter(searchFilters.updated);
      const sizeRange = getSizeRangeFilter(searchFilters.size);

      setSearchLoading(true);
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
        sortBy: activeNavForView === "recent" ? "updatedAt" : searchFilters.sortBy,
        sortDirection: activeNavForView === "recent" ? "desc" : searchFilters.sortDirection,
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
        setFilesError(null);
      }).catch((error) => {
        if (cancelled) return;
        if (searchOffset === 0) setSearchItems([]);
        setFilesError(getApiFeedback(error, "files.loadFailed"));
      }).finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeNavForView, getApiFeedback, query, searchContextParentNodeId, searchFilters, searchOffset, serverSearchActive, spaceScope, workspaceId]);
  useEffect(() => {
    const uploadTasks = uploadTasksRef.current;
    const uploadTaskMeta = uploadTaskMetaRef.current;
    return () => {
      unmountedRef.current = true;
      uploadConflictResolverRef.current?.(null);
      uploadConflictResolverRef.current = null;
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      uploadTasks.forEach(task => task.cancel());
      uploadTasks.clear();
      uploadTaskMeta.clear();
    };
  }, []);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);
  useEffect(() => {
    spaceScopeRef.current = spaceScope;
  }, [spaceScope]);
  useEffect(() => {
    registeredSharesRef.current = registeredShares;
  }, [registeredShares]);
  useEffect(() => {
    if (!initialPreviewItemId || initialPreviewOpenedRef.current || bootLoading) return;
    let cancelled = false;
    initialPreviewOpenedRef.current = true;

    const openInitialPreview = async () => {
      const knownItem = findDriveItem(initialPreviewItemId, allKnownItems);
      const targetItem = knownItem ?? await fetchFileNode(initialPreviewItemId)
        .then(mapFileNodeToDriveItem)
        .catch(() => null);

      if (cancelled) return;

      if (!targetItem) {
        showAppToast({
          description: t("preview.missingHint"),
          dedupeKey: `preview-missing-${initialPreviewItemId}`,
          title: t("preview.missing"),
          tone: "error",
        });
        router.replace("/");
        return;
      }

      setDetailsOpen(false);
      setFocusedItemId(null);
      setSelected([targetItem.id]);

      if (!canOpenFilePreview(targetItem)) {
        showAppToast({
          dedupeKey: `preview-no-artifact-${targetItem.id}`,
          title: t("preview.noArtifact"),
          tone: "info",
        });
        router.replace("/");
        return;
      }

      setPreviewState({
        itemId: targetItem.id,
        openWith: getPreviewOpenWith(targetItem),
      });
    };

    void openInitialPreview();

    return () => {
      cancelled = true;
    };
  }, [allKnownItems, bootLoading, initialPreviewItemId, router, t]);
  useEffect(() => {
    let cancelled = false;
    void fetchPublicSiteSettings().then(settings => {
      if (!cancelled) setSiteSettings(settings);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const refreshWorkspaceList = useCallback(async () => {
    const nextWorkspaces = await fetchWorkspaces();
    const nextWorkspaceId = nextWorkspaces[0]?.id ?? null;
    const resolvedWorkspaceId = workspaceIdRef.current ?? nextWorkspaceId;
    workspaceIdRef.current = resolvedWorkspaceId;
    setWorkspaces(nextWorkspaces);
    setWorkspaceId(current => current ?? nextWorkspaceId);
    return resolvedWorkspaceId;
  }, []);
  const refreshDriveItems = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    shares = registeredSharesRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return;
    try {
      const [activeNodes, archivedNodes] = await Promise.all([fetchFileNodesByState({
        workspaceId: targetWorkspaceId,
        spaceScope: targetSpaceScope,
        state: "active"
      }), fetchFileNodesByState({
        workspaceId: targetWorkspaceId,
        spaceScope: targetSpaceScope,
        state: "archived"
      })]);
      setDriveItems(withShareFlags(activeNodes.map(mapFileNodeToDriveItem), shares));
      setArchivedItems(withShareFlags(archivedNodes.map(mapFileNodeToDriveItem), shares));
      setFilesError(null);
    } catch (error) {
      setDriveItems([]);
      setArchivedItems([]);
      setFilesError(getApiFeedback(error, "files.loadFailed"));
    }
  }, [getApiFeedback]);
  const refreshShares = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return [] as RegisteredShare[];
    try {
      const shares = await fetchRegisteredSharesForWorkspace(targetWorkspaceId);
      registeredSharesRef.current = shares;
      setRegisteredShares(shares);
      setLinksError(null);
      setDriveItems(current => withShareFlags(current, shares));
      setArchivedItems(current => withShareFlags(current, shares));
      return shares;
    } catch (error) {
      registeredSharesRef.current = [];
      setRegisteredShares([]);
      setLinksError(getApiFeedback(error, "share.apiUnavailable"));
      return [] as RegisteredShare[];
    }
  }, [getApiFeedback]);
  const refreshShareSettings = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return;
    try {
      const settings = await fetchWorkspaceShareSettings(targetWorkspaceId);
      setShareSettings(settings);
      setShareSettingsError(null);
    } catch (error) {
      setShareSettings(null);
      setShareSettingsError(getApiFeedback(error, "admin.loadFailed"));
    }
  }, [getApiFeedback]);
  const refreshTransfers = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return;
    try {
      setTransferRows(await fetchTransfers({
        workspaceId: targetWorkspaceId,
        limit: 100
      }));
    } catch {
      setTransferRows([]);
    }
  }, []);
  const refreshStorageUsage = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return;
    try {
      setStorageUsage(await fetchStorageUsage(targetWorkspaceId, targetSpaceScope));
    } catch {
      setStorageUsage(null);
    }
  }, []);
  const fetchLatestStorageUsage = useCallback(async (
    targetWorkspaceId = workspaceIdRef.current,
    targetSpaceScope = spaceScopeRef.current,
  ) => {
    if (!targetWorkspaceId) return null;
    try {
      const usage = await fetchStorageUsage(targetWorkspaceId, targetSpaceScope);
      setStorageUsage(usage);
      return usage;
    } catch {
      return storageUsage?.workspaceId === targetWorkspaceId &&
        storageUsage.spaceScope === targetSpaceScope
        ? storageUsage
        : null;
    }
  }, [storageUsage]);
  useEffect(() => {
    let cancelled = false;
    const progressTimer = window.setTimeout(() => {
      if (!cancelled) setBootLoadingStage("progress");
    }, 150);
    const blockingTimer = window.setTimeout(() => {
      if (!cancelled) setBootLoadingStage("blocking");
    }, 320);
    window.queueMicrotask(() => {
      bootLoadingStartedRef.current = window.performance.now();
      void refreshWorkspaceList().then(async initialWorkspaceId => {
        if (!initialWorkspaceId) return;
        const shares = await refreshShares(initialWorkspaceId);
        await Promise.all([refreshDriveItems(initialWorkspaceId, shares), refreshShareSettings(initialWorkspaceId), refreshTransfers(initialWorkspaceId), refreshStorageUsage(initialWorkspaceId)]);
      }).finally(() => {
        const elapsed = window.performance.now() - bootLoadingStartedRef.current;
        const remaining = Math.max(0, 220 - elapsed);
        window.setTimeout(() => {
          if (!cancelled) {
            setBootLoading(false);
            setBootLoadingStage(null);
          }
        }, remaining);
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(progressTimer);
      window.clearTimeout(blockingTimer);
    };
  }, [refreshDriveItems, refreshShareSettings, refreshShares, refreshStorageUsage, refreshTransfers, refreshWorkspaceList]);
  const queueWorkspaceLoading = () => {
    if (bootLoading) return;
    if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
    setWorkspaceLoading(true);
    workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
  };
  const showFeedback = useCallback((message: string, tone: WorkspaceNotificationTone = "success") => {
    showWorkspaceNotification({
      title: message,
      tone,
    });
  }, []);
  const showStorageInsufficient = useCallback(() => {
    showWorkspaceNotification({
      dedupeKey: "upload-storage-insufficient",
      debounceMs: 1600,
      title: t("app.insufficientStorage"),
      tone: "error",
    });
  }, [t]);
  const requestUploadConflictStrategy = useCallback((conflictingFiles: File[]) => {
    uploadConflictResolverRef.current?.(null);
    return new Promise<UploadConflictStrategy | null>((resolve) => {
      uploadConflictResolverRef.current = resolve;
      setUploadConflictPrompt({
        conflictCount: conflictingFiles.length,
        fileNames: [...new Set(conflictingFiles.map((file) => file.name))],
      });
    });
  }, []);
  const resolveUploadConflictPrompt = useCallback((strategy: UploadConflictStrategy | null) => {
    const resolver = uploadConflictResolverRef.current;
    uploadConflictResolverRef.current = null;
    setUploadConflictPrompt(null);
    resolver?.(strategy);
  }, []);
  const getConflictingUploadFiles = useCallback((files: File[]) => {
    const siblingKeys = new Set(currentDirectoryItems.map((item) => getDriveFileNameConflictKey(item.name)));
    return files.filter((file) => siblingKeys.has(getDriveFileNameConflictKey(file.name)));
  }, [currentDirectoryItems]);
  const showBatchResult = useCallback((
    summary: { failed: number; requested: number; succeeded: number },
    failed: Array<{ id: string; message: string }> = [],
  ) => {
    showWorkspaceNotification({
      description: failed.length > 0
        ? failed.slice(0, 6).map((item) => `${item.id}: ${item.message}`).join("\n")
        : undefined,
      title: t("files.batchResult", {
        failed: summary.failed,
        requested: summary.requested,
        succeeded: summary.succeeded,
      }),
      tone: summary.failed > 0 ? "neutral" : "success",
    });
  }, [t]);
  const getActionItems = (items: DriveItem[]) => items.length > 0 ? items : activeItem ? [activeItem] : [];
  const copyItemsLink = async (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    await copyTextToClipboard(actionItems.map(item => createPreviewUrl(item.id)).join("\n"));
    showFeedback(t("app.copied"));
  };
  const downloadItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    if (actionItems.length > 1) {
      void downloadWorkspaceDriveItems(actionItems).then((result) => {
        showBatchResult(result.summary, result.failed);
      }).catch((error) => showFeedback(getApiFeedback(error, "share.downloadFailed"), "error"));
      return;
    }
    void downloadWorkspaceDriveItem(actionItems[0], workspaceId ?? undefined).then(() => {
      showFeedback(t("app.downloaded"));
    }).catch((error) => showFeedback(getApiFeedback(error, "share.downloadFailed"), "error"));
  };
  const archiveItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    const archiveAction = actionItems.length === 1
      ? updateFileNodeState(actionItems[0].id, { archived: true }).then((node) => ({
        failed: [],
        succeeded: [node],
        summary: { failed: 0, requested: 1, succeeded: 1 },
      }))
      : batchArchiveFileNodes(actionItems.map((item) => item.id));
    void archiveAction.then((result) => Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => result)).then((result) => {
      setSelected(current => current.filter(id => !result.succeeded.some(item => item.id === id)));
      if (actionItems.length === 1) {
        showFeedback(t("app.archived", { count: 1 }));
      } else {
        showBatchResult(result.summary, result.failed);
      }
    }).catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const restoreItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    const restoreAction = actionItems.length === 1
      ? restoreFileNode(actionItems[0].id).then((node) => ({
        failed: [],
        succeeded: [node],
        summary: { failed: 0, requested: 1, succeeded: 1 },
      }))
      : batchRestoreFileNodes(actionItems.map((item) => item.id));
    void restoreAction.then((result) => Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => result)).then((result) => {
      setSelected(current => current.filter(id => !result.succeeded.some(item => item.id === id)));
      if (actionItems.length === 1) showFeedback(t("app.refreshed"));
      else showBatchResult(result.summary, result.failed);
    }).catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const deletePermanentlyItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    void Promise.allSettled(actionItems.map((item) => permanentlyDeleteFileNode(item.id)))
      .then((results) => {
        const succeededIds = actionItems.filter((_, index) => results[index].status === "fulfilled").map((item) => item.id);
        const failed = actionItems
          .map((item, index) => ({ item, result: results[index] }))
          .filter((entry): entry is { item: DriveItem; result: PromiseRejectedResult } => entry.result.status === "rejected")
          .map(({ item, result }) => ({
            id: item.id,
            message: result.reason instanceof Error ? result.reason.message : t("app.uploadFailed"),
          }));
        return Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => ({
          failed: actionItems.length - succeededIds.length,
          failedItems: failed,
          requested: actionItems.length,
          succeeded: succeededIds.length,
          succeededIds,
        }));
      })
      .then((result) => {
        setSelected(current => current.filter(id => !result.succeededIds.includes(id)));
        showBatchResult(result, result.failedItems);
      })
      .catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const refreshWorkspace = () => {
    if (bootLoading) return;
    if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
    setWorkspaceLoading(true);
    void Promise.all([refreshDriveItems(), refreshShares(), refreshShareSettings(), refreshTransfers(), refreshStorageUsage()]).finally(() => {
      workspaceTimerRef.current = window.setTimeout(() => {
        setWorkspaceLoading(false);
        showFeedback(t("app.refreshed"));
      }, 180);
    });
  };
  const selectSpaceScope = (nextSpaceScope: DriveSpaceScope) => {
    if (nextSpaceScope === spaceScopeRef.current) return;
    spaceScopeRef.current = nextSpaceScope;
    setSpaceScope(nextSpaceScope);
    activateNav("drive");
    setCurrentFolderId(null);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
    setSidebarOpen(false);
    setSearchItems([]);
    setSearchTotal(0);
    setSearchCursor({ key: "", offset: 0 });
    setStorageUsage(null);
    queueWorkspaceLoading();
    void Promise.all([
      refreshDriveItems(workspaceIdRef.current, registeredSharesRef.current, nextSpaceScope),
      refreshStorageUsage(workspaceIdRef.current, nextSpaceScope),
    ]).finally(() => {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
    });
  };
  const toggleFilters = () => {
    setFiltersActive(value => !value);
  };
  const applyDriveSort = (sortBy: DriveSortBy, sortDirection: DriveSortDirection) => {
    setSearchFilters((filters) => ({
      ...filters,
      sortBy,
      sortDirection: filters.sortBy === sortBy ? (filters.sortDirection === "asc" ? "desc" : "asc") : sortDirection,
    }));
  };
  const openSearchResult = (item: DriveItem) => {
    setSelected([item.id]);
    setFocusedItemId(null);
    if (getItemKind(item) === "folder") {
      openFolder(item.id);
      return;
    }
    openPreview(item.id);
  };
  const openAdmin = () => {
    if (!isAdminUser(activeUser)) return;
    router.push("/admin");
  };
  const openTransfers = () => {
    if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
    setWorkspaceLoading(false);
    activateNav("transfers");
    setCurrentFolderId(null);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
    setSidebarOpen(false);
  };
  const closeShareLink = (id: string) => {
    void revokeRegisteredShare(id).then(() => refreshShares()).then(() => showFeedback(t("links.linkClosed"))).catch((error) => {
      const message = getApiFeedback(error, "links.closeFailed");
      setLinksError(message);
      showFeedback(message, "error");
    });
  };
  const copyShareLink = async (id: string) => {
    const link = linkRows.find(candidate => candidate.token === id);
    if (!link) return;
    await copyTextToClipboard(link.url ?? createShareUrl(link.token));
    showFeedback(t("app.copied"));
  };
  const toggleSelected = (id: string, checked: boolean) => {
    setFocusedItemId(null);
    setSelected(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
  };
  const clearSelection = () => {
    setSelected([]);
    setFocusedItemId(null);
  };
  const toggleStar = (id: string) => {
    const item = findDriveItem(id, allKnownItems);
    if (!item) return;
    void updateFileNodeState(id, {
      starred: !item.starred
    }).then(updatedNode => {
      const updatedItem = mapFileNodeToDriveItem(updatedNode);
      setDriveItems(current => withShareFlags(current.map(candidate => candidate.id === id ? updatedItem : candidate), registeredShares));
      setArchivedItems(current => withShareFlags(current.map(candidate => candidate.id === id ? updatedItem : candidate), registeredShares));
    }).catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error"));
  };
  const createFolder = () => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return;
    }
    const name = createUniqueDriveName(t("actions.newFolder"), currentDirectoryItems);
    activateNav("drive");
    queueWorkspaceLoading();
    void createFolderNode({
      name,
      owner: uploadActor,
      parentNodeId: currentFolderId,
      spaceScope,
      workspaceId
    }).then(createdNode => Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => createdNode)).then(createdNode => {
      setSelected([createdNode.id]);
      setFocusedItemId(null);
      setRenamingItemId(createdNode.id);
      showFeedback(t("app.folderCreated"));
    }).catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error")).finally(() => {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
    });
  };
  const syncControllableTransferIds = () => {
    setControllableTransferIds(Array.from(uploadTasksRef.current.keys()));
  };
  const registerUploadTask = (transferId: string, task: UploadDriveFileTask, meta: UploadTaskMeta) => {
    const alreadyRegistered = uploadTasksRef.current.has(transferId);
    uploadTasksRef.current.set(transferId, task);
    uploadTaskMetaRef.current.set(transferId, meta);
    if (!alreadyRegistered) syncControllableTransferIds();
  };
  const unregisterUploadTask = (transferId: string | null) => {
    if (!transferId) return;
    const removed = uploadTasksRef.current.delete(transferId);
    uploadTaskMetaRef.current.delete(transferId);
    if (removed) syncControllableTransferIds();
  };
  const replaceUploadDraft = (draftId: string, progress: UploadDriveFileProgress) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry(current => {
      const draft = current[draftId];
      const previous = current[progress.transferId] ?? draft;
      const next = { ...current };
      delete next[draftId];
      next[progress.transferId] = {
        ...previous,
        id: progress.transferId,
        spaceScope: previous?.spaceScope ?? spaceScopeRef.current,
        workspaceId: progress.workspaceId,
        nodeId: null,
        objectKey: null,
        name: progress.fileName,
        type: "upload",
        errorMessage: null,
        progress: progress.progress,
        status: progress.status,
        createdAt: previous?.createdAt ?? updatedAt,
        updatedAt,
        loadedBytes: progress.loadedBytes,
        totalBytes: progress.totalBytes,
        speedBytesPerSecond: progress.speedBytesPerSecond,
        remainingSeconds: progress.remainingSeconds
      };
      return next;
    });
  };
  const markUploadTelemetryStatus = (id: string, status: UploadTelemetry["status"], errorMessage?: string | null) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry(current => {
      const row = current[id];
      if (!row) return current;
      return {
        ...current,
        [id]: {
          ...row,
          status,
          updatedAt,
          errorMessage: errorMessage ?? (status === "failed" ? row.errorMessage ?? null : null),
          speedBytesPerSecond: null,
          remainingSeconds: null
        }
      };
    });
  };
  const removeUploadTelemetryRows = (...ids: Array<string | null | undefined>) => {
    const targetIds = ids.filter((id): id is string => Boolean(id));
    if (targetIds.length === 0) return;
    setUploadTelemetry(current => {
      const next = { ...current };
      targetIds.forEach(id => {
        delete next[id];
      });
      return next;
    });
  };
  const queueUploadTelemetry = (
    id: string,
    file: File,
    targetWorkspaceId: string,
    targetSpaceScope: DriveSpaceScope,
  ) => {
    const createdAt = new Date().toISOString();
    setUploadTelemetry(current => ({
      ...current,
      [id]: {
        id,
        spaceScope: targetSpaceScope,
        workspaceId: targetWorkspaceId,
        nodeId: null,
        objectKey: null,
        name: file.name,
        type: "upload",
        errorMessage: null,
        progress: 0,
        status: "queued",
        createdAt,
        updatedAt: createdAt,
        loadedBytes: 0,
        totalBytes: file.size,
        speedBytesPerSecond: null,
        remainingSeconds: null
      }
    }));
  };
  const attachUploadPromise = (promise: Promise<FileNodeResponse>, task: UploadDriveFileTask, meta: UploadTaskMeta, draftId?: string) => {
    void promise.then(createdNode => Promise.all([refreshDriveItems(), refreshTransfers(), refreshStorageUsage()]).then(() => createdNode)).then(createdNode => {
      const transferId = task.getState().transferId;
      unregisterUploadTask(transferId);
      if (draftId) unregisterUploadTask(draftId);
      meta.onCompleted(createdNode);
    }).catch(error => {
      const state = task.getState();
      if (isUploadDriveFileControlError(error)) {
        const controlledId = state.transferId ?? draftId ?? null;
        if (error.control === "canceled" || state.status === "canceled") unregisterUploadTask(controlledId);
        if (state.transferId) markUploadTelemetryStatus(state.transferId, error.control === "paused" ? "paused" : "canceled");
        else if (draftId) markUploadTelemetryStatus(draftId, error.control === "paused" ? "paused" : "canceled");
        void refreshTransfers();
        return;
      }
      if (isStorageCapacityError(error)) {
        unregisterUploadTask(state.transferId);
        if (draftId) unregisterUploadTask(draftId);
        removeUploadTelemetryRows(draftId, state.transferId);
        void refreshTransfers();
        meta.onFailed?.(error);
        return;
      }
      if (state.transferId) {
        if (draftId) unregisterUploadTask(draftId);
        registerUploadTask(state.transferId, task, meta);
        markUploadTelemetryStatus(state.transferId, "failed", getApiFeedback(error, "app.uploadFailed", "form"));
      }
      if (draftId) {
        if (!state.transferId) markUploadTelemetryStatus(draftId, "failed", getApiFeedback(error, "app.uploadFailed", "form"));
      }
      void refreshTransfers();
      meta.onFailed?.(error);
    });
  };
  const startUploadFile = (
    file: File,
    meta: UploadTaskMeta,
    targetNav: "drive" | "transfers" = "transfers",
    preflightUsage: StorageUsage | null = storageUsage,
    conflictStrategy: UploadConflictStrategy = "version",
  ) => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return;
    }
    const targetSpaceScope = spaceScopeRef.current;
    const scopedPreflightUsage = preflightUsage?.spaceScope === targetSpaceScope ? preflightUsage : null;
    const pendingUploadBytes = getPendingUploadBytes(Object.values(uploadTelemetry), targetSpaceScope);
    if (!hasUploadStorageCapacity(scopedPreflightUsage, pendingUploadBytes, file.size)) {
      showStorageInsufficient();
      return;
    }
    const draftId = createLocalUploadTransferId(++uploadDraftCounterRef.current);
    const targetWorkspaceId = workspaceId;
    queueUploadTelemetry(draftId, file, targetWorkspaceId, targetSpaceScope);
    activateNav(targetNav);
    if (targetNav === "transfers") {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      setWorkspaceLoading(false);
    } else {
      queueWorkspaceLoading();
    }
    let task: UploadDriveFileTask | null = null;
    task = createUploadDriveFileTask({
      conflictStrategy,
      file,
      onProgress: progress => {
        if (task) {
          registerUploadTask(progress.transferId, task, meta);
          unregisterUploadTask(draftId);
        }
        replaceUploadDraft(draftId, progress);
      },
      parentNodeId: currentFolderId,
      spaceScope: targetSpaceScope,
      workspaceActor: uploadActor,
      workspaceId: targetWorkspaceId
    });
    registerUploadTask(draftId, task, meta);
    attachUploadPromise(task.start(), task, meta, draftId);
  };
  const pauseUploadTransfer = (id: string) => {
    uploadTasksRef.current.get(id)?.pause();
  };
  const resumeUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task || task.getState().status === "running") return;
    const meta = uploadTaskMetaRef.current.get(id) ?? {
      onCompleted: () => showFeedback(t("app.uploaded")),
      onFailed: (error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error")
    };
    attachUploadPromise(task.resume(), task, meta);
  };
  const retryUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task || task.getState().status === "running") return;
    const meta = uploadTaskMetaRef.current.get(id) ?? {
      onCompleted: () => showFeedback(t("app.uploaded")),
      onFailed: (error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error")
    };
    markUploadTelemetryStatus(id, "queued");
    attachUploadPromise(task.start(), task, meta);
  };
  const cancelUploadTransfer = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (!task) return;
    task.cancel();
    unregisterUploadTask(id);
    markUploadTelemetryStatus(id, "canceled");
    void refreshTransfers();
    showFeedback(t("transfers.canceledToast"), "neutral");
  };
  const deleteTransferRow = (id: string) => {
    const task = uploadTasksRef.current.get(id);
    if (task) {
      task.cancel();
      unregisterUploadTask(id);
    }
    setUploadTelemetry(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTransferRows(current => current.filter(row => row.id !== id));
    if (isLocalUploadTransferId(id)) {
      showFeedback(t("transfers.deleted"));
      return;
    }
    void deleteTransfer(id).then(() => {
      showFeedback(t("transfers.deleted"));
    }).catch((error) => {
      void refreshTransfers();
      showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
    });
  };
  const uploadGeneratedFile = (fileName: string, content: BlobPart[], mimeType: string) => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return;
    }
    const file = new File(content, fileName, {
      type: mimeType
    });
    startUploadFile(file, {
      onCompleted: createdNode => {
        setSelected([createdNode.id]);
        setFocusedItemId(null);
        setRenamingItemId(createdNode.id);
        showFeedback(t("app.fileCreated"));
      },
      onFailed: error => {
        if (isStorageCapacityError(error)) {
          showStorageInsufficient();
          void refreshStorageUsage();
          return;
        }
        showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
      }
    }, "drive");
  };
  const createGeneratedFile = (type: GeneratedFileKind) => {
    const template = createGeneratedFileTemplate(type);
    const fileName = createUniqueDriveName(template.defaultName, currentDirectoryItems);
    uploadGeneratedFile(fileName, template.content, template.mimeType);
  };
  const requestRenameItem = (item: DriveItem) => {
    setSelected([item.id]);
    setFocusedItemId(null);
    setRenamingItemId(item.id);
  };
  const cancelRenameItem = () => {
    setRenamingItemId(null);
  };
  const commitRenameItem = async (item: DriveItem, rawName: string) => {
    const name = rawName.trim();
    if (!name || name === item.name) {
      setRenamingItemId(null);
      return true;
    }
    const nameValidation = validateDriveFileName(name);
    if (!nameValidation.ok) {
      showFeedback(t(getDriveFileNameErrorMessageKey(nameValidation.code), nameValidation.values), "error");
      return false;
    }

    if (item.objectKey) {
      const previousExtension = getNameExtension(item.name);
      const nextExtension = getNameExtension(name);
      if (previousExtension !== nextExtension) {
        const confirmed = window.confirm(t("files.renameExtensionChanged", {
          from: formatExtensionLabel(previousExtension, t("files.noExtension")),
          to: formatExtensionLabel(nextExtension, t("files.noExtension")),
        }));
        if (!confirmed) return false;
      }
    }

    try {
      await renameFileNode(item.id, name);
      await refreshDriveItems();
      setSelected([item.id]);
      setRenamingItemId(null);
      showFeedback(t("app.renamed"));
      return true;
    } catch (error) {
      showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
      return false;
    }
  };
  const setClipboardItems = (items: DriveItem[], mode: DriveClipboardMode) => {
    const actionItems = getActionItems(items).filter((item) => !item.archivedAt);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    setDriveClipboard({
      items: actionItems,
      mode,
      spaceScope,
      workspaceId,
    });
    showFeedback(mode === "copy" ? t("app.copied") : t("app.cut"));
  };

  const copyItem = (item: DriveItem) => {
    setClipboardItems([item], "copy");
  };
  const moveItem = (item: DriveItem) => {
    setClipboardItems([item], "move");
  };
  const copyItems = (items: DriveItem[]) => {
    setClipboardItems(items, "copy");
  };
  const cutItems = (items: DriveItem[]) => {
    setClipboardItems(items, "move");
  };
  const pasteClipboard = () => {
    if (!driveClipboard || !canPasteClipboard) {
      showFeedback(t("app.pasteUnavailable"), "neutral");
      return;
    }
    const targetFolderId = currentFolderId;
    const { items, mode } = driveClipboard;
    queueWorkspaceLoading();

    const action = mode === "copy"
      ? Promise.allSettled(items.map((item) => copyFileNode(item.id, { parentNodeId: targetFolderId }))).then((results) => {
        const succeeded = results
          .filter((result): result is PromiseFulfilledResult<FileNodeResponse> => result.status === "fulfilled")
          .map((result) => result.value);
        const failed = results
          .map((result, index) => ({ item: items[index], result }))
          .filter((entry): entry is { item: DriveItem; result: PromiseRejectedResult } => entry.result.status === "rejected")
          .map(({ item, result }) => ({
            id: item.id,
            message: result.reason instanceof Error ? result.reason.message : t("app.uploadFailed"),
          }));
        return Promise.all([refreshDriveItems(), refreshStorageUsage()]).then(() => {
          if (succeeded.length > 0) setSelected(succeeded.map((node) => node.id));
          return {
            failed,
            succeeded,
            summary: {
              failed: failed.length,
              requested: items.length,
              succeeded: succeeded.length,
            },
          };
        });
      })
      : items.length === 1
        ? moveFileNode(items[0].id, targetFolderId).then((node) => refreshDriveItems().then(() => {
          setSelected(current => current.filter(id => id !== items[0].id));
          setDriveClipboard(null);
          return {
            failed: [],
            succeeded: [node],
            summary: { failed: 0, requested: 1, succeeded: 1 },
          };
        }))
        : batchMoveFileNodes(items.map((item) => item.id), targetFolderId).then((result) => refreshDriveItems().then(() => {
          const movedIds = new Set(result.succeeded.map((item) => item.id));
          setSelected(current => current.filter(id => !movedIds.has(id)));
          if (result.summary.failed === 0) setDriveClipboard(null);
          else {
            const failedIds = new Set(result.failed.map((item) => item.id));
            setDriveClipboard(current => current && current.mode === "move"
              ? { ...current, items: current.items.filter((item) => failedIds.has(item.id)) }
              : current);
          }
          return result;
        }));

    void action.then((result) => {
      if (result.summary.requested === 1 && result.summary.failed === 0) {
        showFeedback(mode === "copy" ? t("app.duplicated") : t("app.moved"));
        return;
      }
      showBatchResult(result.summary, result.failed);
    }).catch((error) => showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error")).finally(() => {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
    });
  };
  const editItem = (item: DriveItem) => {
    openPreview(item.id);
  };
  const openFolder = (id: string) => {
    const item = findDriveItem(id, allKnownItems);
    if (!item || getItemKind(item) !== "folder") return;
    queueWorkspaceLoading();
    activateNav("drive");
    setCurrentFolderId(id);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
  };
  const openRoot = () => {
    queueWorkspaceLoading();
    activateNav("drive");
    setCurrentFolderId(null);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
    setSidebarOpen(false);
  };
  const navigateFolderPath = (id: string) => {
    const item = findDriveItem(id, allKnownItems);
    if (!item || getItemKind(item) !== "folder") return;
    queueWorkspaceLoading();
    activateNav("drive");
    setCurrentFolderId(id);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
  };
  const goUp = () => {
    const parentId = findDriveItem(currentFolderId ?? "", allKnownItems)?.parentId ?? null;
    queueWorkspaceLoading();
    activateNav("drive");
    setCurrentFolderId(parentId);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
  };
  const setDirectoryViewMode = (mode: "list" | "grid") => {
    if (mode !== viewMode) queueWorkspaceLoading();
    setViewMode(mode);
  };
  const openPreview = (id: string) => {
    const item = findDriveItem(id, allKnownItems);
    if (!item) return;
    setSelected([item.id]);
    setFocusedItemId(null);
    if (!canOpenFilePreview(item)) {
      setOpenWithDialogItem(null);
      showAppToast({
        dedupeKey: `preview-no-artifact-${item.id}`,
        title: t("preview.noArtifact"),
        tone: "info",
      });
      return;
    }
    const options = getFileOpenWithOptions(item);
    const remembered = getRememberedFileOpenWith(item);
    if (options.length > 1 && !remembered) {
      setOpenWithDialogItem(item);
      return;
    }
    setPreviewState({
      itemId: item.id,
      openWith: remembered ?? getDefaultFileOpenWith(item),
    });
  };
  const closePreview = () => {
    setPreviewState(null);
    if (initialPreviewItemId) router.replace("/");
  };
  const openWithOptions = openWithDialogItem ? getFileOpenWithOptions(openWithDialogItem) : [];
  const selectOpenWith = (value: FileOpenWithApp, remember: boolean) => {
    if (!openWithDialogItem) return;
    if (!canOpenFilePreview(openWithDialogItem)) {
      setOpenWithDialogItem(null);
      showAppToast({
        dedupeKey: `preview-no-artifact-${openWithDialogItem.id}`,
        title: t("preview.noArtifact"),
        tone: "info",
      });
      return;
    }
    if (remember) {
      window.localStorage.setItem(getFileOpenWithStorageKey(openWithDialogItem), value);
      showFeedback(t("preview.saved"));
    }
    setPreviewState({ itemId: openWithDialogItem.id, openWith: value });
    setOpenWithDialogItem(null);
  };
  const showItemDetails = (item: DriveItem) => {
    setFocusedItemId(item.id);
    setDetailsOpen(true);
  };
  const openItemSecurity = (item: DriveItem) => {
    setSelected([item.id]);
    setFocusedItemId(null);
    setDetailsOpen(false);
    setShareOpen(true);
  };
  const shareItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    setSelected(actionItems.map((item) => item.id));
    setFocusedItemId(null);
    setDetailsOpen(false);
    setShareOpen(true);
  };
  const triggerUpload = () => uploadInputRef.current?.click();
  const handleUploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length > 0 && workspaceId) {
      const invalidFile = selectedFiles.find(file => !validateDriveFileName(file.name).ok);
      if (invalidFile) {
        const validation = validateDriveFileName(invalidFile.name);
        if (!validation.ok) {
          showFeedback(t(getDriveFileNameErrorMessageKey(validation.code), validation.values), "error");
        }
        input.value = "";
        return;
      }
      const latestUsage = await fetchLatestStorageUsage(workspaceId);
      const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
      const pendingUploadBytes = getPendingUploadBytes(Object.values(uploadTelemetry), spaceScopeRef.current);
      if (!hasUploadStorageCapacity(latestUsage, pendingUploadBytes, selectedBytes)) {
        showStorageInsufficient();
        input.value = "";
        return;
      }
      const conflictingFiles = getConflictingUploadFiles(selectedFiles);
      let conflictStrategy: UploadConflictStrategy = "version";
      let uploadFiles = selectedFiles;
      if (conflictingFiles.length > 0) {
        const selectedStrategy = await requestUploadConflictStrategy(conflictingFiles);
        if (!selectedStrategy) {
          input.value = "";
          return;
        }
        conflictStrategy = selectedStrategy;
        if (selectedStrategy === "skip") {
          const conflictingKeys = new Set(conflictingFiles.map((file) => getDriveFileNameConflictKey(file.name)));
          uploadFiles = selectedFiles.filter((file) => !conflictingKeys.has(getDriveFileNameConflictKey(file.name)));
          showFeedback(t("upload.conflictSkipped", { count: selectedFiles.length - uploadFiles.length }), "neutral");
        }
      }
      uploadFiles.forEach(file => {
        startUploadFile(file, {
          onCompleted: () => showFeedback(t("app.uploaded")),
          onFailed: error => {
            if (isStorageCapacityError(error)) {
              showStorageInsufficient();
              void refreshStorageUsage();
              return;
            }
            showFeedback(getApiFeedback(error, "app.uploadFailed", "form"), "error");
          }
        }, "transfers", latestUsage, conflictStrategy);
      });
    }
    input.value = "";
  };
  const createMenuItems: AppMenuItem[] = [
    { icon: <LocalIcon name="folder" size={15} />, label: t("actions.newFolder"), onClick: createFolder, value: "new-folder" },
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.newTextFile"), onClick: () => createGeneratedFile("txt"), value: "new-text" },
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.newMarkdownFile"), onClick: () => createGeneratedFile("md"), value: "new-markdown" },
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.newWordFile"), onClick: () => createGeneratedFile("doc"), value: "new-word" },
    { icon: <LocalIcon name="grid" size={15} />, label: t("actions.newCsvFile"), onClick: () => createGeneratedFile("csv"), value: "new-csv" },
    { icon: <LocalIcon name="document" size={15} />, label: t("actions.newJsonFile"), onClick: () => createGeneratedFile("json"), value: "new-json" },
    { icon: <LocalIcon name="upload" size={15} />, label: t("app.upload"), onClick: triggerUpload, separatorBefore: true, value: "upload" }
  ];
  const toolbarActionTargets = selectedItems.length > 0 ? selectedItems : focusedItem ? [focusedItem] : activeItem ? [activeItem] : [];
  const toolbarHasActionTarget = toolbarActionTargets.length > 0;
  const toolbarCanUseClipboard = toolbarHasActionTarget && activeNavForView !== "trash" && toolbarActionTargets.every((item) => !item.archivedAt);
  const toolbarPasteMenuItems: AppMenuItem[] = canPasteClipboard
    ? [{ icon: <LocalIcon name="paste" size={15} />, label: t("actions.paste"), onClick: pasteClipboard, value: "paste" }]
    : [];
  const toolbarSelectionMenuItems: AppMenuItem[] = [
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copyLink"), onClick: () => copyItemsLink(toolbarActionTargets), disabled: !toolbarHasActionTarget, value: "copy-link" },
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copy"), onClick: () => copyItems(toolbarActionTargets), disabled: !toolbarCanUseClipboard, value: "copy" },
    { icon: <LocalIcon name="cut" size={15} />, label: t("actions.cut"), onClick: () => cutItems(toolbarActionTargets), disabled: !toolbarCanUseClipboard, value: "cut" },
    ...toolbarPasteMenuItems,
    activeNavForView === "trash"
      ? { icon: <LocalIcon name="refresh" size={15} />, label: t("actions.restore"), onClick: () => restoreItems(toolbarActionTargets), disabled: !toolbarHasActionTarget, value: "restore" }
      : { icon: <LocalIcon name="trash" size={15} />, label: t("actions.archive"), onClick: () => archiveItems(toolbarActionTargets), disabled: !toolbarHasActionTarget, tone: "danger", value: "archive" },
    activeNavForView === "trash"
      ? { icon: <LocalIcon name="trash" size={15} />, label: t("actions.deletePermanently"), onClick: () => deletePermanentlyItems(toolbarActionTargets), disabled: !toolbarHasActionTarget, separatorBefore: true, tone: "danger", value: "delete" }
      : { icon: <LocalIcon name="info" size={15} />, label: t("app.details"), onClick: () => setDetailsOpen(true), disabled: !toolbarHasActionTarget, value: "details" },
  ];
  const sortMenuItems: AppMenuItem[] = [
    { icon: <LocalIcon name="clock" size={15} />, label: t("filters.sortUpdatedDesc"), onClick: () => applyDriveSort("updatedAt", "desc"), value: "updatedAt:desc" },
    { icon: <LocalIcon name="abc" size={15} />, label: t("filters.sortNameAsc"), onClick: () => applyDriveSort("name", "asc"), value: "name:asc" },
    { icon: <LocalIcon name="file" size={15} />, label: t("filters.sortSizeDesc"), onClick: () => applyDriveSort("sizeBytes", "desc"), value: "sizeBytes:desc" },
    { icon: <LocalIcon name="calendar" size={15} />, label: t("filters.sortCreatedDesc"), onClick: () => applyDriveSort("createdAt", "desc"), value: "createdAt:desc" },
  ];
  const openSettings = () => {
    activateNav("settings");
    setCurrentFolderId(null);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
    setSidebarOpen(false);
    queueWorkspaceLoading();
  };
  const logout = () => {
    void logoutLocalUser().catch(() => undefined).finally(() => {
      clearStoredAuthToken();
      router.replace("/login");
    });
  };
  return <div className="drive-shell" style={{
    "--drive-accent": palette.primary,
    "--drive-accent-hover": palette.primaryHover,
    "--drive-accent-soft": palette.selected,
    "--drive-border": palette.hairline,
    "--drive-border-strong": palette.hairlineStrong,
    "--drive-canvas": palette.canvas,
    "--drive-danger": palette.danger,
    "--drive-focus": palette.focusRing,
    "--drive-muted": palette.muted,
    "--drive-shadow": palette.canvas === "#010102" ? "none" : "0 1px 2px rgba(17, 18, 23, 0.04)",
    "--drive-sidebar-bg": palette.canvas,
    "--drive-subtle": palette.subtle,
    "--drive-surface": palette.surface1,
    "--drive-surface-2": palette.surface2,
    "--drive-surface-3": palette.surface3,
    "--drive-text": palette.ink,
    "--drive-workspace-bg": palette.canvas === "#010102" ? palette.surface1 : "#f7f8fa"
  } as React.CSSProperties}>
      <AppHeader currentUser={activeUser} activeScopeLabel={searchScopeLabel} searchLoading={searchLoading} searchResultCount={serverSearchActive ? searchTotal : filteredFiles.length} searchResults={filteredFiles} brandLogo={brandLogo} onOpenSearchResult={openSearchResult} onOpenAdmin={openAdmin} onLogout={logout} onOpenSettings={openSettings} onRefresh={refreshWorkspace} palette={palette} query={query} setQuery={setQuery} siteName={resolvePublicSiteName(siteSettings.siteName)} openSidebar={() => setSidebarOpen(true)} />

      <div className="drive-main-grid" style={{
      "--drive-grid-columns": "var(--drive-ui-sidebar-width) minmax(0, 1fr)"
    } as React.CSSProperties}>
        <Sidebar activeNav={activeNavForView} currentFolderId={currentFolderId} directoryItems={driveItems} folderPath={folderPath} rootLabel={currentSpaceRootLabel} workspaceLabel={currentWorkspaceName} onNavigateFolder={id => {
        navigateFolderPath(id);
        setSidebarOpen(false);
      }} onNavigateRoot={openRoot} onSelectPersonalSpace={() => selectSpaceScope("personal")} palette={palette} sidebarOpen={sidebarOpen} spaceScope={spaceScope} storageUsage={storageUsage} onSelectWorkspaceSpace={() => selectSpaceScope("workspace")} setActiveNav={id => {
        if (id !== activeNav && id !== "transfers") queueWorkspaceLoading();
        if (id === "transfers") {
          if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
          setWorkspaceLoading(false);
        }
        activateNav(id);
        if (id !== "drive") setCurrentFolderId(null);
        setSelected([]);
        setRenamingItemId(null);
        setFocusedItemId(null);
        setDetailsOpen(false);
        setSidebarOpen(false);
      }} closeSidebar={() => setSidebarOpen(false)} />

        <div className="drive-workspace">
          <div className="drive-workspace-scroll">
              {activeModule !== "settings" ? (
                <WorkspaceBar
                  activeNav={activeNavForView}
                  createMenuItems={createMenuItems}
                  filtersActive={filtersActive || hasSearchFilters}
                  folderPath={folderPath}
                  hasActionTarget={toolbarHasActionTarget}
                  onDownloadSelection={() => downloadItems(toolbarActionTargets)}
                  onNavigateFolder={navigateFolderPath}
                  onNavigateRoot={openRoot}
                  onShareSelection={() => shareItems(toolbarActionTargets)}
                  onToggleFilters={toggleFilters}
                  onTriggerUpload={triggerUpload}
                  palette={palette}
                  rootLabel={currentSpaceRootLabel}
                  selectionMenuItems={toolbarSelectionMenuItems}
                  setViewMode={setDirectoryViewMode}
                  sortMenuItems={sortMenuItems}
                  viewMode={viewMode}
                />
              ) : null}
              {activeModule === "drive" && filtersActive ? (
                <DriveFilterPanel
                  filters={searchFilters}
                  onChange={setSearchFilters}
                  onClear={() => {
                    setSearchFilters(defaultDriveSearchFilters);
                    setFiltersActive(false);
                  }}
                  palette={palette}
                />
              ) : null}

            <div className="drive-workspace-content" data-details-open={showDetailsPanel ? "true" : undefined}>
              <MotionSurface key={`${activeModule}-${currentFolderId ?? "root"}`} preset="surface" aria-busy={workspaceBusy} className="drive-workspace-body">
                {showSettingsSkeleton ? <WorkspaceSkeleton activeModule={activeModule} palette={palette} viewMode={viewMode} /> : showWorkspaceLoader ? <LdrsLoadingState label={t("app.syncing")} palette={palette} minHeight="min(420px, calc(100dvh - 180px))" size={30} /> : <>
                    {activeModule === "drive" ? <FilesModule activeNav={activeNavForView} canLoadMore={searchCanLoadMore} canPaste={canPasteClipboard} createMenuItems={createMenuItems} currentFolderId={currentFolderId} error={filesError} hasQuery={query.trim().length > 0 || hasSearchFilters || searchLoading} items={filteredFiles} loadingMore={searchLoadingMore} onArchiveItem={item => archiveItems([item])} onBatchArchiveItems={archiveItems} onBatchCopyItems={copyItems} onBatchCutItems={cutItems} onBatchDeletePermanentlyItems={deletePermanentlyItems} onBatchDownloadItems={downloadItems} onBatchRestoreItems={restoreItems} onBatchShareItems={shareItems} onBlankGoRoot={openRoot} onBlankGoUp={goUp} onBlankPaste={pasteClipboard} onBlankRefresh={refreshWorkspace} onBlankSelect={clearSelection} onCancelRenameItem={cancelRenameItem} onCommitRenameItem={commitRenameItem} onDeletePermanentlyItem={item => deletePermanentlyItems([item])} onLoadMore={() => setSearchCursor((cursor) => ({ key: searchRequestKey, offset: (cursor.key === searchRequestKey ? cursor.offset : 0) + searchPageSize }))} onRestoreItem={item => restoreItems([item])} onCopyItem={item => copyItemsLink([item])} onCopyNodeItem={copyItem} onDownloadItem={item => downloadItems([item])} onEditItem={editItem} onMoveItem={moveItem} onRenameItem={requestRenameItem} onSetViewMode={setDirectoryViewMode} onShareItem={item => {
                setSelected([item.id]);
                setShareOpen(true);
              }} onShowDetailsItem={showItemDetails} onSecurityItem={openItemSecurity} goUp={goUp} openPreview={openPreview} palette={palette} renamingItemId={renamingItemId} selected={selected} sourceItems={fileModuleSourceItems} openFolder={openFolder} sortBy={searchFilters.sortBy} sortDirection={searchFilters.sortDirection} onSortChange={applyDriveSort} toggleSelected={toggleSelected} toggleStar={toggleStar} viewMode={viewMode} /> : null}
                    {activeModule === "links" ? <LinksModule error={linksError} links={linkRows} onCloseLink={closeShareLink} onCopyLink={copyShareLink} palette={palette} sourceItems={allKnownItems} /> : null}
                    {activeModule === "transfers" ? <TransfersModule controllableTransferIds={controllableTransferIds} onCancelTransfer={cancelUploadTransfer} onDeleteTransfer={deleteTransferRow} onPauseTransfer={pauseUploadTransfer} onResumeTransfer={resumeUploadTransfer} onRetryTransfer={retryUploadTransfer} palette={palette} rows={visibleTransferRows} /> : null}
                    {activeModule === "settings" ? (
                      <DriveSettingsWorkspace
                        currentUser={activeUser}
                        languageOptions={languageOptions}
                        locale={locale}
                        onLogout={logout}
                        onUserUpdated={setProfileUserOverride}
                        palette={palette}
                        setLocale={setLocale}
                        setThemePreference={setThemePreference}
                        setTimeZonePreference={setTimeZonePreference}
                        storageUsage={storageUsage}
                        themePreference={themePreference}
                        timeZone={timeZone}
                        timeZonePreference={timeZonePreference}
                      />
                    ) : null}
                  </>}
              </MotionSurface>
              {showDetailsPanel && workspaceLoading ? <div className="drive-details-panel">
                  <LdrsLoadingState compact label={t("app.syncing")} palette={palette} minHeight="100%" size={24} />
                </div> : null}
              {showDetailsPanel && !workspaceLoading ? <DetailsPanel activeItem={activeItem} focusedItem={focusedItem} currentFolderId={currentFolderId} folderPath={folderPath} selectedItems={selectedItems} palette={palette} close={() => setDetailsOpen(false)} onDownloadItems={downloadItems} onPreviewItem={(item) => openPreview(item.id)} onShareItems={shareItems} quickActionMenuItems={toolbarSelectionMenuItems} onVersionRestored={() => void Promise.all([refreshDriveItems(), refreshStorageUsage()])} sourceItems={allKnownItems} /> : null}
            </div>
          </div>
          <WorkspaceNotificationStack closeLabel={t("app.close")} palette={palette} />
        </div>
        <div className="drive-footer-slot">
          <LegalFooter locale={locale} palette={palette} siteName={siteSettings.siteName} />
        </div>
      </div>

      <HiddenFileInput inputRef={uploadInputRef} onChange={handleUploadFiles} />
      <UploadConflictDialog
        conflictCount={uploadConflictPrompt?.conflictCount ?? 0}
        fileNames={uploadConflictPrompt?.fileNames ?? []}
        onClose={() => resolveUploadConflictPrompt(null)}
        onSelect={resolveUploadConflictPrompt}
        open={Boolean(uploadConflictPrompt)}
        palette={palette}
      />
      <DriveShareDialog currentDirectoryItems={currentDirectoryItems} currentFolder={currentFolder} onClose={() => setShareOpen(false)} onShareCreated={share => {
      setRegisteredShares(current => [share, ...current.filter(item => item.token !== share.token)]);
      setLinksError(null);
      void refreshShares();
    }} open={shareOpen} palette={palette} policyLoadError={shareSettingsError} rootTitle={currentSpaceRootLabel} selectedItems={selectedItems} sourceItems={allKnownItems} themeMode={themeMode} workspaceId={workspaceId ?? undefined} workspaceSettings={shareSettings} />
      <DriveFilePreviewDialog
        item={previewItem}
        itemId={previewState?.itemId ?? null}
        locale={locale}
        onClose={closePreview}
        onSaved={() => void refreshDriveItems()}
        open={Boolean(previewState)}
        openWith={previewState?.openWith ?? null}
        palette={palette}
        workspaceId={workspaceId}
      />
      <FileOpenWithDialog
        item={openWithDialogItem}
        onClose={() => setOpenWithDialogItem(null)}
        onSelect={selectOpenWith}
        open={Boolean(openWithDialogItem)}
        options={openWithOptions}
        palette={palette}
      />
      <DriveUploadHud
        locale={locale}
        onOpenTransfers={openTransfers}
        palette={palette}
        rows={visibleTransferRows}
      />
      <MotionPresence show={bootLoading && bootLoadingStage !== null} preset="fade">
        {bootLoadingStage ? <AppLoading label={t(bootLoadingStage === "progress" ? "app.loading" : "app.syncing")} palette={palette} stage={bootLoadingStage} viewMode={viewMode} /> : null}
      </MotionPresence>
    </div>;
}
