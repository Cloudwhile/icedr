"use client";

import { useLocale, useTranslations } from "@/i18n/react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { UserAccountMenu } from "@/components/ui/user-account-menu";
import { ActionButton } from "@/components/ui/action-button";
import { MotionSurface } from "@/components/ui/motion";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { SegmentedToolGroup } from "@/components/ui/segmented-tool-group";
import { AppMenu, type AppMenuItem } from "@/components/ui/app-menu";
import { AppImage } from "@/components/ui/app-image";
import { ResponsiveBreadcrumbs } from "@/components/drive/responsive-breadcrumbs";
import { formatFileSize, getItemKind, navItems, type DriveItem, type DriveUserNav, type Locale, type LocalIconName, type Palette } from "@/features/file/model";
import type { AuthUser, StorageUsage } from "@/lib/drive-api";
import { LocalIcon, ToolButton } from "./drive-primitives";
import { DriveSearchBox } from "./drive-search";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

const workspaceShortcutNavIds = ["shared", "recent", "starred", "trash"] as const;
const userFunctionNavIds = ["links", "transfers"] as const;

export type DriveViewMode = "list" | "grid";

export type DriveHeaderProps = {
  activeScopeLabel: string;
  brandLogo: string;
  currentUser: AuthUser | null;
  searchLoading: boolean;
  searchResultCount: number;
  searchResults: DriveItem[];
  onOpenSearchResult: (item: DriveItem) => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  openSidebar: () => void;
  palette: Palette;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  siteName: string;
};

export function AppHeader({
  activeScopeLabel,
  brandLogo,
  currentUser,
  onOpenSearchResult,
  onOpenAdmin,
  onLogout,
  onOpenSettings,
  onRefresh,
  openSidebar,
  palette,
  query,
  searchLoading,
  searchResultCount,
  searchResults,
  setQuery,
  siteName,
}: DriveHeaderProps) {
  const t = useTranslations();

  return (
    <header className="drive-header">
      <div className="drive-header-brand">
        <div className="drive-mobile-only">
          <ToolButton label={t("app.menu")} palette={palette} tooltipPlacement="bottom start" onClick={openSidebar}>
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
        <DriveSearchBox
          activeScopeLabel={activeScopeLabel}
          loading={searchLoading}
          onOpenResult={onOpenSearchResult}
          palette={palette}
          query={query}
          resultCount={searchResultCount}
          results={searchResults}
          setQuery={setQuery}
        />
      </div>

      <div className="drive-header-actions">
        <div className="drive-header-secondary">
          <ToolButton label={t("app.refresh")} palette={palette} tooltipPlacement="bottom" onClick={onRefresh}>
            <LocalIcon name="refresh" size={17} />
          </ToolButton>
        </div>

        <UserAccountMenu
          currentUser={currentUser}
          onLogout={onLogout}
          onOpenAdmin={onOpenAdmin}
          onOpenSettings={onOpenSettings}
          palette={palette}
          t={t}
        />
      </div>
    </header>
  );
}

export type DriveSidebarProps = {
  activeNav: DriveUserNav;
  closeSidebar: () => void;
  currentFolderId: string | null;
  directoryItems: DriveItem[];
  folderPath: DriveItem[];
  onNavigateFolder: (id: string) => void;
  onNavigateRoot: () => void;
  onSelectPersonalSpace: () => void;
  onSelectWorkspaceSpace: () => void;
  palette: Palette;
  rootLabel: string;
  workspaceLabel: string;
  setActiveNav: (id: DriveUserNav) => void;
  sidebarOpen: boolean;
  spaceScope: "workspace" | "personal";
  storageUsage: StorageUsage | null;
};

export function Sidebar({
  activeNav,
  closeSidebar,
  currentFolderId,
  directoryItems,
  folderPath,
  onNavigateFolder,
  onNavigateRoot,
  onSelectPersonalSpace,
  onSelectWorkspaceSpace,
  palette,
  rootLabel,
  workspaceLabel,
  setActiveNav,
  sidebarOpen,
  spaceScope,
  storageUsage,
}: DriveSidebarProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const storageLabel = storageUsage?.quotaBytes
    ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${formatFileSize(storageUsage.quotaBytes, locale)}`
    : storageUsage
      ? `${formatFileSize(storageUsage.usedBytes, locale)} / ${t("settings.unlimitedQuota")}`
      : t("app.storageUsage");
  const storageProgress = Math.max(0, Math.min(100, storageUsage?.usagePercent ?? 0));

  const navById = new Map(navItems.map((item) => [item.id, item]));
  const activeSpaceLabel = spaceScope === "workspace" ? t("app.workspaceSpace") : t("app.personalSpace");
  const activeSpaceMeta = storageLabel;
  const activeSpaceIcon: LocalIconName = spaceScope === "workspace" ? "user_group" : "user_avatar";

  const renderSection = (label: string | null, ids: readonly string[], secondary = false) => (
    <div className={`drive-sidebar-section${secondary ? " drive-sidebar-secondary-section" : ""}`}>
      {label ? <span className="drive-sidebar-section-label">{label}</span> : null}
      {ids.map((id) => {
        const item = navById.get(id as (typeof navItems)[number]["id"]);
        if (!item) return null;
        return (
          <SidebarNavButton
            key={item.id}
            active={activeNav === item.id}
            icon={item.icon}
            label={t(`nav.${item.id}`)}
            onClick={() => setActiveNav(item.id)}
          />
        );
      })}
    </div>
  );

  const navList = (
    <div className="drive-sidebar-nav">
      <div className="drive-space-panel">
        <SpaceScopeSelector
          activeIcon={activeSpaceIcon}
          activeLabel={activeSpaceLabel}
          activeMeta={activeSpaceMeta}
          onSelectPersonalSpace={onSelectPersonalSpace}
          onSelectWorkspaceSpace={onSelectWorkspaceSpace}
          palette={palette}
          spaceScope={spaceScope}
          storageLabel={storageLabel}
          storageProgress={storageProgress}
          workspaceLabel={workspaceLabel}
        />

        <DriveDirectoryTree
          activeNav={activeNav}
          currentFolderId={currentFolderId}
          folderPath={folderPath}
          items={directoryItems}
          onNavigateFolder={onNavigateFolder}
          onNavigateRoot={onNavigateRoot}
          palette={palette}
          rootLabel={rootLabel}
          spaceLabel={activeSpaceMeta}
        />
      </div>

      {renderSection(null, workspaceShortcutNavIds, true)}

      <div className="drive-sidebar-section drive-sidebar-secondary-section">
        <span className="drive-sidebar-section-label">{t("app.userFunctions")}</span>
        {userFunctionNavIds.map((id) => {
          const item = navById.get(id);
          if (!item) return null;
          return (
            <SidebarNavButton
              key={item.id}
              active={activeNav === item.id}
              icon={item.icon}
              label={t(`nav.${item.id}`)}
              onClick={() => setActiveNav(item.id)}
            />
          );
        })}
        <SidebarNavButton active={activeNav === "settings"} icon="settings" label={t("app.settings")} onClick={() => setActiveNav("settings")} />
      </div>

    </div>
  );

  return (
    <>
      <aside className="drive-sidebar">
        {navList}
      </aside>

      {sidebarOpen ? (
        <div className="drive-mobile-sidebar">
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
        </div>
      ) : null}
    </>
  );
}

type DirectoryTreeNode = {
  children: DirectoryTreeNode[];
  item: DriveItem;
};

function DriveDirectoryTree({
  activeNav,
  currentFolderId,
  folderPath,
  items,
  onNavigateFolder,
  onNavigateRoot,
  palette,
  rootLabel,
  spaceLabel,
}: {
  activeNav: DriveUserNav;
  currentFolderId: string | null;
  folderPath: DriveItem[];
  items: DriveItem[];
  onNavigateFolder: (id: string) => void;
  onNavigateRoot: () => void;
  palette: Palette;
  rootLabel: string;
  spaceLabel: string;
}) {
  const t = useTranslations();
  const [rootExpanded, setRootExpanded] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const activePathKey = useMemo(() => folderPath.map((item) => item.id).join("|"), [folderPath]);
  const activePathIds = useMemo(() => new Set(activePathKey ? activePathKey.split("|") : []), [activePathKey]);
  const nodes = useMemo(() => buildDirectoryTree(items), [items]);
  const rootActive = activeNav === "drive" && currentFolderId === null;
  const visibleRootExpanded = rootExpanded;

  const toggleFolder = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="drive-directory-tree">
      <div className="drive-directory-tree-list" role="tree" aria-label={`${spaceLabel} ${t("app.directoryStructure")}`}>
        <DirectoryTreeRootRow
          active={rootActive}
          depth={0}
          expanded={visibleRootExpanded}
          hasChildren={nodes.length > 0}
          label={rootLabel}
          onNavigate={onNavigateRoot}
          onToggle={() => setRootExpanded((expanded) => !expanded)}
          palette={palette}
        />
        {visibleRootExpanded ? (
          <div className="drive-directory-tree-group" role="group">
            {nodes.map((node) => (
              <DirectoryTreeItem
                key={node.item.id}
                activeId={activeNav === "drive" ? currentFolderId : null}
                activePathIds={activePathIds}
                depth={1}
                expandedIds={expandedIds}
                node={node}
                onNavigate={onNavigateFolder}
                onToggle={toggleFolder}
                palette={palette}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DirectoryTreeRootRow({
  active,
  depth,
  expanded,
  hasChildren,
  label,
  onNavigate,
  onToggle,
  palette,
}: {
  active: boolean;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  label: string;
  onNavigate: () => void;
  onToggle: () => void;
  palette: Palette;
}) {
  const t = useTranslations();

  return (
    <div
      className="drive-directory-tree-row"
      data-root="true"
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={active}
      style={{ "--directory-tree-depth": `${depth * 12}px` } as React.CSSProperties}
    >
      {hasChildren ? (
        <button
          {...buttonTypeAttr}
          aria-label={expanded ? t("app.close") : t("actions.open")}
          className="drive-directory-tree-toggle"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <LocalIcon name={expanded ? "arrow_down" : "arrow_right"} size={13} color={palette.subtle} />
        </button>
      ) : (
        <span className="drive-directory-tree-toggle-placeholder" />
      )}
      <button {...buttonTypeAttr} className="drive-directory-tree-button" onClick={onNavigate}>
        <LocalIcon name="folder" size={16} />
        <span className="drive-directory-tree-label icedr-truncate">{label}</span>
      </button>
    </div>
  );
}

function DirectoryTreeItem({
  activeId,
  activePathIds,
  depth,
  expandedIds,
  node,
  onNavigate,
  onToggle,
  palette,
}: {
  activeId: string | null;
  activePathIds: Set<string>;
  depth: number;
  expandedIds: Set<string>;
  node: DirectoryTreeNode;
  onNavigate: (id: string) => void;
  onToggle: (id: string) => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const expanded = expandedIds.has(node.item.id) || activePathIds.has(node.item.id);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className="drive-directory-tree-row"
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={activeId === node.item.id}
        style={{ "--directory-tree-depth": `${depth * 12}px` } as React.CSSProperties}
      >
        {hasChildren ? (
          <button
            {...buttonTypeAttr}
            aria-label={expanded ? t("app.close") : t("actions.open")}
            className="drive-directory-tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.item.id);
            }}
          >
            <LocalIcon name={expanded ? "arrow_down" : "arrow_right"} size={13} color={palette.subtle} />
          </button>
        ) : (
          <span className="drive-directory-tree-toggle-placeholder" />
        )}
        <button className="drive-directory-tree-button" {...buttonTypeAttr} onClick={() => onNavigate(node.item.id)}>
          <LocalIcon name="folder" size={16} />
          <span className="icedr-truncate">{node.item.name}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <div className="drive-directory-tree-group" role="group">
          {node.children.map((child) => (
            <DirectoryTreeItem
              key={child.item.id}
              activeId={activeId}
              activePathIds={activePathIds}
              depth={depth + 1}
              expandedIds={expandedIds}
              node={child}
              onNavigate={onNavigate}
              onToggle={onToggle}
              palette={palette}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function buildDirectoryTree(items: DriveItem[]): DirectoryTreeNode[] {
  const folders = items
    .filter((item) => getItemKind(item) === "folder" && !item.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  const childrenByParent = new Map<string | null, DriveItem[]>();

  folders.forEach((item) => {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  });

  const buildChildren = (parentId: string | null, ancestors: Set<string>): DirectoryTreeNode[] => {
    return (childrenByParent.get(parentId) ?? [])
      .filter((item) => !ancestors.has(item.id))
      .map((item) => {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(item.id);
        return {
          item,
          children: buildChildren(item.id, nextAncestors),
        };
      });
  };

  return buildChildren(null, new Set());
}

function SpaceScopeSelector({
  activeIcon,
  activeLabel,
  activeMeta,
  onSelectWorkspaceSpace,
  onSelectPersonalSpace,
  palette,
  spaceScope,
  storageLabel,
  storageProgress,
  workspaceLabel,
}: {
  activeIcon: LocalIconName;
  activeLabel: string;
  activeMeta: string;
  onSelectPersonalSpace: () => void;
  onSelectWorkspaceSpace: () => void;
  palette: Palette;
  spaceScope: "workspace" | "personal";
  storageLabel: string;
  storageProgress: number;
  workspaceLabel: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && selectorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePress, true);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePress, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="drive-space-switcher" aria-label={t("app.spaceScope")} ref={selectorRef}>
      <button
        {...buttonTypeAttr}
        aria-expanded={open}
        aria-label={t("app.spaceScope")}
        className="drive-space-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="drive-space-trigger-main">
          <LocalIcon name={activeIcon} size={17} />
          <span className="drive-space-trigger-text">
            <span className="drive-space-trigger-label icedr-truncate">{activeLabel}</span>
            <span className="drive-space-trigger-meta icedr-truncate">{activeMeta}</span>
          </span>
        </span>
        <LocalIcon name={open ? "arrow_up" : "arrow_down"} size={14} color={palette.subtle} />
        <span className="drive-space-trigger-progress">
          <ProgressMeter ariaLabel={storageLabel} className="drive-space-meter" palette={palette} value={storageProgress} />
        </span>
      </button>
      {open ? (
        <div className="drive-space-inline-menu" role="menu" aria-label={t("app.spaceScope")}>
          <button
            {...buttonTypeAttr}
            className="drive-space-inline-item"
            data-active={spaceScope === "workspace" ? "true" : undefined}
            onClick={() => {
              onSelectWorkspaceSpace();
              setOpen(false);
            }}
            role="menuitemradio"
            aria-checked={spaceScope === "workspace"}
          >
            <LocalIcon name="user_group" size={15} />
            <span className="drive-space-menu-text">
              <span className="icedr-truncate">{t("app.workspaceSpace")}</span>
              <span className="icedr-truncate">{workspaceLabel}</span>
            </span>
          </button>
          <button
            {...buttonTypeAttr}
            className="drive-space-inline-item"
            data-active={spaceScope === "personal" ? "true" : undefined}
            onClick={() => {
              onSelectPersonalSpace();
              setOpen(false);
            }}
            role="menuitemradio"
            aria-checked={spaceScope === "personal"}
          >
            <LocalIcon name="user_avatar" size={15} />
            <span className="drive-space-menu-text">
              <span className="icedr-truncate">{t("app.personalSpace")}</span>
              <span className="icedr-truncate">{t("nav.drive")}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
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
  activeNav: DriveUserNav;
  createMenuItems: AppMenuItem[];
  filtersActive: boolean;
  folderPath: DriveItem[];
  hasActionTarget: boolean;
  onDownloadSelection: () => void;
  onClearSelection: () => void;
  onNavigateFolder: (id: string) => void;
  onNavigateRoot: () => void;
  onShareSelection: () => void;
  onToggleFilters: () => void;
  onTriggerUpload: () => void;
  palette: Palette;
  rootLabel: string;
  selectionCount: number;
  selectionMenuItems: AppMenuItem[];
  sortMenuItems: AppMenuItem[];
  setViewMode: (mode: DriveViewMode) => void;
  viewMode: DriveViewMode;
};

export function WorkspaceBar({
  activeNav,
  createMenuItems,
  filtersActive,
  folderPath,
  hasActionTarget,
  onClearSelection,
  onDownloadSelection,
  onNavigateFolder,
  onNavigateRoot,
  onShareSelection,
  onToggleFilters,
  onTriggerUpload,
  palette,
  rootLabel,
  selectionCount,
  selectionMenuItems,
  sortMenuItems,
  setViewMode,
  viewMode,
}: WorkspaceBarProps) {
  const t = useTranslations();
  const isPathView = activeNav === "drive";
  const isFileListView = !["links", "transfers", "settings"].includes(activeNav);
  const activeLabel = activeNav === "drive"
    ? rootLabel
    : activeNav === "links"
      ? t("links.pageTitle")
      : activeNav === "settings"
        ? t("app.settings")
        : t(`nav.${activeNav}`);
  const activeNavIcon = navItems.find((item) => item.id === activeNav)?.icon ?? "folder";
  const moduleSubtitleKey = activeNav === "transfers" ? "transfers.subtitle" : null;
  const pathItems = isPathView ? folderPath : [];
  const hasWorkspaceTools = isPathView || isFileListView;
  const currentDirectoryLabel = pathItems.at(-1)?.name ?? rootLabel;
  const directoryLabel = t("app.directoryStructure");
  const hasSelection = selectionCount > 0;
  const trashRestoreAction = selectionMenuItems.find((item) => item.value === "restore");
  const trashDeleteAction = selectionMenuItems.find((item) => item.value === "delete");
  const mobileMenuButtonStyle = {
    "--tool-bg": palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
    "--tool-border": palette.hairline,
    "--tool-color": palette.subtle,
    "--tool-focus": palette.focusRing,
    "--tool-hover-bg": palette.surface2,
    "--tool-hover-border": palette.hairlineStrong,
    "--tool-hover-color": palette.ink,
  } as React.CSSProperties;

  return (
    <div className="drive-workspace-bar" data-module={activeNav}>
      <div className="drive-workspace-context">
        {isPathView ? (
          <div className="drive-workspace-heading-stack">
            <span className="drive-page-title icedr-truncate">{activeLabel}</span>
            <ResponsiveBreadcrumbs
              ancestorMenuLabel={`${directoryLabel}: ${t("actions.more")}`}
              ariaLabel={directoryLabel}
              currentAnnouncement={`${directoryLabel}: ${currentDirectoryLabel}`}
              items={pathItems}
              onNavigateFolder={onNavigateFolder}
              onNavigateRoot={onNavigateRoot}
              palette={palette}
              rootLabel={rootLabel}
            />
          </div>
        ) : (
          <div className="drive-module-heading" aria-label={activeLabel}>
            <span className="drive-module-heading-icon" aria-hidden="true">
              <LocalIcon name={activeNavIcon} size={18} />
            </span>
            <span className="drive-module-heading-copy">
              <span className="drive-page-title icedr-truncate">{activeLabel}</span>
              {moduleSubtitleKey ? <span className="drive-module-subtitle icedr-truncate">{t(moduleSubtitleKey)}</span> : null}
            </span>
          </div>
        )}
      </div>

      {hasWorkspaceTools ? (
        <>
          <div className="drive-toolbar drive-workspace-tools drive-workspace-tools-desktop" role="toolbar" aria-label={activeLabel}>
            {isPathView ? (
              <div className="drive-toolbar-group drive-toolbar-primary-group">
                <ActionButton className="drive-upload-trigger" icon={<LocalIcon name="upload" size={17} />} palette={palette} tone="primary" onClick={onTriggerUpload}>
                  {t("app.upload")}
                </ActionButton>
                <AppMenu ariaLabel={t("actions.create")} items={createMenuItems} palette={palette}>
                  <ActionButton className="drive-create-trigger" icon={<LocalIcon name="plus" size={17} />} palette={palette}>
                    {t("actions.create")}
                  </ActionButton>
                </AppMenu>
              </div>
            ) : null}
            {isFileListView ? (
              <>
                <div className="drive-toolbar-group drive-toolbar-action-group">
                  <ToolButton disabled={!hasActionTarget} label={t("actions.share")} palette={palette} visual="surface" onClick={onShareSelection}>
                    <LocalIcon name="share2" size={17} />
                  </ToolButton>
                  <ToolButton disabled={!hasActionTarget} label={t("actions.download")} palette={palette} visual="surface" onClick={onDownloadSelection}>
                    <LocalIcon name="download" size={17} />
                  </ToolButton>
                  <AppMenu ariaLabel={t("actions.more")} items={selectionMenuItems} palette={palette}>
                    <button
                      {...buttonTypeAttr}
                      aria-label={t("actions.more")}
                      className="icedr-tool-button icedr-tool-button-md icedr-tool-button-surface drive-more-trigger"
                      style={{
                        "--tool-bg": palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
                        "--tool-border": palette.hairline,
                        "--tool-color": palette.subtle,
                        "--tool-focus": palette.focusRing,
                        "--tool-hover-bg": palette.surface2,
                        "--tool-hover-border": palette.hairlineStrong,
                        "--tool-hover-color": palette.ink,
                      } as React.CSSProperties}
                    >
                      <LocalIcon name="menu7" size={17} />
                    </button>
                  </AppMenu>
                </div>
                <div className="drive-toolbar-spacer" />
                <div className="drive-toolbar-control-cluster">
                  <div className="drive-toolbar-group drive-toolbar-filter-group">
                    <ToolButton active={filtersActive} label={t("app.filter")} palette={palette} visual="surface" onClick={onToggleFilters}>
                      <LocalIcon name="slider" size={17} />
                    </ToolButton>
                    <AppMenu ariaLabel={t("filters.sort")} items={sortMenuItems} palette={palette}>
                      <button
                        {...buttonTypeAttr}
                        aria-label={t("filters.sort")}
                        className="icedr-tool-button icedr-tool-button-md icedr-tool-button-surface drive-sort-trigger"
                        style={{
                          "--tool-bg": palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
                          "--tool-border": palette.hairline,
                          "--tool-color": palette.subtle,
                          "--tool-focus": palette.focusRing,
                          "--tool-hover-bg": palette.surface2,
                          "--tool-hover-border": palette.hairlineStrong,
                          "--tool-hover-color": palette.ink,
                        } as React.CSSProperties}
                      >
                        <LocalIcon name="sort" size={17} />
                      </button>
                    </AppMenu>
                  </div>
                  <div className="drive-toolbar-group drive-toolbar-view-group">
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
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <div
            aria-label={activeLabel}
            className="drive-toolbar drive-mobile-workspace-tools"
            data-selection-mode={hasSelection ? "true" : undefined}
            role="toolbar"
          >
            {hasSelection ? (
              <>
                <span aria-live="polite" className="drive-mobile-selection-status" role="status">
                  {t("app.selected", { count: selectionCount })}
                </span>
                <div className="drive-mobile-toolbar-actions">
                  {activeNav === "trash" ? (
                    <>
                      <ToolButton disabled={trashRestoreAction?.disabled} label={t("actions.restore")} palette={palette} visual="surface" onClick={trashRestoreAction?.onClick}>
                        <LocalIcon name="refresh" size={18} />
                      </ToolButton>
                      <ToolButton disabled={trashDeleteAction?.disabled} label={t("actions.deletePermanently")} palette={palette} tone="danger" visual="surface" onClick={trashDeleteAction?.onClick}>
                        <LocalIcon name="trash" size={18} />
                      </ToolButton>
                    </>
                  ) : (
                    <>
                      <ToolButton label={t("actions.share")} palette={palette} visual="surface" onClick={onShareSelection}>
                        <LocalIcon name="share2" size={18} />
                      </ToolButton>
                      <ToolButton label={t("actions.download")} palette={palette} visual="surface" onClick={onDownloadSelection}>
                        <LocalIcon name="download" size={18} />
                      </ToolButton>
                    </>
                  )}
                  <AppMenu ariaLabel={t("actions.more")} items={selectionMenuItems} palette={palette}>
                    <button
                      {...buttonTypeAttr}
                      aria-label={t("actions.more")}
                      className="icedr-tool-button icedr-tool-button-md icedr-tool-button-surface drive-mobile-menu-trigger"
                      style={mobileMenuButtonStyle}
                    >
                      <LocalIcon name="menu7" size={18} />
                    </button>
                  </AppMenu>
                  <ToolButton label={t("actions.clearSelection")} palette={palette} visual="surface" onClick={onClearSelection}>
                    <LocalIcon name="cross" size={18} />
                  </ToolButton>
                </div>
              </>
            ) : (
              <div className="drive-mobile-toolbar-actions">
                {isPathView ? (
                  <>
                    <ToolButton className="drive-mobile-upload-trigger" label={t("app.upload")} palette={palette} visual="surface" onClick={onTriggerUpload}>
                      <LocalIcon name="upload" size={18} />
                    </ToolButton>
                    <AppMenu ariaLabel={t("actions.create")} items={createMenuItems} palette={palette}>
                      <button
                        {...buttonTypeAttr}
                        aria-label={t("actions.create")}
                        className="icedr-tool-button icedr-tool-button-md icedr-tool-button-surface drive-mobile-menu-trigger"
                        style={mobileMenuButtonStyle}
                      >
                        <LocalIcon name="plus" size={18} />
                      </button>
                    </AppMenu>
                  </>
                ) : null}
                {isFileListView ? (
                  <ToolButton active={filtersActive} label={t("app.filter")} palette={palette} visual="surface" onClick={onToggleFilters}>
                    <LocalIcon name="slider" size={18} />
                  </ToolButton>
                ) : null}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
