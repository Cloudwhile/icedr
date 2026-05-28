"use client";

import { useLocale, useTranslations } from "next-intl";
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
import { MotionSurface } from "@/components/ui/motion";
import { AnimatedCheckMark, ItemIcon, LocalIcon, Surface, ToolButton } from "./drive-primitives";

export type DriveDetailsPanelProps = {
  activeItem?: DriveItem;
  close: () => void;
  currentFolderId: string | null;
  focusedItem?: DriveItem;
  folderPath: DriveItem[];
  onCopy: () => void;
  onDownload: () => void;
  onShare: () => void;
  onSecurity: () => void;
  palette: Palette;
  selectedItems: DriveItem[];
  sourceItems: DriveItem[];
};

export function DetailsPanel({
  activeItem,
  close,
  currentFolderId,
  focusedItem,
  folderPath,
  onCopy,
  onDownload,
  onShare,
  onSecurity,
  palette,
  selectedItems,
  sourceItems,
}: DriveDetailsPanelProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const multiSelect = selectedItems.length > 1;
  const currentFolder = folderPath.at(-1);
  const currentDirectoryItems = getChildItems(currentFolderId, sourceItems);
  const displayItem = activeItem ?? focusedItem;
  const detailItems = selectedItems.length > 0 ? selectedItems : displayItem ? [displayItem] : currentDirectoryItems;
  const displayName =
    selectedItems.length > 0
      ? multiSelect
        ? t("app.selected", { count: selectedItems.length })
        : selectedItems[0].name
      : displayItem?.name ?? currentFolder?.name ?? t("nav.drive");
  const displayType =
    selectedItems.length > 0 && multiSelect
      ? selectedItems.map((item) => item.name).slice(0, 3).join(", ")
      : displayItem
        ? t(`files.kind.${getItemKind(displayItem)}`)
        : t("files.kind.folder");
  const selectedSize = formatFileSize(sumDriveItemSizes(detailItems, sourceItems), locale);
  const owner = displayItem?.owner ?? currentFolder?.owner ?? "--";
  const shared = displayItem?.shared ?? currentFolder?.shared;

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

        <div className="drive-details-body">
          <Surface
            palette={palette}
            className="drive-details-preview"
          >
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
          </Surface>

          <div className="drive-details-title-block">
            <span
              className="drive-details-title"
            >
              {displayName}
            </span>
            <span className="drive-details-subtitle">
              {displayType}
            </span>
          </div>

          <hr className="drive-details-separator" />

          <div className="drive-details-list">
            {[
              [t("files.owner"), owner],
              [
                t("files.modified"),
                displayItem
                  ? formatDriveItemModified(displayItem, locale)
                  : currentFolder
                    ? formatDriveItemModified(currentFolder, locale)
                    : "--",
              ],
              [t("files.size"), selectedSize],
              [
                t("files.shared"),
                multiSelect ? `${selectedItems.filter((item) => item.shared).length}/${selectedItems.length}` : shared ? t("files.yes") : t("files.no"),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>

          <hr className="drive-details-separator" />

          <div className="drive-details-actions">
            <ToolButton label={t("actions.share")} palette={palette} onClick={onShare}>
              <LocalIcon name="share2" size={17} />
            </ToolButton>
            <ToolButton label={t("actions.copyLink")} palette={palette} onClick={onCopy}>
              <LocalIcon name="link" size={17} />
            </ToolButton>
            <ToolButton label={t("actions.download")} palette={palette} onClick={onDownload}>
              <LocalIcon name="download" size={17} />
            </ToolButton>
            <ToolButton label={t("actions.security")} palette={palette} onClick={onSecurity}>
              <LocalIcon name="shield" size={17} />
            </ToolButton>
          </div>
        </div>
      </div>
    </MotionSurface>
  );
}
