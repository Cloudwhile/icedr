"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { useEffect, useState } from "react";
import {
  formatDriveItemModified,
  formatFileSize,
  getChildItems,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
  getItemExtension,
} from "@/features/file/model";
import { downloadWorkspaceFileVersion } from "@/features/file/actions";
import { fetchFileVersions, restoreFileVersion, type FileVersionResponse } from "@/lib/drive-api";
import { AppMenu, type AppMenuItem } from "@/components/ui/app-menu";
import { DriveItemPreview } from "@/components/ui/drive-item-preview";
import { MotionList, MotionSurface } from "@/components/ui/motion";
import { AnimatedCheckMark, ItemIcon, LocalIcon, ToolButton } from "./drive-primitives";

type DetailsPanelTab = "details" | "share" | "versions";

export type DriveDetailsPanelProps = {
  activeItem?: DriveItem;
  close: () => void;
  currentFolderId: string | null;
  focusedItem?: DriveItem;
  folderPath: DriveItem[];
  onDownloadItems?: (items: DriveItem[]) => void;
  onPreviewItem?: (item: DriveItem) => void;
  onShareItems?: (items: DriveItem[]) => void;
  palette: Palette;
  quickActionMenuItems?: AppMenuItem[];
  onVersionRestored?: () => void;
  selectedItems: DriveItem[];
  sourceItems: DriveItem[];
};

export function DetailsPanel({
  activeItem,
  close,
  currentFolderId,
  focusedItem,
  folderPath,
  onDownloadItems,
  onPreviewItem,
  onShareItems,
  onVersionRestored,
  palette,
  quickActionMenuItems = [],
  selectedItems,
  sourceItems,
}: DriveDetailsPanelProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const multiSelect = !focusedItem && selectedItems.length > 1;
  const currentFolder = folderPath.at(-1);
  const currentDirectoryItems = getChildItems(currentFolderId, sourceItems);
  const displayItem = focusedItem ?? activeItem;
  const showingDirectorySummary = !focusedItem && selectedItems.length === 0 && !displayItem;
  const detailItems = focusedItem ? [focusedItem] : selectedItems.length > 0 ? selectedItems : displayItem ? [displayItem] : currentDirectoryItems;
  const directoryFolderCount = currentDirectoryItems.filter((item) => getItemKind(item) === "folder").length;
  const directoryFileCount = Math.max(0, currentDirectoryItems.length - directoryFolderCount);
  const displayName =
    focusedItem
      ? focusedItem.name
      : selectedItems.length > 0
      ? multiSelect
        ? t("app.selected", { count: selectedItems.length })
        : selectedItems[0].name
      : displayItem?.name ?? currentFolder?.name ?? t("nav.drive");
  const displayType =
    focusedItem
      ? t(`files.kind.${getItemKind(focusedItem)}`)
      : selectedItems.length > 0 && multiSelect
      ? selectedItems.map((item) => item.name).slice(0, 3).join(", ")
      : displayItem
        ? t(`files.kind.${getItemKind(displayItem)}`)
        : `${t("settings.fileCount")} ${directoryFileCount} / ${t("settings.folderCount")} ${directoryFolderCount}`;
  const selectedSize = formatFileSize(sumDriveItemSizes(detailItems, sourceItems), locale);
  const owner = displayItem?.owner ?? currentFolder?.owner ?? "--";
  const shared = displayItem?.shared ?? currentFolder?.shared;
  const versionItem = !multiSelect && displayItem?.objectKey && !displayItem.archivedAt ? displayItem : null;
  const quickActionItem = !multiSelect ? displayItem ?? currentFolder : null;
  const quickActionItems = selectedItems.length > 0 ? selectedItems : quickActionItem ? [quickActionItem] : [];
  const canPreview = Boolean(quickActionItem && getItemKind(quickActionItem) !== "folder" && onPreviewItem);
  const canShare = quickActionItems.length > 0 && Boolean(onShareItems);
  const canDownload = quickActionItems.length > 0 && Boolean(onDownloadItems);
  const [versionState, setVersionState] = useState<{ itemId: string | null; versions: FileVersionResponse[] }>({
    itemId: null,
    versions: [],
  });
  const [versionError, setVersionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailsPanelTab>("details");
  const versions = versionState.itemId === versionItem?.id ? versionState.versions : [];
  const extension = displayItem ? getItemExtension(displayItem) : "";
  const detailRows = showingDirectorySummary
    ? [
        [t("settings.fileCount"), String(directoryFileCount)],
        [t("settings.folderCount"), String(directoryFolderCount)],
        [t("files.size"), selectedSize],
        [t("files.shared"), String(currentDirectoryItems.filter((item) => item.shared).length)],
      ]
    : [
        [t("files.owner"), owner],
        [
          t("files.modified"),
          displayItem
            ? formatDriveItemModified(displayItem, locale, timeZone)
            : currentFolder
              ? formatDriveItemModified(currentFolder, locale, timeZone)
              : "--",
        ],
        ...(displayItem?.createdAt ? [[t("preview.createdAt"), formatDriveItemModified({ ...displayItem, modifiedAt: displayItem.createdAt }, locale, timeZone)]] : []),
        [t("files.size"), selectedSize],
        ...(displayItem?.mimeType ? [[t("preview.mimeType"), displayItem.mimeType]] : []),
        ...(extension ? [[t("preview.extension"), extension.toUpperCase()]] : []),
        ...(typeof displayItem?.sizeBytes === "number" ? [[t("preview.sizeBytes"), new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale.replace(/_/g, "-")).format(displayItem.sizeBytes)]] : []),
        [
          t("files.shared"),
          multiSelect ? `${selectedItems.filter((item) => item.shared).length}/${selectedItems.length}` : shared ? t("files.yes") : t("files.no"),
        ],
        ...(displayItem?.originalPath ? [[t("files.originalPath"), displayItem.originalPath]] : []),
        ...(displayItem?.archivedAt ? [[t("files.deletedAt"), formatDriveItemModified({ ...displayItem, modifiedAt: displayItem.archivedAt }, locale, timeZone)]] : []),
        ...(displayItem?.archivedBy ? [[t("files.deletedBy"), displayItem.archivedBy]] : []),
      ];
  const shareRows = [
    [t("files.shared"), multiSelect ? `${selectedItems.filter((item) => item.shared).length}/${selectedItems.length}` : shared ? t("files.yes") : t("files.no")],
    [t("files.owner"), owner],
    [t("files.size"), selectedSize],
  ];

  useEffect(() => {
    if (!versionItem) {
      return;
    }
    let cancelled = false;
    void fetchFileVersions(versionItem.id).then((items) => {
      if (!cancelled) {
        setVersionState({ itemId: versionItem.id, versions: items });
        setVersionError(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setVersionState({ itemId: versionItem.id, versions: [] });
        setVersionError(t("files.versionsLoadFailed"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [t, versionItem]);

  const downloadVersion = (version: FileVersionResponse) => {
    if (!versionItem) return;
    void downloadWorkspaceFileVersion(versionItem, version.id).catch(() => setVersionError(t("share.downloadFailed")));
  };

  const restoreVersion = (version: FileVersionResponse) => {
    if (!versionItem) return;
    void restoreFileVersion(versionItem.id, version.id).then(() => {
      onVersionRestored?.();
      return fetchFileVersions(versionItem.id);
    }).then((items) => {
      setVersionState({ itemId: versionItem.id, versions: items });
      setVersionError(null);
    }).catch(() => setVersionError(t("files.restoreVersionFailed")));
  };
  const formatVersionDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale.replace(/_/g, "-"), {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  };

  return (
    <MotionSurface
      key={`${displayName}-${selectedSize}`}
      preset="panel-right"
      className="drive-details-panel"
    >
      <div className="drive-details-inner">
        <div className="drive-details-header">
          <div className="drive-details-heading">
            <span className="drive-details-heading-icon" aria-hidden="true">
              {multiSelect ? (
                <AnimatedCheckMark size={16} strokeWidth={2.3} />
              ) : displayItem || currentFolder ? (
                <ItemIcon item={(displayItem ?? currentFolder) as DriveItem} palette={palette} size={17} />
              ) : (
                <LocalIcon name="folder" size={17} color={palette.primaryHover} />
              )}
            </span>
            <span className="icedr-truncate">{displayName}</span>
          </div>
          <ToolButton label={t("app.close")} palette={palette} onClick={close}>
            <LocalIcon name="cross" size={17} />
          </ToolButton>
        </div>

        <MotionList className="drive-details-body" preset="list">
          <div className="drive-details-tabs" role="tablist" aria-label={displayName}>
            <button type="button" role="tab" aria-selected={activeTab === "details"} data-active={activeTab === "details" ? "true" : undefined} onClick={() => setActiveTab("details")}>{t("app.details")}</button>
            <button type="button" role="tab" aria-selected={activeTab === "share"} data-active={activeTab === "share" ? "true" : undefined} onClick={() => setActiveTab("share")}>{t("actions.share")}</button>
            <button type="button" role="tab" aria-selected={activeTab === "versions"} data-active={activeTab === "versions" ? "true" : undefined} onClick={() => setActiveTab("versions")}>{t("files.versions")}</button>
          </div>

          {activeTab === "details" ? (
            <>
              <div data-motion-row className="drive-details-preview">
                {multiSelect ? (
                  <div
                    className="drive-details-preview-fallback"
                    aria-hidden="true"
                  >
                    <AnimatedCheckMark size={44} strokeWidth={2.1} />
                  </div>
                ) : displayItem || currentFolder ? (
                  <DriveItemPreview
                    className="drive-details-preview-frame"
                    iconSize={56}
                    item={(displayItem ?? currentFolder) as DriveItem}
                    palette={palette}
                  />
                ) : null}
              </div>

              {multiSelect || showingDirectorySummary ? (
                <div className="drive-details-title-block" data-motion-row>
                  <span className="drive-details-title">
                    {displayName}
                  </span>
                  <span className="drive-details-subtitle">
                    {displayType}
                  </span>
                </div>
              ) : null}

              <div className="drive-details-section-title" data-motion-row>
                <span>{t("share.quickFacts")}</span>
              </div>
              <div className="drive-details-list" data-motion-row>
                {detailRows.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {activeTab === "share" ? (
            <>
              <div className="drive-details-section-title" data-motion-row>
                <span>{t("share.quickFacts")}</span>
              </div>
              <div className="drive-details-list" data-motion-row>
                {shareRows.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {activeTab !== "versions" ? (
            <>
              <div className="drive-details-section-title" data-motion-row>
                <span>{t("settings.quickActions")}</span>
              </div>
              <div className="drive-details-quick-actions" data-motion-row>
                <ToolButton disabled={!canPreview} label={t("preview.title")} palette={palette} visual="surface" onClick={() => quickActionItem && onPreviewItem?.(quickActionItem)}>
                  <LocalIcon name="visible" size={17} />
                </ToolButton>
                <ToolButton disabled={!canDownload} label={t("actions.download")} palette={palette} visual="surface" onClick={() => onDownloadItems?.(quickActionItems)}>
                  <LocalIcon name="download" size={17} />
                </ToolButton>
                <ToolButton disabled={!canShare} label={t("actions.share")} palette={palette} visual="surface" onClick={() => onShareItems?.(quickActionItems)}>
                  <LocalIcon name="share2" size={17} />
                </ToolButton>
                <AppMenu ariaLabel={t("actions.more")} items={quickActionMenuItems} palette={palette}>
                  <button
                    aria-label={t("actions.more")}
                    className="icedr-tool-button icedr-tool-button-md icedr-tool-button-surface drive-details-more-trigger"
                    type="button"
                  >
                    <LocalIcon name="menu7" size={17} />
                  </button>
                </AppMenu>
              </div>
            </>
          ) : null}

          {activeTab === "versions" && versionItem ? (
            <div className="drive-version-list" data-motion-row>
              <div className="drive-version-list-header">
                <span>{t("files.versions")}</span>
                <span>{versions.length}</span>
              </div>
              {versionError ? <span className="drive-version-error">{versionError}</span> : null}
              {versions.length === 0 && !versionError ? <span className="drive-version-empty">{t("files.noVersions")}</span> : null}
              {versions.map((version) => (
                <div key={version.id} className="drive-version-row">
                  <div className="drive-version-meta">
                    <span>{t("files.versionNumber", { number: version.versionNumber })}</span>
                    <span>{formatFileSize(version.sizeBytes, locale)} · {formatVersionDate(version.createdAt)}</span>
                    {version.uploadedBy ? <span>{version.uploadedBy}</span> : null}
                    {version.remark ? <span>{version.remark}</span> : null}
                  </div>
                  <div className="drive-version-actions">
                    <ToolButton label={t("actions.download")} palette={palette} size="sm" onClick={() => downloadVersion(version)}>
                      <LocalIcon name="download" size={15} />
                    </ToolButton>
                    <ToolButton label={t("actions.restore")} palette={palette} size="sm" onClick={() => restoreVersion(version)}>
                      <LocalIcon name="refresh" size={15} />
                    </ToolButton>
                  </div>
                </div>
              ))}
            </div>
          ) : activeTab === "versions" ? (
            <div className="drive-version-list" data-motion-row>
              <div className="drive-version-list-header">
                <span>{t("files.versions")}</span>
                <span>0</span>
              </div>
              <span className="drive-version-empty">{t("files.noVersions")}</span>
            </div>
          ) : null}
        </MotionList>
      </div>
    </MotionSurface>
  );
}
