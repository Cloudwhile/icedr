"use client";

import { Input } from "@heroui/react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { DriveItemPreview } from "@/components/ui/drive-item-preview";
import { useLocale, useTranslations } from "@/i18n/react";
import { formatFileSize, getItemKind, type DriveItem, type Locale, type Palette } from "@/features/file/model";
import { LocalIcon, ToolButton } from "./drive-primitives";
import type { DriveSearchFilters, SearchSharedFilter, SearchSizeFilter, SearchStateFilter, SearchTypeFilter, SearchUpdatedFilter } from "./drive-search-model";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

export function DriveSearchBox({
  activeScopeLabel,
  loading,
  onOpenResult,
  palette,
  query,
  results,
  resultCount,
  setQuery,
}: {
  activeScopeLabel: string;
  loading: boolean;
  onOpenResult: (item: DriveItem) => void;
  palette: Palette;
  query: string;
  results: DriveItem[];
  resultCount: number;
  setQuery: Dispatch<SetStateAction<string>>;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const trimmedQuery = query.trim();
  const visibleResults = results.slice(0, 6);

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
      </div>

      {open ? (
        <div className="drive-search-popover">
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
            <span>{trimmedQuery || activeScopeLabel}</span>
          </div>

          <div className="drive-search-result-panel">
            <div className="drive-search-section-title">
              <span>{trimmedQuery ? t("search.suggestions") : t("search.quickAccess")}</span>
              <span>{loading ? t("search.loading") : t("search.resultCount", { count: resultCount })}</span>
            </div>
            <div className="drive-search-result-list">
              {visibleResults.length > 0 ? visibleResults.map((item) => (
                <button
                  {...buttonTypeAttr}
                  aria-label={`${t("actions.open")} ${item.name}`}
                  className="drive-search-result-row"
                  key={item.id}
                  onClick={() => {
                    onOpenResult(item);
                    setOpen(false);
                  }}
                >
                  <DriveItemPreview className="drive-search-result-preview" iconSize={24} item={item} palette={palette} />
                  <span className="drive-search-result-copy">
                    <span className="icedr-truncate">{item.name}</span>
                    <span className="icedr-truncate">{formatSearchResultMeta(item, locale, t)}</span>
                  </span>
                  <LocalIcon name="arrow_right" size={13} />
                </button>
              )) : (
                <div className="drive-search-empty-row">
                  <LocalIcon name="search" size={16} color={palette.subtle} />
                  <span>{trimmedQuery ? t("search.noResults") : t("search.quickAccessEmpty")}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatSearchResultMeta(item: DriveItem, locale: Locale, t: ReturnType<typeof useTranslations>) {
  const kindLabel = t(`files.kind.${getItemKind(item)}`);
  const sizeLabel = item.sizeBytes ? formatFileSize(item.sizeBytes, locale) : "";
  const pathLabel = item.searchPath || item.originalPath || "";
  return [kindLabel, sizeLabel, pathLabel].filter(Boolean).join(" / ");
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
      <div className="drive-filter-panel">
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
      </div>
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
