"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { AppInput } from "@/components/ui/app-input";
import { AppPagination } from "@/components/ui/app-pagination";
import { AppSelect } from "@/components/ui/app-select";
import { MotionList } from "@/components/ui/motion";
import { findDriveItem, getIntlLocale, type DriveItem, type Locale, type LocalIconName, type Palette } from "@/features/file/model";
import type { AuditEventResponse } from "@/lib/drive-api";
import type { RegisteredShare } from "@/features/share/registry";
import { formatAbsoluteDate, formatAuditAction } from "./drive-formatters";
import { ItemIcon, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

export type LinksModuleProps = {
  error: string | null;
  links: RegisteredShare[];
  onCloseLink: (id: string) => void;
  onCopyLink: (id: string) => void;
  palette: Palette;
  sourceItems: DriveItem[];
};

export function LinksModule({ error, links, onCloseLink, onCopyLink, palette, sourceItems }: LinksModuleProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const activeLinks = links.filter((link) => (link.status ?? (link.revokedAt ? "revoked" : "active")) === "active");
  const riskLinks = links.filter((link) => link.riskLevel === "high");
  const expiredLinks = links.filter((link) => link.status === "expired");
  const protectedLinks = links.filter((link) => Boolean(link.policy.allowedDomain || link.policy.waitValue > 0));
  const protectedTokens = new Set(protectedLinks.map((link) => link.token));
  const totalVisits = links.reduce((sum, link) => sum + (link.visitCount ?? 0), 0);
  const totalDownloads = links.reduce((sum, link) => sum + (link.downloadCount ?? 0), 0);

  return (
    <div className="drive-module-stack drive-links-module">
      <div className="drive-links-summary" role="list" aria-label={t("links.summary")}>
        <LinkSummaryMetric icon="link" label={t("links.active")} tone="blue" value={String(activeLinks.length)} />
        <LinkSummaryMetric icon="visible" label={t("links.visits")} value={String(totalVisits)} />
        <LinkSummaryMetric icon="download" label={t("links.downloads")} value={String(totalDownloads)} />
        <LinkSummaryMetric icon="exclamation" label={t("links.highRisk")} tone={riskLinks.length > 0 ? "danger" : "neutral"} value={String(riskLinks.length)} />
        <LinkSummaryMetric icon="clock" label={t("links.expiringSoon")} tone={expiredLinks.length > 0 ? "warning" : "neutral"} value={String(expiredLinks.length)} />
        <LinkSummaryMetric icon="shield" label={t("links.protected")} tone={protectedLinks.length > 0 ? "success" : "neutral"} value={String(protectedLinks.length)} />
      </div>

      <section className="drive-links-board" data-has-risk={riskLinks.length > 0 ? "true" : "false"}>
        <div className="drive-module-panel">
          <ModulePanelHeader icon="link" title={t("links.title")} trailing={<StatusPill palette={palette}>{links.length}</StatusPill>} />

          {error ? (
            <div className="drive-module-error">
              <StatusPill palette={palette} tone="risk">
                {error}
              </StatusPill>
            </div>
          ) : null}

          <MotionList key={links.map((link) => link.token).join("|")} className="drive-module-table drive-link-table">
            {links.length === 0 && !error ? <EmptyModuleState icon="link" title={t("links.emptyTitle")} hint={t("links.emptyHint")} /> : null}
            {links.length > 0 ? (
              <div className="drive-module-table-head" aria-hidden="true">
                <span>{t("files.name")}</span>
                <span>{t("links.permission")}</span>
                <span>{t("links.visits")}</span>
                <span>{t("links.expires")}</span>
                <span>{t("actions.more")}</span>
              </div>
            ) : null}
            {links.map((link) => {
              const item = findDriveItem(link.rootItemIds[0] ?? "", sourceItems);
              const itemName = item?.name ?? link.title;
              const status = link.status ?? (link.revokedAt ? "revoked" : "active");
              const statusTone = link.riskLevel === "high" ? "risk" : status === "active" ? "secure" : "neutral";

              return (
                <div key={link.token} data-motion-row className="drive-module-table-row drive-link-row">
                  <span className="drive-module-row-icon" data-tone={item ? undefined : "blue"}>
                    {item ? <ItemIcon item={item} palette={palette} size={18} /> : <LocalIcon name="link" size={18} />}
                  </span>
                  <div className="drive-module-row-copy">
                    <span className="drive-module-row-title icedr-truncate">{itemName}</span>
                    <div className="drive-module-row-meta">
                      <StatusPill palette={palette} tone={statusTone}>
                        {link.riskLevel === "high" ? t("links.highRisk") : t(`links.status.${status}`)}
                      </StatusPill>
                      <MetaIcon icon="calendar">{formatAbsoluteDate(link.createdAt, locale, timeZone)}</MetaIcon>
                    </div>
                  </div>

                  <div className="drive-link-policy-cell">
                    <MetaIcon icon="user_group">{link.allowDownload ? t("links.anyone") : t("links.teamOnly")}</MetaIcon>
                    {protectedTokens.has(link.token) ? (
                      <StatusPill palette={palette} tone="secure" className="drive-module-protected-pill">
                        {t("links.protectedLink")}
                      </StatusPill>
                    ) : null}
                  </div>

                  <div className="drive-link-metric-cell">
                    <MetaIcon icon="visible">{t("links.visitsValue", { count: String(link.visitCount ?? 0) })}</MetaIcon>
                    <MetaIcon icon="download">{t("links.downloadsValue", { count: String(link.downloadCount ?? 0) })}</MetaIcon>
                  </div>

                  <div className="drive-link-date-cell">
                    <MetaIcon icon="clock">{t("links.daysValue", { count: link.expiresDays })}</MetaIcon>
                    {link.lastAccessAt ? <MetaIcon icon="key">{t("links.lastAccessValue", { value: formatAbsoluteDate(link.lastAccessAt, locale, timeZone) })}</MetaIcon> : null}
                  </div>

                  <div className="drive-module-row-actions">
                    <ToolButton label={t("actions.copyLink")} palette={palette} onClick={() => onCopyLink(link.token)}>
                      <LocalIcon name="copy" size={16} />
                    </ToolButton>
                    <ToolButton label={t("links.closeLink")} palette={palette} onClick={() => onCloseLink(link.token)}>
                      <LocalIcon name="ban" size={16} />
                    </ToolButton>
                  </div>
                </div>
              );
            })}
          </MotionList>
        </div>

        {riskLinks.length > 0 ? (
          <aside className="drive-module-side-stack drive-links-side-stack">
            <MotionList key={riskLinks.map((link) => link.token).join("|")} className="drive-risk-grid">
              {riskLinks.slice(0, 2).map((link) => {
                const item = findDriveItem(link.rootItemIds[0] ?? "", sourceItems);
                return (
                  <article key={`risk-${link.token}`} data-motion-row className="drive-risk-card">
                    <div className="drive-risk-title">
                      <LocalIcon name="exclamation" size={17} />
                      <span className="icedr-truncate">{item?.name ?? link.title}</span>
                      <StatusPill palette={palette} tone="risk">
                        {t("links.highRisk")}
                      </StatusPill>
                    </div>
                    <span className="drive-risk-copy">{t("links.riskSignal")}</span>
                    <div className="drive-risk-meta">
                      <MetaIcon icon="clock">{t("links.daysValue", { count: link.expiresDays })}</MetaIcon>
                      <MetaIcon icon="visible">{t("links.visitsValue", { count: String(link.visitCount ?? 0) })}</MetaIcon>
                      <MetaIcon icon="download">{t("links.downloadsValue", { count: String(link.downloadCount ?? 0) })}</MetaIcon>
                    </div>
                    <div className="drive-risk-actions">
                      <ToolButton label={t("links.disableLink")} palette={palette} onClick={() => onCloseLink(link.token)}>
                        <LocalIcon name="ban" size={16} />
                      </ToolButton>
                    </div>
                  </article>
                );
              })}
            </MotionList>
          </aside>
        ) : null}
      </section>
    </div>
  );
}

export { TransfersModule, type TransfersModuleProps } from "./drive-transfers";

type AuditResultFilter = "all" | "success" | "failed";
type AuditResourceFilter = "all" | "file" | "share" | "transfer" | "system";
type AuditTimeFilter = "all" | "7d" | "30d" | "90d";

export function AuditModule({
  error,
  events,
  query: controlledQuery,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onQueryChange,
  page,
  pageSize,
  pageSizeOptions,
  palette,
  totalEvents,
}: {
  error: string | null;
  events: AuditEventResponse[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  query?: string;
  onRefresh: () => void;
  onQueryChange?: (query: string) => void;
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  palette: Palette;
  totalEvents: number;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const [actorFilter, setActorFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>("all");
  const [resourceFilter, setResourceFilter] = useState<AuditResourceFilter>("all");
  const [timeFilter, setTimeFilter] = useState<AuditTimeFilter>("all");
  const [ipQuery, setIpQuery] = useState("");
  const [localQuery, setLocalQuery] = useState("");
  const query = controlledQuery ?? localQuery;
  const setQuery = onQueryChange ?? setLocalQuery;
  const actorOptions = useMemo(() => {
    const actors = Array.from(new Set(events.map((event) => event.actor))).sort();
    return [{ label: t("filters.allTypes"), value: "all" }, ...actors.map((actor) => ({ label: getAuditActorLabel(actor, t), value: actor }))];
  }, [events, t]);
  const actionOptions = useMemo(() => {
    const actions = Array.from(new Set(events.map((event) => event.action))).sort();
    return [{ label: t("filters.allTypes"), value: "all" }, ...actions.map((action) => ({ label: formatAuditAction(action, t), value: action }))];
  }, [events, t]);
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
  const timeOptions = useMemo(
    () => [
      { label: t("filters.anyTime"), value: "all" },
      { label: t("filters.last7Days"), value: "7d" },
      { label: t("filters.last30Days"), value: "30d" },
      { label: t("filters.last90Days"), value: "90d" },
    ],
    [t],
  );
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const normalizedIpQuery = ipQuery.trim().toLocaleLowerCase();
    const createdAfter = getAuditCreatedAfter(timeFilter);
    return events.filter((event) => {
      const actor = getAuditActorIdentity(event, t);
      const activity = getAuditActivity(event, t);
      const result = getAuditResult(event);
      if (actorFilter !== "all" && event.actor !== actorFilter) return false;
      if (actionFilter !== "all" && event.action !== actionFilter) return false;
      if (resultFilter !== "all" && result !== resultFilter) return false;
      if (resourceFilter !== "all" && getAuditResourceType(event) !== resourceFilter) return false;
      if (createdAfter && new Date(event.createdAt).getTime() < createdAfter) return false;
      if (normalizedIpQuery && !actor.ipAddress.toLocaleLowerCase().includes(normalizedIpQuery)) return false;
      if (!normalizedQuery) return true;
      return [
        actor.name,
        actor.detail,
        actor.ipAddress,
        activity.actionLabel,
        activity.objectLabel,
        activity.nameLabel,
        result === "failed" ? t("transfers.failed") : t("audit.success"),
        formatAbsoluteDate(event.createdAt, locale, timeZone),
      ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [actionFilter, actorFilter, events, ipQuery, locale, query, resourceFilter, resultFilter, t, timeFilter, timeZone]);
  const resetFilters = () => {
    setActorFilter("all");
    setActionFilter("all");
    setResultFilter("all");
    setResourceFilter("all");
    setTimeFilter("all");
    setIpQuery("");
    setQuery("");
  };
  const activeFilterCount = [
    actorFilter !== "all",
    actionFilter !== "all",
    resultFilter !== "all",
    resourceFilter !== "all",
    timeFilter !== "all",
    Boolean(query.trim()),
    Boolean(ipQuery.trim()),
  ].filter(Boolean).length;
  const failedEventCount = filteredEvents.filter((event) => getAuditResult(event) === "failed").length;
  const numberFormatter = useMemo(() => new Intl.NumberFormat(getIntlLocale(locale)), [locale]);
  const totalPages = Math.max(1, Math.ceil(Math.max(totalEvents, 0) / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const pageStart = totalEvents === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = totalEvents === 0 ? 0 : Math.min(totalEvents, safePage * pageSize);
  const formattedTotal = numberFormatter.format(totalEvents);
  const pageRecordsLabel = t("audit.pageRecordsValue", {
    count: numberFormatter.format(filteredEvents.length),
    total: formattedTotal,
  });

  return (
    <div className="drive-module-stack drive-audit-module">
      <div className="drive-audit-filter-panel" data-active={activeFilterCount > 0 ? "true" : undefined}>
        <div className="drive-audit-filter-panel-header">
          <div className="drive-audit-filter-title">
            <LocalIcon name="slider" size={17} />
            <span className="icedr-truncate">{t("audit.filters")}</span>
            <small>{t("audit.activeFiltersValue", { count: String(activeFilterCount) })}</small>
          </div>
          <div className="drive-audit-filter-actions">
            <StatusPill palette={palette}>{pageRecordsLabel}</StatusPill>
            <ToolButton label={t("audit.resetFilters")} palette={palette} onClick={resetFilters} tooltipPlacement="bottom">
              <LocalIcon name="cross" size={16} />
            </ToolButton>
          </div>
        </div>
        <div className="drive-audit-filter-grid">
          <label className="drive-audit-filter">
            <span>{t("audit.timeRange")}</span>
            <AppSelect aria-label={t("audit.timeRange")} options={timeOptions} palette={palette} value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as AuditTimeFilter)} />
          </label>
          <label className="drive-audit-filter">
            <span>{t("audit.actor")}</span>
            <AppSelect aria-label={t("audit.actor")} options={actorOptions} palette={palette} value={actorFilter} onChange={(event) => setActorFilter(event.target.value)} />
          </label>
          <label className="drive-audit-filter">
            <span>{t("audit.actionType")}</span>
            <AppSelect aria-label={t("audit.actionType")} options={actionOptions} palette={palette} value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} />
          </label>
          <label className="drive-audit-filter">
            <span>{t("audit.resourceType")}</span>
            <AppSelect aria-label={t("audit.resourceType")} options={resourceOptions} palette={palette} value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value as AuditResourceFilter)} />
          </label>
          <label className="drive-audit-filter">
            <span>{t("audit.result")}</span>
            <AppSelect aria-label={t("audit.result")} options={resultOptions} palette={palette} value={resultFilter} onChange={(event) => setResultFilter(event.target.value as AuditResultFilter)} />
          </label>
          <label className="drive-audit-filter" data-wide="true">
            <span>{t("audit.keyword")}</span>
            <AppInput aria-label={t("audit.keyword")} palette={palette} placeholder={t("audit.keywordPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="drive-audit-filter" data-wide="true">
            <span>{t("audit.ipAddress")}</span>
            <AppInput aria-label={t("audit.ipAddress")} palette={palette} placeholder={t("audit.ipPlaceholder")} value={ipQuery} onChange={(event) => setIpQuery(event.target.value)} />
          </label>
        </div>
      </div>

      <section className="drive-audit-split">
        <div className="drive-module-panel drive-audit-panel">
          <ModulePanelHeader
            icon="shield"
            title={t("audit.title")}
            trailing={(
              <ToolButton label={t("app.refresh")} palette={palette} onClick={onRefresh}>
                <LocalIcon name="refresh" size={16} />
              </ToolButton>
            )}
          />
          <div className="drive-audit-table-toolbar">
            <div className="drive-audit-table-summary">
              <span>{pageRecordsLabel}</span>
              <span>{t("audit.failedRecordsValue", { count: String(failedEventCount) })}</span>
            </div>
            <div className="drive-audit-table-tools">
              <StatusPill palette={palette}>{t("audit.activeFiltersValue", { count: String(activeFilterCount) })}</StatusPill>
            </div>
          </div>
          {error ? (
            <div className="drive-module-error">
              <StatusPill palette={palette} tone="risk">
                {error}
              </StatusPill>
            </div>
          ) : null}
          <MotionList key={filteredEvents.map((row) => row.id).join("|")} className="drive-module-table drive-audit-table">
            {filteredEvents.length === 0 && !error ? <EmptyModuleState icon="shield" title={t("audit.emptyTitle")} hint={t("audit.emptyHint")} /> : null}
            {filteredEvents.length > 0 ? (
              <div className="drive-module-table-head" aria-hidden="true">
                <span>{t("files.modified")}</span>
                <span>{t("audit.actor")}</span>
                <span>{t("audit.actionType")}</span>
                <span>{t("audit.resource")}</span>
                <span>{t("audit.actionContent")}</span>
                <span>{t("audit.ipAddress")}</span>
                <span>{t("audit.result")}</span>
              </div>
            ) : null}
            {filteredEvents.map((row) => {
              const actor = getAuditActorIdentity(row, t);
              const activity = getAuditActivity(row, t);
              const ipAddress = actor.ipAddress;
              const failed = getAuditResult(row) === "failed";
              const timeParts = formatAuditDateParts(row.createdAt, locale, timeZone);

              return (
                <div key={row.id} data-motion-row className="drive-module-table-row drive-audit-row" data-result={failed ? "failed" : "success"}>
                  <span className="drive-audit-time-cell" title={formatAbsoluteDate(row.createdAt, locale, timeZone)}>
                    <span className="icedr-truncate">{timeParts.date}</span>
                    <span className="icedr-truncate">{timeParts.time}</span>
                  </span>
                  <div className="drive-audit-actor-cell">
                    <span className="drive-audit-actor-avatar" data-actor={row.actor} data-tone={failed ? "danger" : getAuditIconTone(row.action)}>
                      {actor.avatarUrl ? <img alt="" src={actor.avatarUrl} /> : actor.initials ? <span>{actor.initials}</span> : <LocalIcon name={actor.icon} size={17} />}
                    </span>
                    <div className="drive-module-row-copy">
                      <span className="drive-module-row-title icedr-truncate">{actor.name}</span>
                      <span className="drive-audit-actor-meta icedr-truncate">{actor.detail}</span>
                    </div>
                  </div>

                  <span className="drive-audit-action-cell" data-tone={failed ? "risk" : getAuditActionTone(row.action)}>
                    <span className="drive-audit-action-icon" aria-hidden="true">
                      <LocalIcon name={getAuditActionIcon(row.action)} size={14} />
                    </span>
                    <span className="icedr-truncate">{activity.actionLabel}</span>
                  </span>
                  <span className="drive-audit-resource-cell" title={`${activity.objectLabel} / ${activity.nameLabel}`}>
                    <span className="drive-audit-object-cell icedr-truncate">{activity.objectLabel}</span>
                    <span className="drive-audit-name-cell icedr-truncate">{activity.nameLabel}</span>
                  </span>
                  <span className="drive-audit-content-cell icedr-truncate" title={activity.contentLabel}>
                    {activity.contentLabel}
                  </span>
                  <span className="drive-audit-ip-cell" data-empty={ipAddress === "--" ? "true" : undefined} title={ipAddress}>
                    <LocalIcon name="earth" size={13} />
                    <span className="icedr-truncate">{ipAddress}</span>
                  </span>
                  <StatusPill className="drive-audit-result-pill" palette={palette} tone={failed ? "risk" : "secure"}>
                    {failed ? t("transfers.failed") : t("audit.success")}
                  </StatusPill>
                </div>
              );
            })}
          </MotionList>
          <AppPagination
            className="drive-audit-pagination"
            disabled={Boolean(error)}
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
                total: formattedTotal,
              }),
            }}
            page={safePage}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            palette={palette}
            totalItems={totalEvents}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      </section>
    </div>
  );
}

function LinkSummaryMetric({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: LocalIconName;
  label: string;
  tone?: "blue" | "danger" | "neutral" | "success" | "warning";
  value: string;
}) {
  return (
    <div className="drive-links-summary-item" data-tone={tone} role="listitem">
      <span className="drive-links-summary-icon" aria-hidden="true">
        <LocalIcon name={icon} size={16} />
      </span>
      <span className="drive-links-summary-copy">
        <strong>{value}</strong>
        <span>{label}</span>
      </span>
    </div>
  );
}

function ModulePanelHeader({
  compact = false,
  icon,
  title,
  trailing,
}: {
  compact?: boolean;
  icon: LocalIconName;
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="drive-module-panel-header" data-compact={compact ? "true" : undefined}>
      <div>
        <LocalIcon name={icon} size={16} />
        <span className="icedr-truncate">{title}</span>
      </div>
      {trailing ? <div className="drive-module-panel-header-trailing">{trailing}</div> : null}
    </header>
  );
}

function MetaIcon({ children, icon }: { children: ReactNode; icon: LocalIconName }) {
  return (
    <span className="drive-module-meta-icon">
      <LocalIcon name={icon} size={13} />
      <span className="icedr-truncate">{children}</span>
    </span>
  );
}

function EmptyModuleState({
  compact = false,
  hint,
  icon,
  title,
}: {
  compact?: boolean;
  hint: string;
  icon: LocalIconName;
  title: string;
}) {
  return (
    <div className="drive-module-empty" data-compact={compact ? "true" : undefined}>
      <span className="drive-module-empty-icon">
        <LocalIcon name={icon} size={24} />
      </span>
      <span>{title}</span>
      <span>{hint}</span>
    </div>
  );
}

const failedAuditActions = new Set([
  "share.access_code_failed",
  "share.access_code_locked",
  "share.access_denied",
  "share.rate_limited",
]);

export function getAuditResult(row: AuditEventResponse) {
  if (failedAuditActions.has(row.action)) return "failed";
  const value = row.metadata.result;
  const status = row.metadata.status;
  const values = [value, status, row.action]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase());
  return values.some((item) => item.includes("fail")) ? "failed" : "success";
}

function getAuditActivity(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  return {
    actionLabel: getAuditActivityName(row, t),
    contentLabel: getAuditActivityContent(row, t),
    nameLabel: getAuditActivityName(row, t),
    objectLabel: getAuditObjectLabel(row, t),
  };
}

function getAuditActivityContent(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  const identityLabel = getAuditIdentityLabel(row, t);
  const nodeLabel = getAuditNodeLabel(row, t);
  if (row.action === "share.viewed") return t("audit.content.shareViewed", { identity: identityLabel });
  if (row.action === "share.access_code_sent") return t("audit.content.shareAccessCodeSent", { identity: identityLabel });
  if (row.action === "share.access_session_created") return t("audit.content.shareAccessSessionCreated", { identity: identityLabel });
  if (row.action === "share.preview_requested") return t("audit.content.sharePreviewRequested", { target: nodeLabel });
  if (row.action === "share.download_started") return t("audit.content.shareDownloadStarted", { target: nodeLabel, identity: identityLabel });
  return formatAuditAction(row.action, t);
}

function getAuditObjectLabel(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  if (row.action.startsWith("auth.")) return t("audit.objects.account");
  if (row.action === "file.folder_created") return t("audit.objects.folder");
  if (row.action.startsWith("file.")) return t("audit.objects.file");
  if (row.action.startsWith("share.")) return t("audit.objects.share");
  if (row.action.startsWith("transfer.")) return t("audit.objects.upload");
  return t("audit.objects.system");
}

function getAuditActivityName(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  if (row.action === "auth.login") return getAuditLoginMethodLabel(row, t);
  if (row.action === "auth.login_failed") return t("audit.names.loginFailed");
  if (row.action === "auth.registered") {
    return readAuditString(row.metadata, "authMethod") === "setup" ? t("audit.names.setupRegister") : t("audit.names.register");
  }
  if (row.action === "auth.password_reset_completed") return t("audit.names.passwordReset");
  if (row.action === "auth.passkey_added") return t("audit.names.passkeyAdded");
  if (row.action === "auth.passkey_removed") return t("audit.names.passkeyRemoved");
  if (row.action === "auth.passkey_renamed") return t("audit.names.passkeyRenamed");
  if (row.action === "auth.reauthentication_succeeded") return t("audit.names.reauthenticationSucceeded");
  if (row.action === "auth.reauthentication_failed") return t("audit.names.reauthenticationFailed");
  if (row.action === "auth.recovery_codes_generated") return t("audit.names.recoveryCodesGenerated");
  if (row.action === "auth.recovery_code_used") return t("audit.names.recoveryCodeUsed");
  if (row.action === "auth.method_policy_blocked") return t("audit.names.methodPolicyBlocked");
  if (row.action === "file.upload_completed" || row.action === "transfer.completed") return t("audit.names.upload");
  if (row.action === "transfer.failed") return t("audit.names.upload");
  if (row.action === "file.download_started" || row.action === "share.download_started") return t("audit.names.download");
  if (row.action === "share.viewed") return t("audit.names.viewShare");
  if (row.action === "share.access_code_sent") return t("audit.names.accessCode");
  if (row.action === "share.access_session_created") return t("audit.names.accessSession");
  if (row.action === "share.preview_requested") return t("audit.names.preview");
  if (row.action === "share.created") return t("audit.names.share");
  if (row.action === "share.revoked") return t("audit.names.revokeShare");
  if (row.action === "file.copied") return t("audit.names.copy");
  if (row.action === "file.moved" || row.action === "file.batch_moved") return t("audit.names.move");
  if (row.action === "file.archived" || row.action === "file.batch_archived") return t("audit.names.delete");
  if (row.action === "file.permanently_deleted") return t("audit.names.permanentDelete");
  if (row.action === "file.folder_created") return t("audit.names.create");
  return formatAuditAction(row.action, t);
}

function getAuditLoginMethodLabel(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  const method = readAuditString(row.metadata, "authMethod") || readAuditString(row.metadata, "method");
  if (method === "oauth") return t("audit.names.oauthLogin");
  if (method === "passkey") return t("audit.names.passkeyLogin");
  if (method === "setup") return t("audit.names.setupLogin");
  return t("audit.names.localLogin");
}

function getAuditIdentityLabel(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  const identityType = readAuditString(row.metadata, "identityType");
  const email = getAuditMetadataValue(row, ["actorEmail", "email", "visitorEmail", "accessSession.email", "identity.email"]);
  if (email !== "--") return email;
  if (identityType === "ica") return t("audit.identity.account");
  if (identityType === "email") return t("audit.identity.email");
  return getAuditActorLabel(row.actor, t);
}

function getAuditNodeLabel(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  const filename = getAuditMetadataValue(row, ["filename", "fileName", "nodeName", "itemName", "resource.name"]);
  if (filename !== "--") return filename;
  if (row.nodeId) return t("audit.objects.file");
  return t("audit.objects.share");
}

function getAuditResourceType(row: AuditEventResponse): AuditResourceFilter {
  if (row.action.startsWith("auth.")) return "system";
  if (row.action.startsWith("file.")) return "file";
  if (row.action.startsWith("share.") || row.shareToken) return "share";
  if (row.action.startsWith("transfer.")) return "transfer";
  return "system";
}

function getAuditCreatedAfter(filter: AuditTimeFilter) {
  if (filter === "all") return null;
  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : 90;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function formatAuditDateParts(value: string, locale: Locale, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: value, time: "--" };
  }

  const intlLocale = getIntlLocale(locale);
  const timeZoneOptions = timeZone ? { timeZone } : {};

  return {
    date: new Intl.DateTimeFormat(intlLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...timeZoneOptions,
    }).format(date),
    time: new Intl.DateTimeFormat(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...timeZoneOptions,
    }).format(date),
  };
}

function getAuditActionTone(action: string) {
  if (action.startsWith("share.")) return "accent" as const;
  if (action.includes("download") || action.includes("preview")) return "secure" as const;
  if (action.includes("deleted") || action.includes("archived") || action.includes("revoked")) return "risk" as const;
  return "neutral" as const;
}

function getAuditActionIcon(action: string): LocalIconName {
  if (action.startsWith("auth.")) return action.includes("registered") ? "user_check" : "key";
  if (action.startsWith("share.")) return "share2";
  if (action.includes("download")) return "download";
  if (action.includes("upload") || action.startsWith("transfer.")) return "upload";
  if (action.includes("copied")) return "copy";
  if (action.includes("moved")) return "arrow_right";
  if (action.includes("archived") || action.includes("deleted") || action.includes("revoked")) return "trash";
  if (action.includes("folder")) return "folder";
  return "shield";
}

function getAuditIconTone(action: string) {
  if (action.startsWith("share.")) return "blue";
  if (action.startsWith("transfer.")) return undefined;
  if (action.includes("download") || action.includes("preview")) return "green";
  return "blue";
}

export function getAuditActorIdentity(row: AuditEventResponse, t: ReturnType<typeof useTranslations>) {
  const actorLabel = getAuditActorLabel(row.actor, t);
  const displayName = getAuditMetadataValue(row, [
    "actorName",
    "actorDisplayName",
    "displayName",
    "userName",
    "visitorName",
    "visitorEmail",
    "identity.email",
    "accessSession.email",
    "actor.name",
    "actor.displayName",
    "user.displayName",
    "user.name",
    "session.user.displayName",
    "session.user.name",
  ]);
  const email = getAuditMetadataValue(row, [
    "actorEmail",
    "email",
    "visitorEmail",
    "identity.email",
    "accessSession.email",
    "actor.email",
    "user.email",
    "session.email",
    "session.user.email",
  ]);
  const avatarUrl = getAuditMetadataValue(row, [
    "actorAvatarUrl",
    "avatarUrl",
    "avatar",
    "actor.avatarUrl",
    "user.avatarUrl",
    "session.user.avatarUrl",
  ]);
  const userId = getAuditMetadataValue(row, [
    "actorUserId",
    "userId",
    "visitorId",
    "actor.id",
    "user.id",
    "session.user.id",
  ]);
  const ipAddress = getAuditMetadataValue(row, [
    "ip",
    "ipAddress",
    "visitorIp",
    "requestIp",
    "remoteAddress",
    "clientIp",
    "sourceIp",
    "request.ip",
    "request.clientIp",
    "network.ip",
    "network.clientIp",
    "client.ip",
  ]);
  const name = displayName !== "--" ? displayName : email !== "--" ? email : userId !== "--" ? userId : actorLabel;
  const detail = email !== "--" ? email : userId !== "--" ? userId : ipAddress !== "--" ? ipAddress : actorLabel;

  return {
    avatarUrl: avatarUrl === "--" ? null : avatarUrl,
    detail,
    icon: getAuditActorIcon(row.actor),
    initials: createAuditActorInitials(name, actorLabel),
    ipAddress,
    name,
  };
}

function getAuditActorLabel(actor: AuditEventResponse["actor"], t: ReturnType<typeof useTranslations>) {
  return t(`audit.actors.${actor}`);
}

function getAuditActorIcon(actor: AuditEventResponse["actor"]): LocalIconName {
  if (actor === "account") return "user_check";
  if (actor === "visitor") return "user_avatar";
  if (actor === "system") return "settings";
  return "user_group";
}

function getAuditMetadataValue(row: AuditEventResponse, keys: string[]) {
  for (const key of keys) {
    const value = readAuditMetadataPath(row.metadata, key);
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "--";
}

function readAuditString(metadata: Record<string, unknown>, key: string) {
  const value = readAuditMetadataPath(metadata, key);
  return typeof value === "string" && value.trim() ? value.trim().toLocaleLowerCase() : "";
}

function readAuditMetadataPath(metadata: Record<string, unknown>, key: string): unknown {
  if (!key.includes(".")) return metadata[key];
  return key.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, metadata);
}

function createAuditActorInitials(name: string, fallback: string) {
  const source = (name === "--" ? fallback : name).trim();
  const normalized = source.includes("@") ? source.split("@")[0] : source;
  const parts = normalized
    .split(/[\s._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  const initials = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`;
  return initials.toLocaleUpperCase();
}
