"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LdrsLoadingState } from "@/components/common/ui/loading-state";
import { AppInput } from "@/components/ui/app-input";
import { LocalIcon } from "@/components/ui/app-icon";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppSelect } from "@/components/ui/app-select";
import { StatusPill } from "@/components/ui/status-pill";
import { ToolButton } from "@/components/ui/tool-button";
import {
  DEFAULT_ADMIN_AUDIT_FILTERS,
  type AdminScope,
} from "@/features/admin/admin-scope";
import {
  getIntlLocale,
  type Locale,
  type LocalIconName,
  type Palette,
} from "@/features/file/model";
import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import type {
  AdminAuditActor,
  AdminAuditEventResponse,
  AdminAuditEventsResponse,
  AdminAuditFilters,
  AdminAuditResourceType,
  AdminAuditResult,
  WorkspaceResponse,
} from "@/lib/drive-api";
import "./styles/admin-audit.css";

export type AdminAuditPanelProps = {
  data: AdminAuditEventsResponse | null;
  error?: string | null;
  filters: AdminAuditFilters;
  initialLoading?: boolean;
  lastSuccessfulAt?: string | null;
  onFiltersChange: (filters: AdminAuditFilters) => void;
  onRefresh: () => void;
  pageSizeOptions?: number[];
  palette: Palette;
  refreshing?: boolean;
  scope: AdminScope;
  stale?: boolean;
  workspaces?: ReadonlyArray<Pick<WorkspaceResponse, "id" | "name">>;
};

const defaultPageSizeOptions = [25, 50, 100, 200];
const debouncedFilterDelayMs = 300;

export function AdminAuditPanel({
  data,
  error,
  filters,
  initialLoading,
  lastSuccessfulAt,
  onFiltersChange,
  onRefresh,
  pageSizeOptions = defaultPageSizeOptions,
  palette,
  refreshing,
  scope,
  stale,
  workspaces = [],
}: AdminAuditPanelProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const committedQuery = filters.query ?? "";
  const committedIpAddress = filters.ipAddress ?? "";
  const [textDraft, setTextDraft] = useState(() => ({
    committedIpAddress,
    committedQuery,
    ipAddress: committedIpAddress,
    query: committedQuery,
  }));
  const filtersRef = useRef(filters);
  const onFiltersChangeRef = useRef(onFiltersChange);

  if (
    textDraft.committedQuery !== committedQuery ||
    textDraft.committedIpAddress !== committedIpAddress
  ) {
    setTextDraft({
      committedIpAddress,
      committedQuery,
      ipAddress: committedIpAddress,
      query: committedQuery,
    });
  }

  useEffect(() => {
    filtersRef.current = filters;
    onFiltersChangeRef.current = onFiltersChange;
  }, [filters, onFiltersChange]);

  useEffect(() => {
    const query = textDraft.query.trim();
    const ipAddress = textDraft.ipAddress.trim();
    if (
      query === (filters.query ?? "") &&
      ipAddress === (filters.ipAddress ?? "")
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      onFiltersChangeRef.current({
        ...filtersRef.current,
        ipAddress: ipAddress || undefined,
        offset: 0,
        query: query || undefined,
      });
    }, debouncedFilterDelayMs);
    return () => window.clearTimeout(timer);
  }, [filters.ipAddress, filters.query, textDraft.ipAddress, textDraft.query]);

  const updateFilters = useCallback(
    (patch: Partial<AdminAuditFilters>) => {
      onFiltersChange({ ...filters, ...patch, offset: 0 });
    },
    [filters, onFiltersChange],
  );
  const resetFilters = useCallback(() => {
    setTextDraft({
      committedIpAddress: "",
      committedQuery: "",
      ipAddress: "",
      query: "",
    });
    onFiltersChange({
      ...DEFAULT_ADMIN_AUDIT_FILTERS,
      limit: filters.limit,
    });
  }, [filters.limit, onFiltersChange]);

  const actorOptions = useMemo(() => {
    const actors = new Set(data?.facets.actors ?? []);
    if (filters.actor) actors.add(filters.actor);
    return [
      { label: t("filters.allTypes"), value: "all" },
      ...Array.from(actors)
        .sort()
        .map((actor) => ({ label: t(`audit.actors.${actor}`), value: actor })),
    ];
  }, [data?.facets.actors, filters.actor, t]);
  const actionOptions = useMemo(() => {
    const actions = new Set(data?.facets.actions ?? []);
    if (filters.action) actions.add(filters.action);
    return [
      { label: t("filters.allTypes"), value: "all" },
      ...Array.from(actions)
        .sort()
        .map((action) => ({
          label: formatAuditAction(action, t),
          value: action,
        })),
    ];
  }, [data?.facets.actions, filters.action, t]);
  const resourceOptions = useMemo(
    () => [
      { label: t("audit.resourceAll"), value: "all" },
      { label: t("audit.resourceFile"), value: "file" },
      { label: t("audit.resourceShare"), value: "share" },
      { label: t("audit.resourceTransfer"), value: "transfer" },
      { label: t("audit.resourceSystem"), value: "system" },
    ],
    [t],
  );
  const resultOptions = useMemo(
    () => [
      { label: t("filters.allStates"), value: "all" },
      { label: t("audit.success"), value: "success" },
      { label: t("transfers.failed"), value: "failed" },
    ],
    [t],
  );
  const sortOptions = useMemo(
    () => [
      { label: t("audit.sortCreatedDesc"), value: "createdAt:desc" },
      { label: t("audit.sortCreatedAsc"), value: "createdAt:asc" },
      { label: t("audit.sortActorAsc"), value: "actor:asc" },
      { label: t("audit.sortActorDesc"), value: "actor:desc" },
      { label: t("audit.sortActionAsc"), value: "action:asc" },
      { label: t("audit.sortActionDesc"), value: "action:desc" },
    ],
    [t],
  );

  const activeFilterCount = [
    filters.actor,
    filters.action,
    filters.result,
    filters.resourceType,
    filters.createdFrom || filters.createdTo,
    filters.query,
    filters.ipAddress,
  ].filter(Boolean).length;
  const total = data?.total ?? 0;
  const limit = Math.max(1, filters.limit);
  const page = Math.floor(Math.max(0, filters.offset) / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const pageEnd = total === 0 ? 0 : Math.min(total, pageStart + limit - 1);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(getIntlLocale(locale)),
    [locale],
  );
  const scopeLabel = formatAdminScope(
    data?.scope ?? scope,
    workspaces,
    t,
  );
  const updatedAt = lastSuccessfulAt ?? data?.generatedAt ?? null;
  const disabled = Boolean(initialLoading && !data);

  return (
    <div className="drive-module-stack drive-audit-module">
      <div
        className="drive-audit-filter-panel"
        data-active={activeFilterCount > 0 ? "true" : undefined}
      >
        <div className="drive-audit-filter-panel-header">
          <div className="drive-audit-filter-title">
            <LocalIcon name="slider" size={17} />
            <span className="icedr-truncate">{t("audit.filters")}</span>
            <small>
              {t("audit.activeFiltersValue", {
                count: String(activeFilterCount),
              })}
            </small>
          </div>
          <div className="drive-audit-filter-actions">
            <StatusPill palette={palette} tone="accent">
              {t("audit.scopeValue", { scope: scopeLabel })}
            </StatusPill>
            <ToolButton
              disabled={disabled || activeFilterCount === 0}
              label={t("audit.resetFilters")}
              palette={palette}
              tooltipPlacement="bottom"
              onClick={resetFilters}
            >
              <LocalIcon name="cross" size={16} />
            </ToolButton>
          </div>
        </div>

        <div className="drive-audit-filter-grid">
          <AuditFilter label={t("audit.actor") }>
            <AppSelect
              aria-label={t("audit.actor")}
              disabled={disabled}
              options={actorOptions}
              palette={palette}
              value={filters.actor ?? "all"}
              onChange={(event) =>
                updateFilters({
                  actor: fromAllValue<AdminAuditActor>(event.target.value),
                })
              }
            />
          </AuditFilter>
          <AuditFilter label={t("audit.actionType")}>
            <AppSelect
              aria-label={t("audit.actionType")}
              disabled={disabled}
              options={actionOptions}
              palette={palette}
              value={filters.action ?? "all"}
              onChange={(event) =>
                updateFilters({ action: fromAllValue(event.target.value) })
              }
            />
          </AuditFilter>
          <AuditFilter label={t("audit.resourceType")}>
            <AppSelect
              aria-label={t("audit.resourceType")}
              disabled={disabled}
              options={resourceOptions}
              palette={palette}
              value={filters.resourceType ?? "all"}
              onChange={(event) =>
                updateFilters({
                  resourceType: fromAllValue<AdminAuditResourceType>(
                    event.target.value,
                  ),
                })
              }
            />
          </AuditFilter>
          <AuditFilter label={t("audit.result")}>
            <AppSelect
              aria-label={t("audit.result")}
              disabled={disabled}
              options={resultOptions}
              palette={palette}
              value={filters.result ?? "all"}
              onChange={(event) =>
                updateFilters({
                  result: fromAllValue<AdminAuditResult>(event.target.value),
                })
              }
            />
          </AuditFilter>
          <AuditFilter label={t("filters.sort")}>
            <AppSelect
              aria-label={t("filters.sort")}
              disabled={disabled}
              options={sortOptions}
              palette={palette}
              value={`${filters.sortBy}:${filters.sortDirection}`}
              onChange={(event) => {
                const [sortBy, sortDirection] = event.target.value.split(":");
                updateFilters({
                  sortBy: sortBy as AdminAuditFilters["sortBy"],
                  sortDirection:
                    sortDirection as AdminAuditFilters["sortDirection"],
                });
              }}
            />
          </AuditFilter>
          <AuditFilter label={t("audit.createdFrom")}>
            <AppInput
              aria-label={t("audit.createdFrom")}
              disabled={disabled}
              palette={palette}
              type="datetime-local"
              value={toLocalDateTime(filters.createdFrom)}
              onChange={(event) =>
                updateFilters({
                  createdFrom: fromLocalDateTime(event.target.value),
                })
              }
            />
          </AuditFilter>
          <AuditFilter label={t("audit.createdTo")}>
            <AppInput
              aria-label={t("audit.createdTo")}
              disabled={disabled}
              palette={palette}
              type="datetime-local"
              value={toLocalDateTime(filters.createdTo)}
              onChange={(event) =>
                updateFilters({
                  createdTo: fromLocalDateTime(event.target.value),
                })
              }
            />
          </AuditFilter>
          <AuditFilter label={t("audit.keyword")} wide>
            <AppInput
              aria-label={t("audit.keyword")}
              disabled={disabled}
              palette={palette}
              placeholder={t("audit.keywordPlaceholder")}
              value={textDraft.query}
              onChange={(event) =>
                setTextDraft((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
            />
          </AuditFilter>
          <AuditFilter label={t("audit.ipAddress")} wide>
            <AppInput
              aria-label={t("audit.ipAddress")}
              disabled={disabled}
              palette={palette}
              placeholder={t("audit.ipPlaceholder")}
              value={textDraft.ipAddress}
              onChange={(event) =>
                setTextDraft((current) => ({
                  ...current,
                  ipAddress: event.target.value,
                }))
              }
            />
          </AuditFilter>
        </div>
      </div>

      <section className="drive-audit-split">
        <div
          aria-busy={refreshing || initialLoading ? true : undefined}
          className="drive-module-panel drive-audit-panel"
        >
          <header className="drive-module-panel-header">
            <div>
              <LocalIcon name="shield" size={16} />
              <span className="icedr-truncate">{t("audit.title")}</span>
            </div>
            <div className="drive-module-panel-header-trailing">
              <ToolButton
                disabled={Boolean(refreshing)}
                isPending={refreshing}
                label={t("actions.refresh")}
                palette={palette}
                onClick={onRefresh}
              >
                <LocalIcon name="refresh" size={16} />
              </ToolButton>
            </div>
          </header>
          <div className="drive-audit-table-toolbar">
            <div className="drive-audit-table-summary">
              <span>
                {t("audit.pageRecordsValue", {
                  count: numberFormatter.format(data?.items.length ?? 0),
                  total: numberFormatter.format(total),
                })}
              </span>
              <span>
                {t("audit.failedRecordsValue", {
                  count: numberFormatter.format(data?.summary.failed ?? 0),
                })}
              </span>
              {updatedAt ? (
                <span>
                  {t("audit.lastUpdatedValue", {
                    time: formatAbsoluteDate(updatedAt, locale, timeZone),
                  })}
                </span>
              ) : null}
            </div>
            <div className="drive-audit-table-tools">
              {refreshing ? (
                <StatusPill palette={palette} tone="accent">
                  {t("audit.refreshing")}
                </StatusPill>
              ) : null}
              {stale ? (
                <StatusPill palette={palette} tone="risk">
                  {t("audit.stale")}
                </StatusPill>
              ) : null}
            </div>
          </div>
          {stale ? (
            <div className="drive-module-error">
              <StatusPill palette={palette} tone="risk">
                {t("app.refreshStaleHint")}
              </StatusPill>
            </div>
          ) : null}
          {error ? (
            <div className="drive-module-error">
              <StatusPill palette={palette} tone="risk">
                {error}
              </StatusPill>
            </div>
          ) : null}

          <div
            className="drive-module-table drive-audit-table"
            role="table"
          >
            {initialLoading && !data ? (
              <LdrsLoadingState
                compact
                label={t("audit.loading")}
                minHeight={180}
                palette={palette}
              />
            ) : (
              <AuditTable
                activeFilterCount={activeFilterCount}
                data={data}
                locale={locale}
                palette={palette}
                timeZone={timeZone}
                t={t}
              />
            )}
          </div>
          <AppPagination
            className="drive-audit-pagination"
            disabled={disabled}
            labels={{
              next: t("pagination.next"),
              page: t("pagination.page"),
              pageSize: t("pagination.pageSize"),
              pageStatus: t("pagination.pageStatus", {
                page: numberFormatter.format(safePage),
                total: numberFormatter.format(totalPages),
              }),
              previous: t("pagination.previous"),
              range: t("pagination.range", {
                end: numberFormatter.format(pageEnd),
                start: numberFormatter.format(pageStart),
                total: numberFormatter.format(total),
              }),
            }}
            page={safePage}
            pageSize={limit}
            pageSizeOptions={pageSizeOptions}
            palette={palette}
            totalItems={total}
            onPageChange={(nextPage) =>
              onFiltersChange({
                ...filters,
                offset: (nextPage - 1) * limit,
              })
            }
            onPageSizeChange={(pageSize) =>
              onFiltersChange({ ...filters, limit: pageSize, offset: 0 })
            }
          />
        </div>
      </section>
    </div>
  );
}

function AuditFilter({
  children,
  label,
  wide,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label className="drive-audit-filter" data-wide={wide ? "true" : undefined}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function AuditTable({
  activeFilterCount,
  data,
  locale,
  palette,
  timeZone,
  t,
}: {
  activeFilterCount: number;
  data: AdminAuditEventsResponse | null;
  locale: Locale;
  palette: Palette;
  timeZone?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const rows = data?.items ?? [];
  if (rows.length === 0) {
    const hasMoreRecords = Boolean(data && data.total > 0);
    const title = hasMoreRecords
      ? t("audit.pageEmptyTitle")
      : activeFilterCount > 0
        ? t("audit.noMatchesTitle")
        : t("audit.emptyTitle");
    const hint = hasMoreRecords
      ? t("audit.pageEmptyHint")
      : activeFilterCount > 0
        ? t("audit.noMatchesHint")
        : t("audit.emptyHint");
    return (
      <div className="drive-module-empty">
        <span className="drive-module-empty-icon">
          <LocalIcon name="shield" size={24} />
        </span>
        <span>{title}</span>
        <span>{hint}</span>
      </div>
    );
  }

  return (
    <>
      <div className="drive-module-table-head" aria-hidden="true" role="row">
        <span>{t("files.modified")}</span>
        <span>{t("audit.actor")}</span>
        <span>{t("audit.actionType")}</span>
        <span>{t("audit.resource")}</span>
        <span>{t("audit.actionContent")}</span>
        <span>{t("audit.ipAddress")}</span>
        <span>{t("audit.result")}</span>
      </div>
      {rows.map((row) => (
        <AuditRow
          key={row.id}
          locale={locale}
          palette={palette}
          row={row}
          timeZone={timeZone}
          t={t}
        />
      ))}
    </>
  );
}

function AuditRow({
  locale,
  palette,
  row,
  timeZone,
  t,
}: {
  locale: Locale;
  palette: Palette;
  row: AdminAuditEventResponse;
  timeZone?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const actor = getAuditActor(row, t);
  const timeParts = formatDateParts(row.createdAt, locale, timeZone);
  const actionLabel = formatAuditAction(row.action, t);
  const resourceLabel = getResourceLabel(row.resourceType, t);
  const resourceName = getAuditResourceName(row, t);
  const content = getAuditContent(row, actionLabel, t);
  const failed = row.result === "failed";

  return (
    <div
      className="drive-module-table-row drive-audit-row"
      data-result={row.result}
      role="row"
    >
      <time
        className="drive-audit-time-cell"
        dateTime={row.createdAt}
        title={formatAbsoluteDate(row.createdAt, locale, timeZone)}
      >
        <span className="icedr-truncate">{timeParts.date}</span>
        <span className="icedr-truncate">{timeParts.time}</span>
      </time>
      <div className="drive-audit-actor-cell">
        <span
          className="drive-audit-actor-avatar"
          data-actor={row.actor}
          data-tone={failed ? "danger" : undefined}
        >
          {actor.initials ? (
            <span>{actor.initials}</span>
          ) : (
            <LocalIcon name={actor.icon} size={17} />
          )}
        </span>
        <div className="drive-module-row-copy">
          <span className="drive-module-row-title icedr-truncate">
            {actor.name}
          </span>
          <span className="drive-audit-actor-meta icedr-truncate">
            {actor.detail}
          </span>
        </div>
      </div>
      <span
        className="drive-audit-action-cell"
        data-tone={failed ? "risk" : getActionTone(row.action)}
      >
        <span className="drive-audit-action-icon" aria-hidden="true">
          <LocalIcon name={getActionIcon(row.action)} size={14} />
        </span>
        <span className="icedr-truncate">{actionLabel}</span>
      </span>
      <span
        className="drive-audit-resource-cell"
        title={`${resourceLabel} / ${resourceName}`}
      >
        <span className="drive-audit-object-cell icedr-truncate">
          {resourceLabel}
        </span>
        <span className="drive-audit-name-cell icedr-truncate">
          {resourceName}
        </span>
      </span>
      <span className="drive-audit-content-cell icedr-truncate" title={content}>
        {content}
      </span>
      <span
        className="drive-audit-ip-cell"
        data-empty={row.ipAddress ? undefined : "true"}
        title={row.ipAddress ?? "--"}
      >
        <LocalIcon name="earth" size={13} />
        <span className="icedr-truncate">{row.ipAddress ?? "--"}</span>
      </span>
      <StatusPill
        className="drive-audit-result-pill"
        palette={palette}
        tone={failed ? "risk" : "secure"}
      >
        {failed ? t("transfers.failed") : t("audit.success")}
      </StatusPill>
    </div>
  );
}

function fromAllValue<T extends string>(value: string) {
  return value === "all" ? undefined : (value as T);
}

function formatAdminScope(
  scope: AdminScope,
  workspaces: ReadonlyArray<{ id: string; name: string }>,
  t: ReturnType<typeof useTranslations>,
) {
  if (scope.kind === "all") return t("admin.scopeAll");
  if (scope.kind === "system") return t("admin.scopeSystem");
  const workspace = workspaces.find((item) => item.id === scope.workspaceId);
  return workspace
    ? t("admin.scopeWorkspaceOption", { name: workspace.name })
    : t("admin.scopeWorkspaceUnknown", { id: scope.workspaceId });
}

function formatAuditAction(
  action: string,
  t: ReturnType<typeof useTranslations>,
) {
  const key = `audit.actions.${action}`;
  const translated = t(key);
  return translated === key ? action : translated;
}

function getAuditActor(
  row: AdminAuditEventResponse,
  t: ReturnType<typeof useTranslations>,
) {
  const fallback = t(`audit.actors.${row.actor}`);
  const name = row.actorDisplayName || row.actorEmail || row.actorUserId || fallback;
  const detail = row.actorEmail || row.actorUserId || fallback;
  return {
    detail,
    icon: getActorIcon(row.actor),
    initials: name === fallback ? "" : createInitials(name),
    name,
  };
}

function getActorIcon(actor: AdminAuditActor): LocalIconName {
  if (actor === "account") return "user_check";
  if (actor === "visitor") return "user_avatar";
  if (actor === "system") return "settings";
  return "user_group";
}

function createInitials(value: string) {
  const parts = value.trim().split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

function getResourceLabel(
  resourceType: AdminAuditResourceType,
  t: ReturnType<typeof useTranslations>,
) {
  const keyByResource: Record<AdminAuditResourceType, string> = {
    file: "audit.resourceFile",
    share: "audit.resourceShare",
    system: "audit.resourceSystem",
    transfer: "audit.resourceTransfer",
  };
  return t(keyByResource[resourceType]);
}

function getAuditResourceName(
  row: AdminAuditEventResponse,
  t: ReturnType<typeof useTranslations>,
) {
  if (isShareAuditEvent(row)) return t("audit.objects.share");
  const metadataName = readMetadataString(row.metadata, [
    "filename",
    "fileName",
    "nodeName",
    "itemName",
    "shareTitle",
    "transferName",
  ]);
  if (metadataName) return metadataName;
  return row.target || row.nodeId || "--";
}

function getAuditContent(
  row: AdminAuditEventResponse,
  fallback: string,
  t: ReturnType<typeof useTranslations>,
) {
  const identity = getAuditIdentityLabel(row, t);
  const node = getAuditNodeLabel(row, t);
  if (row.action === "share.viewed") {
    return t("audit.content.shareViewed", { identity });
  }
  if (row.action === "share.access_code_sent") {
    return t("audit.content.shareAccessCodeSent", { identity });
  }
  if (row.action === "share.access_session_created") {
    return t("audit.content.shareAccessSessionCreated", { identity });
  }
  if (row.action === "share.preview_requested") {
    return t("audit.content.sharePreviewRequested", { target: node });
  }
  if (row.action === "share.download_started") {
    return t("audit.content.shareDownloadStarted", { identity, target: node });
  }
  if (isShareAuditEvent(row)) return fallback;
  return (
    readMetadataString(row.metadata, [
      "message",
      "reason",
      "resultMessage",
      "status",
    ]) ||
    row.target ||
    fallback
  );
}

function getAuditIdentityLabel(
  row: AdminAuditEventResponse,
  t: ReturnType<typeof useTranslations>,
) {
  const email =
    row.actorEmail ||
    readMetadataString(row.metadata, ["actorEmail", "email", "visitorEmail"]);
  if (email) return email;
  const identityType = readMetadataString(row.metadata, ["identityType"]);
  if (identityType === "ica") return t("audit.identity.account");
  if (identityType === "email") return t("audit.identity.email");
  return t(`audit.actors.${row.actor}`);
}

function getAuditNodeLabel(
  row: AdminAuditEventResponse,
  t: ReturnType<typeof useTranslations>,
) {
  const filename = readMetadataString(row.metadata, [
    "filename",
    "fileName",
    "nodeName",
    "itemName",
  ]);
  if (filename) return filename;
  return row.nodeId ? t("audit.objects.file") : t("audit.objects.share");
}

function isShareAuditEvent(row: AdminAuditEventResponse) {
  return (
    row.resourceType === "share" ||
    row.action.startsWith("share.") ||
    Boolean(row.shareToken)
  );
}

function readMetadataString(
  metadata: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getActionTone(action: string) {
  if (action.startsWith("share.")) return "accent" as const;
  if (action.includes("download") || action.includes("preview")) {
    return "secure" as const;
  }
  if (
    action.includes("deleted") ||
    action.includes("archived") ||
    action.includes("revoked")
  ) {
    return "risk" as const;
  }
  return "neutral" as const;
}

function getActionIcon(action: string): LocalIconName {
  if (action.startsWith("auth.")) return "key";
  if (action.startsWith("share.")) return "share2";
  if (action.includes("download")) return "download";
  if (action.includes("upload") || action.startsWith("transfer.")) {
    return "upload";
  }
  if (action.includes("copied")) return "copy";
  if (action.includes("moved")) return "arrow_right";
  if (
    action.includes("archived") ||
    action.includes("deleted") ||
    action.includes("revoked")
  ) {
    return "trash";
  }
  if (action.includes("folder")) return "folder";
  return "shield";
}

function formatDateParts(value: string, locale: Locale, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "--" };
  const zone = timeZone ? { timeZone } : {};
  return {
    date: new Intl.DateTimeFormat(getIntlLocale(locale), {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...zone,
    }).format(date),
    time: new Intl.DateTimeFormat(getIntlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...zone,
    }).format(date),
  };
}

function formatAbsoluteDate(value: string, locale: Locale, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "medium",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

function toLocalDateTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
