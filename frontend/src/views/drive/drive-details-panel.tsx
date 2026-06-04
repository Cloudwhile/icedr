"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useState } from "react";
import {
  formatDriveItemModified,
  formatFileSize,
  getChildItems,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { downloadWorkspaceFileVersion } from "@/features/file/actions";
import { fetchFileVersions, restoreFileVersion, type FileVersionResponse } from "@/lib/drive-api";
import { MotionList, MotionSurface } from "@/components/ui/motion";
import { AnimatedCheckMark, ItemIcon, LocalIcon, ToolButton } from "./drive-primitives";

export type DriveDetailsPanelProps = {
  activeItem?: DriveItem;
  close: () => void;
  currentFolderId: string | null;
  focusedItem?: DriveItem;
  folderPath: DriveItem[];
  palette: Palette;
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
  onVersionRestored,
  palette,
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
  const detailItems = focusedItem ? [focusedItem] : selectedItems.length > 0 ? selectedItems : displayItem ? [displayItem] : currentDirectoryItems;
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
        : t("files.kind.folder");
  const selectedSize = formatFileSize(sumDriveItemSizes(detailItems, sourceItems), locale);
  const owner = displayItem?.owner ?? currentFolder?.owner ?? "--";
  const shared = displayItem?.shared ?? currentFolder?.shared;
  const versionItem = !multiSelect && displayItem?.objectKey && !displayItem.archivedAt ? displayItem : null;
  const [versionState, setVersionState] = useState<{ itemId: string | null; versions: FileVersionResponse[] }>({
    itemId: null,
    versions: [],
  });
  const [versionError, setVersionError] = useState<string | null>(null);
  const versions = versionState.itemId === versionItem?.id ? versionState.versions : [];

  const loadVersions = useCallback((itemId: string, isCancelled: () => boolean = () => false) => {
    void fetchFileVersions(itemId).then((items) => {
      if (!isCancelled()) {
        setVersionState({ itemId, versions: items });
        setVersionError(null);
      }
    }).catch(() => {
      if (!isCancelled()) {
        setVersionState({ itemId, versions: [] });
        setVersionError(t("files.versionsLoadFailed"));
      }
    });
  }, [t]);

  useEffect(() => {
    if (!versionItem) {
      return;
    }
    let cancelled = false;
    loadVersions(versionItem.id, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadVersions, versionItem]);

  const downloadVersion = (version: FileVersionResponse) => {
    if (!versionItem) return;
    void downloadWorkspaceFileVersion(versionItem, version.id).catch(() => setVersionError(t("share.downloadFailed")));
  };

  const restoreVersion = (version: FileVersionResponse) => {
    if (!versionItem) return;
    void restoreFileVersion(versionItem.id, version.id).then(() => {
      onVersionRestored?.();
      loadVersions(versionItem.id);
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
          <span>{t("app.details")}</span>
          <ToolButton label={t("app.close")} palette={palette} onClick={close}>
            <LocalIcon name="cross" size={17} />
          </ToolButton>
        </div>

        <MotionList className="drive-details-body" preset="list">
          <div data-motion-row className="drive-details-preview">
            {multiSelect ? (
              <div
                aria-hidden="true"
                style={{
                  alignItems: "center",
                  color: palette.primaryHover,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <AnimatedCheckMark size={44} strokeWidth={2.1} />
              </div>
            ) : displayItem || currentFolder ? (
              <ItemIcon item={(displayItem ?? currentFolder) as DriveItem} palette={palette} size={44} />
            ) : (
              <LocalIcon name="file" size={44} color={palette.primaryHover} />
            )}
          </div>

          <div className="drive-details-title-block" data-motion-row>
            <span className="drive-details-kicker">{t("app.details")}</span>
            <span
              className="drive-details-title"
            >
              {displayName}
            </span>
            <span className="drive-details-subtitle">
              {displayType}
            </span>
          </div>

          <div className="drive-details-list" data-motion-row>
            {[
              [t("files.owner"), owner],
              [
                t("files.modified"),
                displayItem
                  ? formatDriveItemModified(displayItem, locale, timeZone)
                  : currentFolder
                    ? formatDriveItemModified(currentFolder, locale, timeZone)
                    : "--",
              ],
              [t("files.size"), selectedSize],
              [
                t("files.shared"),
                multiSelect ? `${selectedItems.filter((item) => item.shared).length}/${selectedItems.length}` : shared ? t("files.yes") : t("files.no"),
              ],
              ...(displayItem?.originalPath ? [[t("files.originalPath"), displayItem.originalPath]] : []),
              ...(displayItem?.archivedAt ? [[t("files.deletedAt"), formatDriveItemModified({ ...displayItem, modifiedAt: displayItem.archivedAt }, locale, timeZone)]] : []),
              ...(displayItem?.archivedBy ? [[t("files.deletedBy"), displayItem.archivedBy]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>

          {versionItem ? (
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
          ) : null}
        </MotionList>
      </div>
    </MotionSurface>
  );
}
