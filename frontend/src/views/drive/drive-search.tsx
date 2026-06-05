"use client";

import { Input } from "@heroui/react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { MotionSurface } from "@/components/ui/motion";
import { useTranslations } from "@/i18n/react";
import type { Palette } from "@/features/file/model";
import { LocalIcon, ToolButton } from "./drive-primitives";
import type { DriveSearchFilters, SearchSharedFilter, SearchSizeFilter, SearchStateFilter, SearchTypeFilter, SearchUpdatedFilter } from "./drive-search-model";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

export function DriveSearchBox({
  activeScopeLabel,
  loading,
  onToggleFilters,
  palette,
  query,
  resultCount,
  searchFiltersActive,
  setQuery,
}: {
  activeScopeLabel: string;
  loading: boolean;
  onToggleFilters: () => void;
  palette: Palette;
  query: string;
  resultCount: number;
  searchFiltersActive: boolean;
  setQuery: Dispatch<SetStateAction<string>>;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && shellRef.current?.contains(target)) return;
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
    <div className="drive-search-shell" ref={shellRef} data-open={open ? "true" : undefined}>
      <div className="drive-search">
        <LocalIcon name="search" size={17} color={palette.subtle} />
        <Input
          aria-label={t("app.search")}
          placeholder={t("app.search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="drive-search-input icedr-has-placeholder"
          style={{
            "--placeholder-color": palette.tertiary,
          } as React.CSSProperties}
          variant="secondary"
        />
        {query ? (
          <ToolButton label={t("app.searchClear")} palette={palette} size="sm" tooltipPlacement="bottom" onClick={() => setQuery("")}>
            <LocalIcon name="cross" size={15} />
          </ToolButton>
        ) : null}
        <ToolButton label={t("app.filter")} active={searchFiltersActive} palette={palette} size="sm" tooltipPlacement="bottom" onClick={onToggleFilters}>
          <LocalIcon name="slider" size={15} />
        </ToolButton>
      </div>

      {open ? (
        <MotionSurface className="drive-search-popover" preset="menu">
          <div className="drive-search-popover-head">
            <span className="drive-search-popover-icon">
              <LocalIcon name="search" size={16} />
            </span>
            <div>
              <span>{t("search.panelTitle")}</span>
              <span className="icedr-truncate">{activeScopeLabel}</span>
            </div>
            <span className="drive-search-count" data-loading={loading ? "true" : undefined}>
              {loading ? t("search.loading") : t("search.resultCount", { count: resultCount })}
            </span>
          </div>
          <div className="drive-search-popover-query">
            <span>{trimmedQuery || t("search.emptyQuery")}</span>
          </div>
          <div className="drive-search-popover-actions">
            <button
              {...buttonTypeAttr}
              className="drive-search-scope-chip"
              data-active="true"
              onClick={() => setOpen(false)}
            >
              <LocalIcon name="folder" size={14} />
              <span className="icedr-truncate">{activeScopeLabel}</span>
            </button>
          </div>
        </MotionSurface>
      ) : null}
    </div>
  );
}

export function DriveFilterPanel({
  filters,
  onChange,
  onClear,
  palette,
}: {
  filters: DriveSearchFilters;
  onChange: (filters: DriveSearchFilters) => void;
  onClear: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const update = <Key extends keyof DriveSearchFilters>(key: Key, value: DriveSearchFilters[Key]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="drive-filter-panel-wrap">
      <MotionSurface className="drive-filter-panel" preset="surface">
        <div className="drive-filter-panel-head">
          <span>
            <LocalIcon name="slider" size={15} />
            {t("app.filter")}
          </span>
          <ToolButton label={t("app.clear")} palette={palette} size="sm" onClick={onClear}>
            <LocalIcon name="cross" size={15} />
          </ToolButton>
        </div>
        <div className="drive-filter-grid">
          <DriveFilterField label={t("filters.type")}>
            <AppSelect
              palette={palette}
              value={filters.type}
              onChange={(event) => update("type", event.target.value as SearchTypeFilter)}
              options={[
                { label: t("filters.allTypes"), value: "all" },
                { label: t("files.kind.folder"), value: "folder" },
                { label: t("files.kind.doc"), value: "doc" },
                { label: t("files.kind.sheet"), value: "sheet" },
                { label: t("files.kind.image"), value: "image" },
                { label: t("files.kind.video"), value: "video" },
                { label: t("files.kind.archive"), value: "archive" },
                { label: t("filters.other"), value: "other" },
              ]}
            />
          </DriveFilterField>
          <DriveFilterField label={t("filters.state")}>
            <AppSelect
              palette={palette}
              value={filters.state}
              onChange={(event) => update("state", event.target.value as SearchStateFilter)}
              options={[
                { label: t("filters.currentView"), value: "context" },
                { label: t("filters.activeFiles"), value: "active" },
                { label: t("filters.trashFiles"), value: "archived" },
                { label: t("filters.allStates"), value: "all" },
              ]}
            />
          </DriveFilterField>
          <DriveFilterField label={t("files.shared")}>
            <AppSelect
              palette={palette}
              value={filters.shared}
              onChange={(event) => update("shared", event.target.value as SearchSharedFilter)}
              options={[
                { label: t("filters.allShares"), value: "all" },
                { label: t("filters.sharedOnly"), value: "shared" },
                { label: t("filters.unsharedOnly"), value: "unshared" },
              ]}
            />
          </DriveFilterField>
          <DriveFilterField label={t("files.size")}>
            <AppSelect
              palette={palette}
              value={filters.size}
              onChange={(event) => update("size", event.target.value as SearchSizeFilter)}
              options={[
                { label: t("filters.anySize"), value: "all" },
                { label: t("filters.sizeSmall"), value: "small" },
                { label: t("filters.sizeMedium"), value: "medium" },
                { label: t("filters.sizeLarge"), value: "large" },
              ]}
            />
          </DriveFilterField>
          <DriveFilterField label={t("filters.updated")}>
            <AppSelect
              palette={palette}
              value={filters.updated}
              onChange={(event) => update("updated", event.target.value as SearchUpdatedFilter)}
              options={[
                { label: t("filters.anyTime"), value: "all" },
                { label: t("filters.last7Days"), value: "7d" },
                { label: t("filters.last30Days"), value: "30d" },
                { label: t("filters.last90Days"), value: "90d" },
              ]}
            />
          </DriveFilterField>
          <DriveFilterField label={t("filters.created")}>
            <AppSelect
              palette={palette}
              value={filters.created}
              onChange={(event) => update("created", event.target.value as SearchUpdatedFilter)}
              options={[
                { label: t("filters.anyTime"), value: "all" },
                { label: t("filters.last7Days"), value: "7d" },
                { label: t("filters.last30Days"), value: "30d" },
                { label: t("filters.last90Days"), value: "90d" },
              ]}
            />
          </DriveFilterField>
        </div>
      </MotionSurface>
    </div>
  );
}

function DriveFilterField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="drive-filter-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
