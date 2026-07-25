"use client";

import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
import {
  formatDriveItemModified,
  formatFileSize,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import type { RegisteredShare } from "@/features/share/registry";
import { useTimeZone, useTranslations } from "@/i18n/react";
import { useCallback, useMemo, type CSSProperties, type RefObject } from "react";
import { ItemIcon, LocalIcon, StatusPill, Surface, ToolButton } from "./drive-primitives";

const buttonTypeAttr: {
  type?: "button";
} = {
  type: "button",
};

export function VisitorShareBrowser({
  activeItemId,
  allowDownload,
  allowPreview,
  collectionTitle,
  currentFolder,
  folderId,
  goUp,
  locale,
  onDownloadItem,
  onOpenFolder,
  onPreviewItem,
  palette,
  registeredShare,
  sourceItems,
  totalItems,
  visibleItems,
  visibleListRef,
}: {
  activeItemId: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  collectionTitle: string;
  currentFolder?: DriveItem;
  folderId: string | null;
  goUp: () => void;
  locale: Locale;
  onDownloadItem: (item: DriveItem) => void;
  onOpenFolder: (id: string) => void;
  onPreviewItem: (item: DriveItem) => void;
  palette: Palette;
  registeredShare: RegisteredShare;
  sourceItems: DriveItem[];
  totalItems: number;
  visibleItems: DriveItem[];
  visibleListRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  const memberById = useMemo(
    () => new Map((registeredShare.items ?? []).map((item) => [item.id, item])),
    [registeredShare.items],
  );
  const canOpenFolder = useCallback(
    (item: DriveItem) =>
      getItemKind(item) === "folder" &&
      memberById.get(item.id)?.availability !== "archived" &&
      memberById.get(item.id)?.availability !== "missing" &&
      memberById.get(item.id)?.availability !== "out-of-scope",
    [memberById],
  );
  const firstBrowsableFolder = !folderId ? visibleItems.find(canOpenFolder) ?? null : null;
  const showFooterAction = !folderId && totalItems > visibleItems.length;

  return (
    <Surface
      palette={palette}
      className="icedr-r-min-height external-share-browser"
      style={{
        overflow: "hidden",
        flex: "0 0 auto",
        "--r-min-height-base": "360px",
        "--r-min-height-lg": "0px",
      } as CSSProperties}
    >
      <div
        className="external-share-browser-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "52px",
          paddingInline: "16px",
          borderBottomWidth: "1px",
          borderColor: palette.hairline,
        }}
      >
        <div
          className="external-share-browser-heading"
          style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            minWidth: "0px",
          }}
        >
          {folderId ? (
            <ToolButton label={t("app.up")} palette={palette} onClick={goUp}>
              <LocalIcon name="arrow_up" size={16} />
            </ToolButton>
          ) : null}
          <div className="external-share-browser-title-stack">
            <span className="external-share-browser-title icedr-truncate">{t("share.contentPreview")}</span>
            <span className="external-share-browser-subtitle icedr-truncate">
              {currentFolder?.name ?? collectionTitle}
            </span>
          </div>
        </div>
        <StatusPill palette={palette}>{t("share.itemCountValue", { count: totalItems })}</StatusPill>
      </div>

      {visibleItems.length === 0 ? (
        <div
          className="external-share-browser-empty"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            minHeight: "300px",
            color: palette.subtle,
          }}
        >
          <LocalIcon name="folder" size={28} />
          <span style={{ fontWeight: "600" }}>{t("files.emptyTitle")}</span>
        </div>
      ) : (
        <div
          ref={visibleListRef}
          className="external-share-browser-list"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0px",
          }}
        >
          <div className="external-share-browser-table-head" aria-hidden="true">
            <span>{t("files.name")}</span>
            <span>{t("files.size")}</span>
            <span>{t("files.type")}</span>
            <span />
          </div>
          {visibleItems.map((item) => {
            const isFolder = getItemKind(item) === "folder";
            const member = memberById.get(item.id);
            const available = !member || member.availability === "available";
            const canOpen = canOpenFolder(item);
            const isActive = activeItemId === item.id;

            return (
              <div
                key={item.id}
                data-motion-row
                className="icedr-has-hover external-share-file-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  paddingInline: "16px",
                  paddingBlock: "12px",
                  minHeight: "64px",
                  textAlign: "left",
                  borderBottomWidth: "1px",
                  borderColor: palette.hairline,
                  background: "transparent",
                  boxShadow: isActive ? `inset 2px 0 0 ${palette.primary}` : "none",
                  transition:
                    "background-color var(--motion-base) var(--motion-ease), box-shadow var(--motion-base) var(--motion-ease)",
                  "--hover-bg": "transparent",
                  "--hover-box-shadow": `inset 2px 0 0 ${palette.primary}`,
                } as CSSProperties}
              >
                <div
                  className="external-share-file-primary"
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "12px",
                    minWidth: "0px",
                    flex: "1 1 auto",
                  }}
                >
                  <ItemIcon item={item} palette={palette} size={20} />
                  <div
                    {...(canOpen ? buttonTypeAttr : {})}
                    onClick={canOpen ? () => onOpenFolder(item.id) : undefined}
                    style={{
                      minWidth: "0px",
                      flex: "1 1 auto",
                      textAlign: "left",
                      transition: "color var(--motion-fast) var(--motion-ease)",
                    } as CSSProperties}
                  >
                    <div
                      style={{
                        alignItems: "center",
                        display: "flex",
                        gap: "8px",
                        minWidth: "0px",
                      }}
                    >
                      <span
                        className="icedr-truncate"
                        style={{
                          color: "inherit",
                          fontWeight: "500",
                        }}
                      >
                        {item.name}
                      </span>
                      {isFolder ? <LocalIcon name="arrow_right" size={14} color={palette.subtle} /> : null}
                      {member && member.availability !== "available" ? (
                        <StatusPill palette={palette} tone="risk">
                          {t(`share.memberStatus.${member.availability}`)}
                        </StatusPill>
                      ) : member?.changes.length ? (
                        <StatusPill palette={palette} tone="accent">
                          {t(`share.memberChange.${member.changes[0]}`)}
                        </StatusPill>
                      ) : null}
                    </div>
                    <div
                      style={{
                        alignItems: "center",
                        display: "flex",
                        gap: "8px",
                        marginTop: "4px",
                        color: palette.subtle,
                        fontSize: "12px",
                      }}
                    >
                      <span>{t(`files.kind.${getItemKind(item)}`)}</span>
                      <span>/</span>
                      <span>{formatDriveItemModified(item, locale, timeZone)}</span>
                    </div>
                  </div>
                </div>

                <span className="external-share-file-size">
                  {formatFileSize(sumDriveItemSizes([item], sourceItems), locale)}
                </span>
                <span className="external-share-file-type icedr-truncate">
                  {t(`files.kind.${getItemKind(item)}`)}
                </span>
                <div
                  className="external-share-file-actions"
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "8px",
                    marginLeft: "12px",
                    flexShrink: "0",
                  }}
                >
                  {isFolder ? (
                    <ToolButton
                      label={canOpen ? t("actions.open") : t("share.unavailable")}
                      palette={palette}
                      disabled={!canOpen}
                      onClick={() => canOpen && onOpenFolder(item.id)}
                    >
                      <LocalIcon name="folder" size={16} />
                    </ToolButton>
                  ) : (
                    <>
                      <ToolButton
                        label={allowPreview && available ? t("share.openPreview") : t("preview.unsupportedHint")}
                        palette={palette}
                        disabled={!allowPreview || !available}
                        onClick={() => onPreviewItem(item)}
                      >
                        <LocalIcon name="visible" size={16} />
                      </ToolButton>
                      <VisitorActionsMenu
                        allowDownload={allowDownload}
                        allowPreview={allowPreview}
                        available={available}
                        item={item}
                        onDownloadItem={onDownloadItem}
                        onPreviewItem={onPreviewItem}
                        palette={palette}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {showFooterAction ? (
            <button
              className="external-share-browser-footer"
              type="button"
              disabled={!firstBrowsableFolder}
              onClick={() => firstBrowsableFolder && onOpenFolder(firstBrowsableFolder.id)}
            >
              <span>{t("share.viewAllItems", { count: totalItems })}</span>
              <LocalIcon name="arrow_down" size={15} />
            </button>
          ) : null}
        </div>
      )}
    </Surface>
  );
}

function VisitorActionsMenu({
  allowDownload,
  allowPreview,
  available,
  item,
  onDownloadItem,
  onPreviewItem,
  palette,
}: {
  allowDownload: boolean;
  allowPreview: boolean;
  available: boolean;
  item: DriveItem;
  onDownloadItem: (item: DriveItem) => void;
  onPreviewItem: (item: DriveItem) => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const actionItems: AppMenuItem[] = [
    {
      disabled: !allowPreview || !available,
      icon: <LocalIcon name="visible" size={15} />,
      label: t("share.openPreview"),
      onClick: () => allowPreview && available && onPreviewItem(item),
      value: "preview",
    },
    {
      disabled: !allowDownload || !available,
      icon: <LocalIcon name="download" size={15} />,
      label: allowDownload ? t("actions.download") : t("share.downloadBlocked"),
      onClick: () => allowDownload && available && onDownloadItem(item),
      value: "download",
    },
  ];

  return (
    <ActionMenu ariaLabel={t("actions.more")} items={actionItems} palette={palette}>
      <button
        {...buttonTypeAttr}
        aria-label={t("actions.more")}
        className="icedr-tool-button icedr-file-menu-trigger icedr-has-hover icedr-has-active icedr-has-focus-visible"
        style={{
          "--tool-color": palette.subtle,
          "--tool-focus": palette.focusRing,
          "--tool-hover-bg": palette.surface2,
          "--tool-hover-border": palette.hairline,
          "--tool-hover-color": palette.ink,
          "--active-transform": "scale(0.96)",
          "--focus-visible-outline": "2px solid",
          "--focus-visible-outline-color": palette.focusRing,
          "--focus-visible-outline-offset": "2px",
        } as CSSProperties}
      >
        <LocalIcon name="menu7" size={16} />
      </button>
    </ActionMenu>
  );
}
