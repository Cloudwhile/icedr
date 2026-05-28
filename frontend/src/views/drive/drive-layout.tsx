"use client";

import { Avatar, Input } from "@heroui/react";
import { useLocale, useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import { MotionPresence, MotionSurface } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { SegmentedToolGroup } from "@/components/ui/segmented-tool-group";
import { AppImage } from "@/components/ui/app-image";
import { formatFileSize, navItems, type DriveItem, type Locale, type LocalIconName, type Palette, type ThemeMode } from "@/features/file/model";
import type { StorageUsage } from "@/lib/drive-api";
import { ThemeLanguageActions } from "./drive-shell";
import { AnimatedCheckMark, LocalIcon, ToolButton } from "./drive-primitives";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

export type DriveViewMode = "list" | "grid";

export type DriveHeaderProps = {
  brandLogo: string;
  filtersActive: boolean;
  locale: Locale;
  onActivity: () => void;
  onRefresh: () => void;
  onToggleFilters: () => void;
  openSidebar: () => void;
  palette: Palette;
  query: string;
  setLocale: Dispatch<SetStateAction<Locale>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  siteName: string;
  themeMode: ThemeMode;
};

export function AppHeader({
  brandLogo,
  filtersActive,
  locale,
  onActivity,
  onRefresh,
  onToggleFilters,
  openSidebar,
  palette,
  query,
  setLocale,
  setQuery,
  setThemeMode,
  siteName,
  themeMode,
}: DriveHeaderProps) {
  const t = useTranslations();

  return (
    <header className="drive-header">
      <div className="drive-header-brand">
        <div className="drive-mobile-only">
          <ToolButton label={t("app.menu")} palette={palette} onClick={openSidebar}>
            <LocalIcon name="menu" size={17} />
          </ToolButton>
        </div>
        <AppImage
          src={brandLogo}
          alt={siteName}
          height={28}
          width={28}
          className="drive-brand-logo"
        />
        <span className="drive-brand-name icedr-truncate">{siteName}</span>
      </div>

      <div className="drive-header-search-wrap">
        <div className="drive-search">
          <LocalIcon name="search" size={17} color={palette.subtle} />
          <Input
            aria-label={t("app.search")}
            placeholder={t("app.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="drive-search-input icedr-has-placeholder"
            style={{
              "--placeholder-color": palette.tertiary,
            } as React.CSSProperties}
            variant="secondary"
          />
          {query ? (
            <ToolButton label={t("app.searchClear")} palette={palette} size="sm" onClick={() => setQuery("")}>
              <LocalIcon name="cross" size={15} />
            </ToolButton>
          ) : (
            <ToolButton label={t("app.filter")} active={filtersActive} palette={palette} size="sm" onClick={onToggleFilters}>
              <LocalIcon name="slider" size={15} />
            </ToolButton>
          )}
        </div>
      </div>

      <div className="drive-header-actions">
        <div className="drive-header-secondary">
          <ToolButton label={t("app.refresh")} palette={palette} onClick={onRefresh}>
            <LocalIcon name="refresh" size={17} />
          </ToolButton>
          <ToolButton label={t("app.activity")} palette={palette} onClick={onActivity}>
            <LocalIcon name="notification" size={17} />
          </ToolButton>
        </div>

        <ThemeLanguageActions locale={locale} palette={palette} setLocale={setLocale} setThemeMode={setThemeMode} themeMode={themeMode} />

        <Avatar size="sm" className="drive-user-avatar">
          <Avatar.Fallback className="drive-user-avatar-fallback">
            <LocalIcon name="user_avatar" size={20} color={palette.primaryHover} />
          </Avatar.Fallback>
        </Avatar>
      </div>
    </header>
  );
}

export type DriveSidebarProps = {
  activeNav: string;
  closeSidebar: () => void;
  palette: Palette;
  setActiveNav: (id: string) => void;
  sidebarOpen: boolean;
  storageUsage: StorageUsage | null;
};

export function Sidebar({ activeNav, closeSidebar, palette, setActiveNav, sidebarOpen, storageUsage }: DriveSidebarProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const storageLabel = storageUsage?.quotaBytes
    ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${formatFileSize(storageUsage.quotaBytes, locale)}`
    : storageUsage
      ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${storageUsage.fileCount} files`
      : t("app.storageUsage");

  const navList = (
    <div className="drive-sidebar-nav">
      <div className="drive-sidebar-section">
        {navItems.map((item) => (
          <SidebarNavButton
            key={item.id}
            active={activeNav === item.id}
            icon={item.icon}
            label={t(`nav.${item.id}`)}
            onClick={() => setActiveNav(item.id)}
          />
        ))}
      </div>

      <div className="drive-sidebar-separator" />

      <div className="drive-sidebar-section">
        <SidebarNavButton active={activeNav === "settings"} icon="settings" label={t("app.settings")} onClick={() => setActiveNav("settings")} />
      </div>

      <div className="drive-sidebar-storage">
        <div className="drive-sidebar-storage-header">
          <span>{t("app.storage")}</span>
          <LocalIcon name="file" size={15} color={palette.subtle} />
        </div>
        <ProgressMeter ariaLabel={t("app.storage")} palette={palette} value={storageUsage?.usagePercent ?? 0} />
        <span className="drive-sidebar-storage-meta">{storageLabel}</span>
      </div>
    </div>
  );

  return (
    <>
      <aside className="drive-sidebar">
        {navList}
      </aside>

      <MotionPresence show={sidebarOpen} preset="fade" className="drive-mobile-sidebar">
        <button
          {...buttonTypeAttr}
          aria-label={t("app.close")}
          className="drive-mobile-sidebar-backdrop"
          onClick={closeSidebar}
        />
        <MobileSidebarPanel>
          <div className="drive-mobile-sidebar-header">
            <span className="drive-mobile-sidebar-title">{t("app.name")}</span>
            <ToolButton label={t("app.close")} palette={palette} onClick={closeSidebar}>
              <LocalIcon name="cross" size={17} />
            </ToolButton>
          </div>
          {navList}
        </MobileSidebarPanel>
      </MotionPresence>
    </>
  );
}

function MobileSidebarPanel({ children }: { children: React.ReactNode }) {
  return (
    <MotionSurface preset="panel-left" className="drive-mobile-sidebar-panel">
      {children}
    </MotionSurface>
  );
}

function SidebarNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LocalIconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      {...buttonTypeAttr}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className="drive-sidebar-item"
      data-active={active ? "true" : undefined}
    >
      <LocalIcon name={icon} size={17} />
      <span className="icedr-truncate">{label}</span>
    </button>
  );
}

export type WorkspaceBarProps = {
  activeNav: string;
  count: number | null;
  detailsOpen: boolean;
  folderPath: DriveItem[];
  palette: Palette;
  setDetailsOpen: Dispatch<SetStateAction<boolean>>;
  setViewMode: Dispatch<SetStateAction<DriveViewMode>>;
  triggerUpload: () => void;
  viewMode: DriveViewMode;
};

export function WorkspaceBar({
  activeNav,
  count,
  detailsOpen,
  folderPath,
  palette,
  setDetailsOpen,
  setViewMode,
  triggerUpload,
  viewMode,
}: WorkspaceBarProps) {
  const t = useTranslations();
  const isSettingsView = activeNav === "settings";
  const isDriveView = !["links", "transfers", "audit", "settings"].includes(activeNav);
  const activeLabel = isSettingsView ? t("app.settings") : isDriveView ? t("nav.drive") : t(`nav.${activeNav}`);
  const title = isSettingsView ? t("admin.title") : isDriveView ? folderPath.at(-1)?.name ?? t("nav.drive") : t(`nav.${activeNav}`);

  return (
    <div className="drive-workspace-bar">
      <div className="drive-workspace-context">
        <div className="drive-workspace-title-row">
          <span className="drive-workspace-title icedr-truncate">{title}</span>
          {count !== null ? <span className="drive-count-badge">{count}</span> : null}
        </div>
        <span className="drive-workspace-subtitle icedr-truncate">{activeLabel}</span>
      </div>

      <div className="drive-toolbar" role="toolbar" aria-label={activeLabel}>
        {isSettingsView ? null : (
          <ToolButton label={t("app.upload")} palette={palette} visual="surface" onClick={triggerUpload}>
            <LocalIcon name="upload" size={17} />
          </ToolButton>
        )}
        {isDriveView ? (
          <SegmentedToolGroup
            ariaLabel={`${t("files.listView")} / ${t("files.gridView")}`}
            onChange={setViewMode}
            options={[
              { icon: <LocalIcon name="menu7" size={17} />, label: t("files.listView"), value: "list" },
              { icon: <LocalIcon name="grid" size={17} />, label: t("files.gridView"), value: "grid" },
            ]}
            palette={palette}
            value={viewMode}
          />
        ) : null}
        {isSettingsView ? null : (
          <ToolButton label={t("app.details")} active={detailsOpen} palette={palette} onClick={() => setDetailsOpen((value) => !value)}>
            <LocalIcon name="info" size={17} />
          </ToolButton>
        )}
      </div>
    </div>
  );
}

export type SelectionToolbarProps = {
  clearSelection: () => void;
  count: number;
  onArchive: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onShare: () => void;
  palette: Palette;
  themeMode: ThemeMode;
};

export function SelectionToolbar({ clearSelection, count, onArchive, onCopy, onDownload, onShare, palette, themeMode }: SelectionToolbarProps) {
  const t = useTranslations();

  return (
    <div
      className="drive-selection-toolbar"
      data-theme-mode={themeMode}
      style={{
        "--drive-selection-shadow": themeMode === "dark" ? "0 16px 44px rgba(0, 0, 0, 0.45)" : "0 16px 44px rgba(17, 18, 23, 0.16)",
      } as React.CSSProperties}
    >
      <div className="drive-selection-state">
        <div className="drive-selection-icon">
          <AnimatedCheckMark size={13} />
        </div>
        <span>{t("app.selected", { count })}</span>
      </div>
      <div className="drive-selection-actions">
        <ToolButton label={t("actions.share")} palette={palette} onClick={onShare}>
          <LocalIcon name="share2" size={17} />
        </ToolButton>
        <ToolButton label={t("actions.copyLink")} palette={palette} onClick={onCopy}>
          <LocalIcon name="link" size={17} />
        </ToolButton>
        <ToolButton label={t("actions.download")} palette={palette} onClick={onDownload}>
          <LocalIcon name="download" size={17} />
        </ToolButton>
        <ToolButton label={t("actions.archive")} palette={palette} onClick={onArchive}>
          <LocalIcon name="file" size={17} />
        </ToolButton>
        <ToolButton label={t("actions.clearSelection")} palette={palette} onClick={clearSelection}>
          <LocalIcon name="cross" size={17} />
        </ToolButton>
      </div>
    </div>
  );
}
