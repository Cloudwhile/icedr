"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { showAppToast, type AppToastTone } from "@/components/ui/app-toast";
import { AppLoading, DetailsPanelSkeleton, WorkspaceSkeleton } from "@/components/common/ui/loading-state";
import { compareByModified, findDriveItem, getChildItems, getFolderPath, getItemKind, type DriveItem, type DriveModule, type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { copyTextToClipboard, createPreviewUrl, createShareUrl, downloadWorkspaceDriveItem, uploadDriveFile, type UploadDriveFileProgress } from "@/features/file/actions";
import { fetchAuditEvents, fetchFileNodesByState, fetchPublicSiteSettings, fetchStorageUsage, fetchTransfers, fetchWorkspaces, fetchWorkspaceShareSettings, updateFileNodeState, type AuditEventResponse, type AuthUser, type PublicSiteSettings, type StorageUsage, type WorkspaceShareSettings } from "@/lib/drive-api";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { ExternalShareAdminSettingsPanel, ExternalShareDialog } from "./external-share";
import { LegalFooter } from "./legal-footer";
import { fetchRegisteredSharesForWorkspace, revokeRegisteredShare, type RegisteredShare } from "@/features/share/registry";
import type { TransferRow, UploadTelemetry } from "./drive-types";
import { DetailsPanel } from "./drive-details-panel";
import { AppHeader, SelectionToolbar, Sidebar, WorkspaceBar } from "./drive-layout";
import { FilesModule } from "./drive-files";
import { AuditModule, LinksModule, TransfersModule } from "./drive-modules";
function getDetailActionItems({
  currentFolderId,
  focusedItem,
  sourceItems,
  selectedItems
}: {
  currentFolderId: string | null;
  focusedItem?: DriveItem;
  sourceItems: DriveItem[];
  selectedItems: DriveItem[];
}) {
  if (selectedItems.length > 0) return selectedItems;
  if (focusedItem) return [focusedItem];
  return getChildItems(currentFolderId, sourceItems);
}
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
export function DriveWorkbench({
  currentUser,
  locale,
  palette,
  setLocale,
  setThemeMode,
  themeMode
}: {
  currentUser: AuthUser | null;
  locale: Locale;
  palette: Palette;
  setLocale: React.Dispatch<React.SetStateAction<Locale>>;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<string>("drive");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<DriveItem[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
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
  const [transferRows, setTransferRows] = useState<TransferRow[]>([]);
  const [uploadTelemetry, setUploadTelemetry] = useState<Record<string, UploadTelemetry>>({});
  const [bootLoading, setBootLoading] = useState(true);
  const [bootLoadingStage, setBootLoadingStage] = useState<"progress" | "skeleton" | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [shareSettings, setShareSettings] = useState<WorkspaceShareSettings | null>(null);
  const [shareSettingsError, setShareSettingsError] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>({
    siteName: "ICEDR",
    authLogoDataUrl: null
  });
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceTimerRef = useRef<number | null>(null);
  const bootLoadingStartedRef = useRef(0);
  const workspaceIdRef = useRef<string | null>(null);
  const registeredSharesRef = useRef<RegisteredShare[]>([]);
  const uploadActor = currentUser?.displayName || currentUser?.email || undefined;
  const brandLogo = siteSettings.authLogoDataUrl || "/logo.png";
  const allKnownItems = useMemo(() => [...driveItems, ...archivedItems], [archivedItems, driveItems]);
  const selectedItems = useMemo(() => allKnownItems.filter(item => selected.includes(item.id)), [allKnownItems, selected]);
  const activeItem = selectedItems[0];
  const focusedItem = focusedItemId ? findDriveItem(focusedItemId, allKnownItems) : undefined;
  const folderPath = useMemo(() => getFolderPath(currentFolderId, allKnownItems), [allKnownItems, currentFolderId]);
  const currentFolder = folderPath.at(-1);
  const currentDirectoryItems = useMemo(() => getChildItems(currentFolderId, driveItems), [currentFolderId, driveItems]);
  const linkRows = useMemo(() => registeredShares.filter(share => share.status !== "revoked" && !share.revokedAt), [registeredShares]);
  const visibleTransferRows = useMemo(() => mergeTransferRows(transferRows, Object.values(uploadTelemetry)), [transferRows, uploadTelemetry]);
  const activeModule: DriveModule | "settings" = ["links", "transfers", "audit", "settings"].includes(activeNav) ? activeNav as DriveModule | "settings" : "drive";
  const showDetailsPanel = detailsOpen && activeModule !== "settings";
  const filteredFiles = useMemo(() => {
    let scope = getChildItems(currentFolderId, driveItems);
    if (activeNav === "shared") scope = driveItems.filter(item => item.shared);else if (activeNav === "starred") scope = driveItems.filter(item => item.starred);else if (activeNav === "recent") scope = [...driveItems].sort(compareByModified);else if (activeNav === "trash") scope = archivedItems;
    if (filtersActive) scope = scope.filter(item => item.shared || item.starred);
    const q = query.trim().toLowerCase();
    if (!q) return scope;
    return scope.filter(item => item.name.toLowerCase().includes(q) || item.owner.toLowerCase().includes(q));
  }, [activeNav, archivedItems, currentFolderId, driveItems, filtersActive, query]);
  useEffect(() => {
    return () => {
      if (workspaceTimerRef.current) window.clearTimeout(workspaceTimerRef.current);
    };
  }, []);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);
  useEffect(() => {
    registeredSharesRef.current = registeredShares;
  }, [registeredShares]);
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
  }, [t]);
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
    const skeletonTimer = window.setTimeout(() => {
      if (!cancelled) setBootLoadingStage("skeleton");
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
      window.clearTimeout(skeletonTimer);
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
    setActiveNav("audit");
    setCurrentFolderId(null);
    setSelected([]);
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
  const openFolder = (id: string) => {
    const item = findDriveItem(id, allKnownItems);
    if (!item || getItemKind(item) !== "folder") return;
    queueWorkspaceLoading();
    setCurrentFolderId(id);
    setSelected([]);
    setFocusedItemId(null);
  };
  const goUp = () => {
    const parentId = findDriveItem(currentFolderId ?? "", allKnownItems)?.parentId ?? null;
    queueWorkspaceLoading();
    setCurrentFolderId(parentId);
    setSelected([]);
    setFocusedItemId(null);
  };
  const openPreview = (id: string) => {
    const item = findDriveItem(id, allKnownItems);
    if (!item) return;
    setSelected([]);
    setFocusedItemId(null);
    router.push(`/preview/${item.id}`);
  };
  const triggerUpload = () => uploadInputRef.current?.click();
  const trackUploadProgress = (progress: UploadDriveFileProgress) => {
    const updatedAt = new Date().toISOString();
    setUploadTelemetry(current => {
      const previous = current[progress.transferId];
      return {
        ...current,
        [progress.transferId]: {
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
        }
      };
    });
  };
  const handleUploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length > 0 && workspaceId) {
      setActiveNav("transfers");
      queueWorkspaceLoading();
      selectedFiles.forEach(file => {
        void uploadDriveFile({
          file,
          onProgress: trackUploadProgress,
          parentNodeId: currentFolderId,
          workspaceActor: uploadActor,
          workspaceId
        }).then(() => {
          void refreshDriveItems();
          void refreshAuditEvents();
          void refreshTransfers();
          void refreshStorageUsage();
          showFeedback(t("app.uploaded"));
        }).catch(() => {
          void refreshTransfers();
          showFeedback(t("app.uploadFailed"), "error");
        });
      });
    }
    event.target.value = "";
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
      <AppHeader filtersActive={filtersActive} brandLogo={brandLogo} locale={locale} onActivity={openActivity} onRefresh={refreshWorkspace} onToggleFilters={toggleFilters} palette={palette} query={query} setQuery={setQuery} siteName={siteSettings.siteName} themeMode={themeMode} setLocale={setLocale} setThemeMode={setThemeMode} openSidebar={() => setSidebarOpen(true)} />

      <div className="drive-main-grid" style={{
      "--drive-grid-columns": showDetailsPanel ? "244px minmax(0, 1fr) 320px" : "244px minmax(0, 1fr)"
    } as React.CSSProperties}>
        <Sidebar activeNav={activeNav} palette={palette} sidebarOpen={sidebarOpen} storageUsage={storageUsage} setActiveNav={id => {
        if (id !== activeNav) queueWorkspaceLoading();
        setActiveNav(id);
        if (id !== "drive") setCurrentFolderId(null);
        setSelected([]);
        setFocusedItemId(null);
        setSidebarOpen(false);
      }} closeSidebar={() => setSidebarOpen(false)} />

        <div className="drive-workspace">
          <div className="drive-workspace-scroll">
              <WorkspaceBar activeNav={activeNav} count={activeModule === "drive" ? filteredFiles.length : null} detailsOpen={showDetailsPanel} folderPath={folderPath} palette={palette} setDetailsOpen={setDetailsOpen} setViewMode={mode => {
            if (mode !== viewMode) queueWorkspaceLoading();
            setViewMode(mode);
          }} triggerUpload={triggerUpload} viewMode={viewMode} />

            <MotionSurface key={`${activeModule}-${currentFolderId ?? "root"}`} preset="surface" aria-busy={workspaceLoading} className="drive-workspace-body">
              {workspaceLoading ? <WorkspaceSkeleton activeModule={activeModule} palette={palette} viewMode={viewMode} /> : <>
                  {activeModule === "drive" ? <FilesModule activeNav={activeNav} currentFolderId={currentFolderId} error={filesError} hasQuery={query.trim().length > 0} items={filteredFiles} onArchiveItem={item => archiveItems([item])} onRestoreItem={item => restoreItems([item])} onCopyItem={item => copyItemsLink([item])} onDownloadItem={item => downloadItems([item])} onShareItem={item => {
                setSelected([item.id]);
                setShareOpen(true);
              }} onSecurityItem={() => showFeedback(t("links.recordsFocused"))} goUp={goUp} locale={locale} openPreview={openPreview} palette={palette} selected={selected} sourceItems={allKnownItems} suggestedItems={driveItems.filter(item => item.parentId === null && getItemKind(item) === "folder").slice(0, 3)} openFolder={openFolder} toggleSelected={toggleSelected} toggleStar={toggleStar} viewMode={viewMode} /> : null}
                  {activeModule === "links" ? <LinksModule error={linksError} links={linkRows} onCloseLink={closeShareLink} onCopyLink={copyShareLink} onFocusRecords={openActivity} palette={palette} sourceItems={allKnownItems} /> : null}
                  {activeModule === "transfers" ? <TransfersModule palette={palette} rows={visibleTransferRows} /> : null}
                  {activeModule === "audit" ? <AuditModule error={auditError} events={auditEvents} onRefresh={refreshAuditEvents} palette={palette} /> : null}
                  {activeModule === "settings" ? <ExternalShareAdminSettingsPanel palette={palette} /> : null}
                </>}
            </MotionSurface>
          </div>
        </div>

        {showDetailsPanel && workspaceLoading ? <DetailsPanelSkeleton palette={palette} /> : null}
        {showDetailsPanel && !workspaceLoading ? <DetailsPanel activeItem={activeItem} focusedItem={focusedItem} currentFolderId={currentFolderId} folderPath={folderPath} selectedItems={selectedItems} onShare={() => setShareOpen(true)} onCopy={() => copyItemsLink(getDetailActionItems({
        currentFolderId,
        focusedItem,
        selectedItems,
        sourceItems: driveItems
      }))} onDownload={() => downloadItems(getDetailActionItems({
        currentFolderId,
        focusedItem,
        selectedItems,
        sourceItems: driveItems
      }))} onSecurity={() => showFeedback(t("links.recordsFocused"))} palette={palette} close={() => setDetailsOpen(false)} sourceItems={allKnownItems} /> : null}
        <div className="drive-footer-slot">
          <LegalFooter locale={locale} palette={palette} />
        </div>
      </div>

      <MotionPresence show={selected.length > 0} preset="toolbar">
        <SelectionToolbar count={selected.length} clearSelection={() => setSelected([])} onArchive={() => archiveItems(selectedItems)} onCopy={() => copyItemsLink(selectedItems)} onDownload={() => downloadItems(selectedItems)} onShare={() => setShareOpen(true)} palette={palette} themeMode={themeMode} />
      </MotionPresence>

      <HiddenFileInput inputRef={uploadInputRef} onChange={handleUploadFiles} />
      <ExternalShareDialog currentDirectoryItems={currentDirectoryItems} currentFolder={currentFolder} onClose={() => setShareOpen(false)} onShareCreated={share => {
      setRegisteredShares(current => [share, ...current.filter(item => item.token !== share.token)]);
      setLinksError(null);
      void refreshShares();
      void refreshAuditEvents();
    }} open={shareOpen} palette={palette} policyLoadError={shareSettingsError} rootTitle={t("nav.drive")} selectedItems={selectedItems} sourceItems={allKnownItems} themeMode={themeMode} workspaceId={workspaceId ?? undefined} workspaceSettings={shareSettings} />
      <MotionPresence show={bootLoading && bootLoadingStage !== null} preset="fade">
        {bootLoadingStage ? <AppLoading label={t(bootLoadingStage === "progress" ? "app.loading" : "app.syncing")} palette={palette} stage={bootLoadingStage} viewMode={viewMode} /> : null}
      </MotionPresence>
    </div>;
}
