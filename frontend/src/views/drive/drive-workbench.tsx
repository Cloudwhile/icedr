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
import { DriveHiddenFileInput } from "@/components/ui/drive-hidden-file-input";
import { UploadConflictDialog } from "@/components/ui/upload-conflict-dialog";
import { AppLoading, LdrsLoadingState, WorkspaceSkeleton } from "@/components/common/ui/loading-state";
import { findDriveItem, getChildItems, getFolderPath, getItemKind, type DriveItem, type DriveUserNav, type LanguageOption, type Locale, type Palette, type ThemeMode, type ThemePreference } from "@/features/file/model";
import { copyTextToClipboard, createShareUrl } from "@/features/file/actions";
import { getDriveFileNameErrorMessageKey, validateDriveFileName } from "@/features/file/file-name-policy";
import { createGeneratedFileTemplate, type GeneratedFileKind } from "@/features/file/generated-files";
import { canOpenFilePreview, getDefaultFileOpenWith, getFileOpenWithOptions, getFileOpenWithStorageKey, type FileOpenWithApp } from "@/features/file/open-with";
import { clearStoredAuthToken, createFolderNode, defaultPublicSiteSettings, fetchFileNode, fetchFileNodesByState, fetchPublicSiteSettings, fetchWorkspaces, fetchWorkspaceShareSettings, getDriveApiErrorMessage, isAuthExpiredApiError, logoutLocalUser, renameFileNode, resolvePublicSiteName, updateFileNodeState, type AuthUser, type DriveSpaceScope, type PublicSiteSettings, type WorkspaceResponse, type WorkspaceShareSettings } from "@/lib/drive-api";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { DriveShareDialog } from "./drive-share-dialog";
import { LegalFooter } from "./legal-footer";
import { fetchRegisteredSharesForWorkspace, revokeRegisteredShare, type RegisteredShare } from "@/features/share/registry";
import { DetailsPanel } from "./drive-details-panel";
import { AppHeader, Sidebar, WorkspaceBar } from "./drive-layout";
import type { AppMenuItem } from "@/components/ui/app-menu";
import { FilesModule } from "./drive-files";
import { LinksModule } from "./drive-modules";
import { TransfersModule } from "./drive-transfers";
import { LocalIcon } from "./drive-primitives";
import { DriveSettingsWorkspace } from "./drive-settings";
import { DriveFilterPanel } from "./drive-search";
import { isStorageCapacityError, useDriveTransfers } from "./use-drive-transfers";
import { useDriveSearch } from "./use-drive-search";
import { useDriveFileActions } from "./use-drive-file-actions";
import {
  createUniqueDriveName,
  driveNavPaths,
  formatExtensionLabel,
  getNameExtension,
  getPreviewOpenWith,
  getRememberedFileOpenWith,
  isThemePreferenceValue,
  isTimeZonePreferenceValue,
  localizeWorkspaceName,
  normalizeDrivePathname,
  withShareFlags,
  type DriveWorkspaceModule,
} from "./drive-workbench-helpers";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<{ itemId: string; openWith: FileOpenWithApp | null } | null>(null);
  const [openWithDialogItem, setOpenWithDialogItem] = useState<DriveItem | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [bootLoadingStage, setBootLoadingStage] = useState<"progress" | "blocking" | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [profileUserOverride, setProfileUserOverride] = useState<AuthUser | null>(null);
  const [shareSettings, setShareSettings] = useState<WorkspaceShareSettings | null>(null);
  const [shareSettingsError, setShareSettingsError] = useState<string | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>(defaultPublicSiteSettings);
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
  const requestedModule: DriveWorkspaceModule = ["links", "transfers", "settings"].includes(activeNav) ? activeNav as DriveWorkspaceModule : "drive";
  const activeModule: DriveWorkspaceModule = requestedModule;
  const activeNavForView = activeModule === requestedModule ? activeNav : "drive";
  const detailsTargetAvailable = Boolean(focusedItem || selectedItems.length > 0 || currentFolder);
  const showDetailsPanel = detailsOpen && activeModule !== "settings" && detailsTargetAvailable;
  const workspaceRefreshLoading = workspaceLoading || bootLoading;
  const showSettingsSkeleton = workspaceRefreshLoading && activeModule === "settings";
  const showWorkspaceLoader = workspaceRefreshLoading && activeModule !== "settings";
  const workspaceBusy = showSettingsSkeleton || showWorkspaceLoader;
  const getApiFeedback = useCallback((
    error: unknown,
    fallbackKey = "errors.unknown",
    scope: "form" | "global" | "share" = "global",
  ) => {
    if (isAuthExpiredApiError(error)) clearStoredAuthToken();
    return getDriveApiErrorMessage(error, t, { fallbackKey, scope });
  }, [t]);
  const {
    applyDriveSort,
    clearSearchFilters,
    fileModuleSourceItems,
    filteredFiles,
    filtersActive,
    hasSearchFilters,
    loadMoreSearchResults,
    query,
    resetSearchResults,
    searchCanLoadMore,
    searchFilters,
    searchLoading,
    searchLoadingMore,
    searchScopeLabel,
    searchTotal,
    serverSearchActive,
    setQuery,
    setSearchFilters,
    toggleFilters,
  } = useDriveSearch({
    activeNav: activeNavForView,
    allKnownItems,
    archivedItems,
    currentFolderId,
    currentFolderName: currentFolder?.name,
    currentSpaceRootLabel,
    driveItems,
    getApiFeedback,
    registeredSharesRef,
    searchEnabled: activeModule === "drive",
    setFilesError,
    spaceScope,
    workspaceId,
  });

  useEffect(() => {
    if (!activeUserId) return;
    if (activeUserLocale) setLocale(activeUserLocale);
    if (isThemePreferenceValue(activeUserTheme)) setThemePreference(activeUserTheme);
    if (isTimeZonePreferenceValue(activeUserTimeZone)) setTimeZonePreference(activeUserTimeZone);
  }, [activeUserId, activeUserLocale, activeUserTheme, activeUserTimeZone, setLocale, setThemePreference, setTimeZonePreference]);

  useEffect(() => {
    return () => {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
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
  const {
    cancelUploadTransfer,
    clearStorageUsage,
    controllableTransferIds,
    deleteTransferRow,
    handleUploadFiles,
    pauseUploadTransfer,
    refreshStorageUsage,
    refreshTransfers,
    resolveUploadConflictPrompt,
    retryUploadTransfer,
    resumeUploadTransfer,
    showStorageInsufficient,
    startUploadFile,
    storageUsage,
    triggerUpload,
    uploadConflictPrompt,
    uploadInputRef,
    visibleTransferRows,
  } = useDriveTransfers({
    activateNav,
    currentDirectoryItems,
    currentFolderId,
    getApiFeedback,
    queueWorkspaceLoading,
    refreshDriveItems,
    setWorkspaceLoading,
    showFeedback,
    spaceScope,
    uploadActor,
    workspaceId,
    workspaceTimerRef,
  });
  const {
    archiveItems,
    canPasteClipboard,
    copyItem,
    copyItems,
    copyItemsLink,
    cutItems,
    deletePermanentlyItems,
    downloadItems,
    getActionItems,
    moveItem,
    pasteClipboard,
    restoreItems,
  } = useDriveFileActions({
    activeItem,
    activeNav: activeNavForView,
    currentFolderId,
    driveItems,
    getApiFeedback,
    queueWorkspaceLoading,
    refreshDriveItems,
    refreshStorageUsage,
    setSelected,
    setWorkspaceLoading,
    showFeedback,
    spaceScope,
    workspaceId,
    workspaceTimerRef,
  });
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
    resetSearchResults();
    clearStorageUsage();
    queueWorkspaceLoading();
    void Promise.all([
      refreshDriveItems(workspaceIdRef.current, registeredSharesRef.current, nextSpaceScope),
      refreshStorageUsage(workspaceIdRef.current, nextSpaceScope),
    ]).finally(() => {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
    });
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

    if (item.hasContent) {
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
                  onClear={clearSearchFilters}
                  palette={palette}
                />
              ) : null}

            <div className="drive-workspace-content" data-details-open={showDetailsPanel ? "true" : undefined}>
              <MotionSurface key={`${activeModule}-${currentFolderId ?? "root"}`} preset="surface" aria-busy={workspaceBusy} className="drive-workspace-body">
                {showSettingsSkeleton ? <WorkspaceSkeleton activeModule={activeModule} palette={palette} viewMode={viewMode} /> : showWorkspaceLoader ? <LdrsLoadingState label={t("app.syncing")} palette={palette} minHeight="min(420px, calc(100dvh - 180px))" size={30} /> : <>
                    {activeModule === "drive" ? <FilesModule activeNav={activeNavForView} canLoadMore={searchCanLoadMore} canPaste={canPasteClipboard} createMenuItems={createMenuItems} currentFolderId={currentFolderId} error={filesError} hasQuery={query.trim().length > 0 || hasSearchFilters || searchLoading} items={filteredFiles} loadingMore={searchLoadingMore} onArchiveItem={item => archiveItems([item])} onBatchArchiveItems={archiveItems} onBatchCopyItems={copyItems} onBatchCutItems={cutItems} onBatchDeletePermanentlyItems={deletePermanentlyItems} onBatchDownloadItems={downloadItems} onBatchRestoreItems={restoreItems} onBatchShareItems={shareItems} onBlankGoRoot={openRoot} onBlankGoUp={goUp} onBlankPaste={pasteClipboard} onBlankRefresh={refreshWorkspace} onBlankSelect={clearSelection} onCancelRenameItem={cancelRenameItem} onCommitRenameItem={commitRenameItem} onDeletePermanentlyItem={item => deletePermanentlyItems([item])} onLoadMore={loadMoreSearchResults} onRestoreItem={item => restoreItems([item])} onCopyItem={item => copyItemsLink([item])} onCopyNodeItem={copyItem} onDownloadItem={item => downloadItems([item])} onEditItem={editItem} onMoveItem={moveItem} onRenameItem={requestRenameItem} onSetViewMode={setDirectoryViewMode} onShareItem={item => {
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

      <DriveHiddenFileInput inputRef={uploadInputRef} onChange={handleUploadFiles} />
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
