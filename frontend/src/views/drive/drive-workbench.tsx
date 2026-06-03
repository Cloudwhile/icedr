"use client";

import { useRouter } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { showAppToast, type AppToastTone } from "@/components/ui/app-toast";
import { DirectoryPickerDialog } from "@/components/ui/directory-picker-dialog";
import { DriveFilePreviewDialog } from "@/components/ui/drive-file-preview-dialog";
import { FileOpenWithDialog } from "@/components/ui/file-open-with-dialog";
import { AppLoading, LdrsLoadingState, WorkspaceSkeleton } from "@/components/common/ui/loading-state";
import { canAccessDriveModule } from "@/features/auth/permissions";
import { compareByModified, findDriveItem, getChildItems, getFolderPath, getItemKind, type DriveItem, type DriveModule, type LanguageOption, type Locale, type Palette, type ThemeMode, type ThemePreference } from "@/features/file/model";
import { copyTextToClipboard, createPreviewUrl, createShareUrl, createUploadDriveFileTask, downloadWorkspaceDriveItem, isUploadDriveFileControlError, type UploadDriveFileProgress, type UploadDriveFileTask } from "@/features/file/actions";
import { createGeneratedFileTemplate, type GeneratedFileKind } from "@/features/file/generated-files";
import { getDefaultFileOpenWith, getFileOpenWithOptions, getFileOpenWithStorageKey, type FileOpenWithApp } from "@/features/file/open-with";
import { clearStoredAuthToken, copyFileNode, createFolderNode, deleteTransfer, fetchAuditEvents, fetchFileNodesByState, fetchPublicSiteSettings, fetchStorageUsage, fetchTransfers, fetchWorkspaces, fetchWorkspaceShareSettings, logoutLocalUser, moveFileNode, renameFileNode, updateFileNodeState, type AuditEventResponse, type AuthUser, type FileNodeResponse, type PublicSiteSettings, type StorageUsage, type WorkspaceResponse, type WorkspaceShareSettings } from "@/lib/drive-api";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { ExternalShareDialog } from "./external-share";
import { LegalFooter } from "./legal-footer";
import { fetchRegisteredSharesForWorkspace, revokeRegisteredShare, type RegisteredShare } from "@/features/share/registry";
import type { TransferRow, UploadTelemetry } from "./drive-types";
import { DetailsPanel } from "./drive-details-panel";
import { AppHeader, Sidebar, WorkspaceBar } from "./drive-layout";
import type { AppMenuItem } from "@/components/ui/app-menu";
import { FilesModule } from "./drive-files";
import { AuditModule, LinksModule, TransfersModule } from "./drive-modules";
import { LocalIcon } from "./drive-primitives";
import { DriveSettingsWorkspace } from "./drive-settings";

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
  onFailed?: () => void;
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

export function DriveWorkbench({
  currentUser,
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
}) {
  const t = useTranslations();
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<string>("drive");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<DriveItem[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [registeredShares, setRegisteredShares] = useState<RegisteredShare[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventResponse[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [filtersActive, setFiltersActive] = useState(false);
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
  const [directoryPicker, setDirectoryPicker] = useState<{ item: DriveItem; mode: "copy" | "move" } | null>(null);
  const [shareSettings, setShareSettings] = useState<WorkspaceShareSettings | null>(null);
  const [shareSettingsError, setShareSettingsError] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>({
    siteName: "ICEDR",
    authLogoDataUrl: null
  });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadDraftCounterRef = useRef(0);
  const unmountedRef = useRef(false);
  const uploadTaskMetaRef = useRef(new Map<string, UploadTaskMeta>());
  const uploadTasksRef = useRef(new Map<string, UploadDriveFileTask>());
  const workspaceTimerRef = useRef<number | null>(null);
  const bootLoadingStartedRef = useRef(0);
  const initialPreviewOpenedRef = useRef(false);
  const workspaceIdRef = useRef<string | null>(null);
  const registeredSharesRef = useRef<RegisteredShare[]>([]);
  const activeUser = profileUserOverride?.id === currentUser?.id ? profileUserOverride : currentUser;
  const activeUserId = activeUser?.id;
  const activeUserLocale = activeUser?.locale;
  const activeUserTheme = activeUser?.theme;
  const activeUserTimeZone = activeUser?.timezone;
  const uploadActor = activeUser?.displayName || activeUser?.email || undefined;
  const canViewAudit = canAccessDriveModule(activeUser, "audit");
  const brandLogo = siteSettings.authLogoDataUrl || "/logo.png";
  const currentWorkspaceName = workspaces.find(workspace => workspace.id === workspaceId)?.name || t("app.workspaceSpace");
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
  const requestedModule: DriveModule | "settings" = ["links", "transfers", "audit", "settings"].includes(activeNav) ? activeNav as DriveModule | "settings" : "drive";
  const activeModule: DriveModule | "settings" = canAccessDriveModule(activeUser, requestedModule) ? requestedModule : "drive";
  const activeNavForView = activeModule === requestedModule ? activeNav : "drive";
  const showDetailsPanel = detailsOpen && activeModule !== "settings";
  const workspaceRefreshLoading = workspaceLoading || bootLoading;
  const showSettingsSkeleton = workspaceRefreshLoading && activeModule === "settings";
  const showWorkspaceLoader = workspaceRefreshLoading && activeModule !== "settings";
  const workspaceBusy = showSettingsSkeleton || showWorkspaceLoader;

  useEffect(() => {
    if (!activeUserId) return;
    if (activeUserLocale) setLocale(activeUserLocale);
    if (isThemePreferenceValue(activeUserTheme)) setThemePreference(activeUserTheme);
    if (isTimeZonePreferenceValue(activeUserTimeZone)) setTimeZonePreference(activeUserTimeZone);
  }, [activeUserId, activeUserLocale, activeUserTheme, activeUserTimeZone, setLocale, setThemePreference, setTimeZonePreference]);

  const directoryPickerDisabledIds = useMemo(() => {
    if (!directoryPicker || getItemKind(directoryPicker.item) !== "folder") return [];
    const disabled = new Set([directoryPicker.item.id]);
    const visit = (parentId: string) => {
      driveItems.forEach((item) => {
        if (item.parentId !== parentId || getItemKind(item) !== "folder") return;
        disabled.add(item.id);
        visit(item.id);
      });
    };
    visit(directoryPicker.item.id);
    return Array.from(disabled);
  }, [directoryPicker, driveItems]);
  const filteredFiles = useMemo(() => {
    let scope = getChildItems(currentFolderId, driveItems);
    if (activeNavForView === "shared") scope = driveItems.filter(item => item.shared);else if (activeNavForView === "starred") scope = driveItems.filter(item => item.starred);else if (activeNavForView === "recent") scope = [...driveItems].sort(compareByModified);else if (activeNavForView === "trash") scope = archivedItems;
    if (filtersActive) scope = scope.filter(item => item.shared || item.starred);
    const q = query.trim().toLowerCase();
    if (!q) return scope;
    return scope.filter(item => item.name.toLowerCase().includes(q) || item.owner.toLowerCase().includes(q));
  }, [activeNavForView, archivedItems, currentFolderId, driveItems, filtersActive, query]);
  useEffect(() => {
    const uploadTasks = uploadTasksRef.current;
    const uploadTaskMeta = uploadTaskMetaRef.current;
    return () => {
      unmountedRef.current = true;
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
    registeredSharesRef.current = registeredShares;
  }, [registeredShares]);
  useEffect(() => {
    if (!initialPreviewItemId || initialPreviewOpenedRef.current || bootLoading) return;
    initialPreviewOpenedRef.current = true;
    setActiveNav("drive");
    setDetailsOpen(false);
    setFocusedItemId(null);
    setPreviewState({ itemId: initialPreviewItemId, openWith: null });
    setSelected([initialPreviewItemId]);
  }, [bootLoading, initialPreviewItemId]);
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
  const refreshDriveItems = useCallback(async (targetWorkspaceId = workspaceIdRef.current, shares = registeredSharesRef.current) => {
    if (!targetWorkspaceId) return;
    try {
      const [activeNodes, archivedNodes] = await Promise.all([fetchFileNodesByState({
        workspaceId: targetWorkspaceId,
        state: "active"
      }), fetchFileNodesByState({
        workspaceId: targetWorkspaceId,
        state: "archived"
      })]);
      setDriveItems(withShareFlags(activeNodes.map(mapFileNodeToDriveItem), shares));
      setArchivedItems(withShareFlags(archivedNodes.map(mapFileNodeToDriveItem), shares));
      setFilesError(null);
    } catch {
      setDriveItems([]);
      setArchivedItems([]);
      setFilesError(t("files.loadFailed"));
    }
  }, [t]);
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
    } catch {
      registeredSharesRef.current = [];
      setRegisteredShares([]);
      setLinksError(t("share.apiUnavailable"));
      return [] as RegisteredShare[];
    }
  }, [t]);
  const refreshAuditEvents = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!canViewAudit) {
      setAuditEvents([]);
      setAuditError(null);
      return;
    }
    if (!targetWorkspaceId) return;
    try {
      const events = await fetchAuditEvents({
        workspaceId: targetWorkspaceId,
        limit: 100
      });
      setAuditEvents(events);
      setAuditError(null);
    } catch {
      setAuditEvents([]);
      setAuditError(t("audit.loadFailed"));
    }
  }, [canViewAudit, t]);
  const refreshShareSettings = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return;
    try {
      const settings = await fetchWorkspaceShareSettings(targetWorkspaceId);
      setShareSettings(settings);
      setShareSettingsError(null);
    } catch {
      setShareSettings(null);
      setShareSettingsError(t("admin.loadFailed"));
    }
  }, [t]);
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
  const refreshStorageUsage = useCallback(async (targetWorkspaceId = workspaceIdRef.current) => {
    if (!targetWorkspaceId) return;
    try {
      setStorageUsage(await fetchStorageUsage(targetWorkspaceId));
    } catch {
      setStorageUsage(null);
    }
  }, []);
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
        await Promise.all([refreshDriveItems(initialWorkspaceId, shares), refreshAuditEvents(initialWorkspaceId), refreshShareSettings(initialWorkspaceId), refreshTransfers(initialWorkspaceId), refreshStorageUsage(initialWorkspaceId)]);
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
  }, [refreshAuditEvents, refreshDriveItems, refreshShareSettings, refreshShares, refreshStorageUsage, refreshTransfers, refreshWorkspaceList]);
  const queueWorkspaceLoading = () => {
    if (bootLoading) return;
    if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
    setWorkspaceLoading(true);
    workspaceTimerRef.current = window.setTimeout(() => setWorkspaceLoading(false), 180);
  };
  const showFeedback = useCallback((message: string, tone: AppToastTone = "success") => {
    showAppToast({
      title: message,
      tone,
    });
  }, []);
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
      showFeedback(t("app.noSelection"), "neutral");
      return;
    }
    void downloadWorkspaceDriveItem(actionItems[0], workspaceId ?? undefined).then(() => {
      showFeedback(t("app.downloaded"));
      void refreshAuditEvents();
    }).catch(() => showFeedback(t("share.downloadFailed"), "error"));
  };
  const archiveItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    void Promise.all(actionItems.map(item => updateFileNodeState(item.id, {
      archived: true
    }))).then(() => Promise.all([refreshDriveItems(), refreshAuditEvents(), refreshStorageUsage()])).then(() => {
      setSelected(current => current.filter(id => !actionItems.some(item => item.id === id)));
      showFeedback(t("app.archived", {
        count: actionItems.length
      }));
    }).catch(() => showFeedback(t("app.uploadFailed"), "error"));
  };
  const restoreItems = (items: DriveItem[]) => {
    const actionItems = getActionItems(items);
    if (actionItems.length === 0) {
      showFeedback(t("app.noSelection"));
      return;
    }
    void Promise.all(actionItems.map(item => updateFileNodeState(item.id, {
      archived: false
    }))).then(() => Promise.all([refreshDriveItems(), refreshAuditEvents(), refreshStorageUsage()])).then(() => {
      setSelected(current => current.filter(id => !actionItems.some(item => item.id === id)));
      showFeedback(t("app.refreshed"));
    }).catch(() => showFeedback(t("app.uploadFailed"), "error"));
  };
  const refreshWorkspace = () => {
    if (bootLoading) return;
    if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
    setWorkspaceLoading(true);
    void Promise.all([refreshDriveItems(), refreshShares(), refreshAuditEvents(), refreshShareSettings(), refreshTransfers(), refreshStorageUsage()]).finally(() => {
      workspaceTimerRef.current = window.setTimeout(() => {
        setWorkspaceLoading(false);
        showFeedback(t("app.refreshed"));
      }, 180);
    });
  };
  const toggleFilters = () => {
    setFiltersActive(value => {
      const next = !value;
      showFeedback(next ? t("app.filtersApplied") : t("app.filtersCleared"));
      return next;
    });
  };
  const openActivity = () => {
    if (!canViewAudit) return;
    setActiveNav("audit");
    setCurrentFolderId(null);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
    queueWorkspaceLoading();
    showFeedback(t("app.activityOpened"));
  };
  const closeShareLink = (id: string) => {
    void revokeRegisteredShare(id).then(() => refreshShares()).then(() => refreshAuditEvents()).then(() => showFeedback(t("links.linkClosed"))).catch(() => {
      setLinksError(t("links.closeFailed"));
      showFeedback(t("links.closeFailed"));
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
      void refreshAuditEvents();
    }).catch(() => showFeedback(t("app.uploadFailed"), "error"));
  };
  const createFolder = () => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return;
    }
    const name = createUniqueDriveName(t("actions.newFolder"), currentDirectoryItems);
    setActiveNav("drive");
    queueWorkspaceLoading();
    void createFolderNode({
      name,
      owner: uploadActor,
      parentNodeId: currentFolderId,
      workspaceId
    }).then(createdNode => Promise.all([refreshDriveItems(), refreshAuditEvents(), refreshStorageUsage()]).then(() => createdNode)).then(createdNode => {
      setSelected([createdNode.id]);
      setFocusedItemId(null);
      setRenamingItemId(createdNode.id);
      showFeedback(t("app.folderCreated"));
    }).catch(() => showFeedback(t("app.uploadFailed"), "error")).finally(() => {
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
        workspaceId: progress.workspaceId,
        nodeId: null,
        objectKey: null,
        name: progress.fileName,
        type: "upload",
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
  const markUploadTelemetryStatus = (id: string, status: UploadTelemetry["status"]) => {
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
          speedBytesPerSecond: null,
          remainingSeconds: null
        }
      };
    });
  };
  const queueUploadTelemetry = (id: string, file: File, targetWorkspaceId: string) => {
    const createdAt = new Date().toISOString();
    setUploadTelemetry(current => ({
      ...current,
      [id]: {
        id,
        workspaceId: targetWorkspaceId,
        nodeId: null,
        objectKey: null,
        name: file.name,
        type: "upload",
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
    void promise.then(createdNode => Promise.all([refreshDriveItems(), refreshAuditEvents(), refreshTransfers(), refreshStorageUsage()]).then(() => createdNode)).then(createdNode => {
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
      unregisterUploadTask(state.transferId);
      if (draftId) {
        unregisterUploadTask(draftId);
        if (!state.transferId) markUploadTelemetryStatus(draftId, "failed");
      }
      void refreshTransfers();
      meta.onFailed?.();
    });
  };
  const startUploadFile = (file: File, meta: UploadTaskMeta, targetNav: "drive" | "transfers" = "transfers") => {
    if (!workspaceId) {
      showFeedback(t("app.uploadFailed"), "error");
      return;
    }
    const draftId = createLocalUploadTransferId(++uploadDraftCounterRef.current);
    const targetWorkspaceId = workspaceId;
    queueUploadTelemetry(draftId, file, targetWorkspaceId);
    setActiveNav(targetNav);
    if (targetNav === "transfers") {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
      setWorkspaceLoading(false);
    } else {
      queueWorkspaceLoading();
    }
    let task: UploadDriveFileTask | null = null;
    task = createUploadDriveFileTask({
      file,
      onProgress: progress => {
        if (task) {
          registerUploadTask(progress.transferId, task, meta);
          unregisterUploadTask(draftId);
        }
        replaceUploadDraft(draftId, progress);
      },
      parentNodeId: currentFolderId,
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
      onFailed: () => showFeedback(t("app.uploadFailed"), "error")
    };
    attachUploadPromise(task.resume(), task, meta);
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
      void refreshAuditEvents();
    }).catch(() => {
      void refreshTransfers();
      showFeedback(t("app.uploadFailed"), "error");
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
      onFailed: () => showFeedback(t("app.uploadFailed"), "error")
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
      await Promise.all([refreshDriveItems(), refreshAuditEvents()]);
      setSelected([item.id]);
      setRenamingItemId(null);
      showFeedback(t("app.renamed"));
      return true;
    } catch {
      showFeedback(t("app.uploadFailed"), "error");
      return false;
    }
  };
  const copyItem = (item: DriveItem) => {
    setDirectoryPicker({ item, mode: "copy" });
  };
  const moveItem = (item: DriveItem) => {
    setDirectoryPicker({ item, mode: "move" });
  };
  const confirmDirectoryAction = (targetFolderId: string | null) => {
    if (!directoryPicker) return;
    const { item, mode } = directoryPicker;
    if (mode === "move" && item.parentId === targetFolderId) {
      setDirectoryPicker(null);
      return;
    }
    queueWorkspaceLoading();
    const action = mode === "copy"
      ? copyFileNode(item.id, { parentNodeId: targetFolderId }).then(() => Promise.all([refreshDriveItems(), refreshAuditEvents(), refreshStorageUsage()]))
      : moveFileNode(item.id, targetFolderId).then(() => Promise.all([refreshDriveItems(), refreshAuditEvents()])).then(() => {
        setSelected(current => current.filter(id => id !== item.id));
      });
    void action.then(() => {
      setDirectoryPicker(null);
      showFeedback(mode === "copy" ? t("app.duplicated") : t("app.moved"));
    }).catch(() => showFeedback(t("app.uploadFailed"), "error")).finally(() => {
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
    setActiveNav("drive");
    setCurrentFolderId(id);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
  };
  const openRoot = () => {
    queueWorkspaceLoading();
    setActiveNav("drive");
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
    setActiveNav("drive");
    setCurrentFolderId(id);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
  };
  const goUp = () => {
    const parentId = findDriveItem(currentFolderId ?? "", allKnownItems)?.parentId ?? null;
    queueWorkspaceLoading();
    setActiveNav("drive");
    setCurrentFolderId(parentId);
    setSelected([]);
    setRenamingItemId(null);
    setFocusedItemId(null);
    setDetailsOpen(false);
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
    const options = getFileOpenWithOptions(item);
    const storageKey = getFileOpenWithStorageKey(item);
    const remembered = typeof window === "undefined" ? null : window.localStorage.getItem(storageKey);
    if (options.length > 1 && !remembered) {
      setOpenWithDialogItem(item);
      return;
    }
    setPreviewState({
      itemId: item.id,
      openWith: (remembered as FileOpenWithApp | null) ?? getDefaultFileOpenWith(item),
    });
  };
  const closePreview = () => {
    setPreviewState(null);
    if (initialPreviewItemId) router.replace("/");
  };
  const openWithOptions = openWithDialogItem ? getFileOpenWithOptions(openWithDialogItem) : [];
  const selectOpenWith = (value: FileOpenWithApp, remember: boolean) => {
    if (!openWithDialogItem) return;
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
  const triggerUpload = () => uploadInputRef.current?.click();
  const handleUploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length > 0 && workspaceId) {
      selectedFiles.forEach(file => {
        startUploadFile(file, {
          onCompleted: () => showFeedback(t("app.uploaded")),
          onFailed: () => showFeedback(t("app.uploadFailed"), "error")
        });
      });
    }
    event.target.value = "";
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
  const openSettings = () => {
    setActiveNav("settings");
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
      <AppHeader currentUser={activeUser} filtersActive={filtersActive} brandLogo={brandLogo} onActivity={openActivity} onLogout={logout} onOpenSettings={openSettings} onRefresh={refreshWorkspace} onToggleFilters={toggleFilters} palette={palette} query={query} setQuery={setQuery} siteName={siteSettings.siteName} openSidebar={() => setSidebarOpen(true)} />

      <div className="drive-main-grid" style={{
      "--drive-grid-columns": showDetailsPanel ? "232px minmax(0, 1fr) 328px" : "232px minmax(0, 1fr)"
    } as React.CSSProperties}>
        <Sidebar activeNav={activeNavForView} currentFolderId={currentFolderId} currentUser={activeUser} directoryItems={driveItems} folderPath={folderPath} rootLabel={currentWorkspaceName} onNavigateFolder={id => {
        navigateFolderPath(id);
        setSidebarOpen(false);
      }} onNavigateRoot={openRoot} palette={palette} sidebarOpen={sidebarOpen} spaceScope="workspace" storageUsage={storageUsage} onSelectWorkspaceSpace={openRoot} setActiveNav={id => {
        if (id === "audit" && !canViewAudit) return;
        if (id !== activeNav && id !== "transfers") queueWorkspaceLoading();
        if (id === "transfers") {
          if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
          setWorkspaceLoading(false);
        }
        setActiveNav(id);
        if (id !== "drive") setCurrentFolderId(null);
        setSelected([]);
        setRenamingItemId(null);
        setFocusedItemId(null);
        setDetailsOpen(false);
        setSidebarOpen(false);
      }} closeSidebar={() => setSidebarOpen(false)} />

        <div className="drive-workspace">
          <div className="drive-workspace-scroll">
              {activeModule !== "settings" ? <WorkspaceBar activeNav={activeNavForView} createMenuItems={createMenuItems} folderPath={folderPath} onNavigateFolder={navigateFolderPath} onNavigateRoot={openRoot} palette={palette} rootLabel={t("app.rootPath")} setViewMode={setDirectoryViewMode} viewMode={viewMode} /> : null}

            <MotionSurface key={`${activeModule}-${currentFolderId ?? "root"}`} preset="surface" aria-busy={workspaceBusy} className="drive-workspace-body">
              {showSettingsSkeleton ? <WorkspaceSkeleton activeModule={activeModule} palette={palette} viewMode={viewMode} /> : showWorkspaceLoader ? <LdrsLoadingState label={t("app.syncing")} palette={palette} minHeight="min(420px, calc(100dvh - 180px))" size={30} /> : <>
                  {activeModule === "drive" ? <FilesModule activeNav={activeNavForView} createMenuItems={createMenuItems} currentFolderId={currentFolderId} error={filesError} hasQuery={query.trim().length > 0} items={filteredFiles} onArchiveItem={item => archiveItems([item])} onBlankGoRoot={openRoot} onBlankGoUp={goUp} onBlankRefresh={refreshWorkspace} onBlankSelect={clearSelection} onCancelRenameItem={cancelRenameItem} onCommitRenameItem={commitRenameItem} onRestoreItem={item => restoreItems([item])} onCopyItem={item => copyItemsLink([item])} onCopyNodeItem={copyItem} onDownloadItem={item => downloadItems([item])} onEditItem={editItem} onMoveItem={moveItem} onRenameItem={requestRenameItem} onSetViewMode={setDirectoryViewMode} onShareItem={item => {
                setSelected([item.id]);
                setShareOpen(true);
              }} onShowDetailsItem={showItemDetails} onSecurityItem={openItemSecurity} goUp={goUp} openPreview={openPreview} palette={palette} renamingItemId={renamingItemId} selected={selected} sourceItems={allKnownItems} openFolder={openFolder} toggleSelected={toggleSelected} toggleStar={toggleStar} viewMode={viewMode} /> : null}
                  {activeModule === "links" ? <LinksModule error={linksError} links={linkRows} onCloseLink={closeShareLink} onCopyLink={copyShareLink} onFocusRecords={openActivity} palette={palette} sourceItems={allKnownItems} /> : null}
                  {activeModule === "transfers" ? <TransfersModule controllableTransferIds={controllableTransferIds} onCancelTransfer={cancelUploadTransfer} onDeleteTransfer={deleteTransferRow} onPauseTransfer={pauseUploadTransfer} onResumeTransfer={resumeUploadTransfer} palette={palette} rows={visibleTransferRows} /> : null}
                  {activeModule === "audit" ? <AuditModule error={auditError} events={auditEvents} onRefresh={refreshAuditEvents} palette={palette} /> : null}
                  {activeModule === "settings" ? <DriveSettingsWorkspace currentUser={activeUser} languageOptions={languageOptions} locale={locale} onUserUpdated={setProfileUserOverride} palette={palette} setLocale={setLocale} setThemePreference={setThemePreference} setTimeZonePreference={setTimeZonePreference} storageUsage={storageUsage} themePreference={themePreference} timeZone={timeZone} timeZonePreference={timeZonePreference} /> : null}
                </>}
            </MotionSurface>
          </div>
        </div>

        {showDetailsPanel && workspaceLoading ? <div className="drive-details-panel">
            <LdrsLoadingState compact label={t("app.syncing")} palette={palette} minHeight="100%" size={24} />
          </div> : null}
        {showDetailsPanel && !workspaceLoading ? <DetailsPanel activeItem={activeItem} focusedItem={focusedItem} currentFolderId={currentFolderId} folderPath={folderPath} selectedItems={selectedItems} palette={palette} close={() => setDetailsOpen(false)} sourceItems={allKnownItems} /> : null}
        <div className="drive-footer-slot">
          <LegalFooter locale={locale} palette={palette} />
        </div>
      </div>

      <HiddenFileInput inputRef={uploadInputRef} onChange={handleUploadFiles} />
      <DirectoryPickerDialog
        actionLabel={directoryPicker?.mode === "copy" ? t("actions.copy") : t("actions.move")}
        closeLabel={t("app.close")}
        currentFolderId={currentFolderId}
        disabledFolderIds={directoryPickerDisabledIds}
        items={driveItems}
        onClose={() => setDirectoryPicker(null)}
        onConfirm={confirmDirectoryAction}
        open={Boolean(directoryPicker)}
        palette={palette}
        rootLabel={t("app.rootPath")}
        title={directoryPicker?.mode === "copy" ? t("actions.copyTo") : t("actions.moveTo")}
      />
      <ExternalShareDialog currentDirectoryItems={currentDirectoryItems} currentFolder={currentFolder} onClose={() => setShareOpen(false)} onShareCreated={share => {
      setRegisteredShares(current => [share, ...current.filter(item => item.token !== share.token)]);
      setLinksError(null);
      void refreshShares();
      void refreshAuditEvents();
    }} open={shareOpen} palette={palette} policyLoadError={shareSettingsError} rootTitle={t("nav.drive")} selectedItems={selectedItems} sourceItems={allKnownItems} themeMode={themeMode} workspaceId={workspaceId ?? undefined} workspaceSettings={shareSettings} />
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
      <MotionPresence show={bootLoading && bootLoadingStage !== null} preset="fade">
        {bootLoadingStage ? <AppLoading label={t(bootLoadingStage === "progress" ? "app.loading" : "app.syncing")} palette={palette} stage={bootLoadingStage} viewMode={viewMode} /> : null}
      </MotionPresence>
    </div>;
}
