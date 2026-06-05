"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { MotionList } from "@/components/ui/motion";
import { findDriveItem, type DriveItem, type Locale, type LocalIconName, type Palette } from "@/features/file/model";
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
  const riskLinks = links.filter((link) => link.riskLevel === "high");
  const expiredLinks = links.filter((link) => link.status === "expired");
  const protectedLinks = links.filter((link) => Boolean(link.policy.allowedDomain || link.policy.waitValue > 0));
  const protectedTokens = new Set(protectedLinks.map((link) => link.token));

  return (
    <div className="drive-module-stack drive-links-module">
      <div className="drive-module-console-strip">
        <MetaIcon icon="link">{t("links.memberScope")}</MetaIcon>
        <MetaIcon icon="visible">{t("links.visitsValue", { count: String(links.reduce((sum, link) => sum + (link.visitCount ?? 0), 0)) })}</MetaIcon>
        <MetaIcon icon="download">{t("links.downloadsValue", { count: String(links.reduce((sum, link) => sum + (link.downloadCount ?? 0), 0)) })}</MetaIcon>
      </div>

      <div className="drive-module-stat-grid drive-module-stat-grid-links">
        <section className="drive-module-stat-card drive-module-stat-card-wide">
          <div className="drive-module-stat-copy">
            <span>{t("links.overviewTitle")}</span>
            <span>{t("links.overviewHint")}</span>
          </div>
          <span className="drive-module-stat-icon" data-tone="blue">
            <LocalIcon name="link" size={22} />
          </span>
        </section>
        <MetricCard icon="exclamation" label={t("links.highRisk")} tone="danger" value={String(riskLinks.length)} />
        <MetricCard icon="clock" label={t("links.expiringSoon")} tone="warning" value={String(expiredLinks.length)} />
        <MetricCard icon="shield" label={t("links.protected")} tone="success" value={String(protectedLinks.length)} />
      </div>

      <section className="drive-links-board">
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

        <aside className="drive-module-side-stack drive-links-side-stack">
          <section className="drive-module-side-card">
            <ModulePanelHeader icon="shield" title={t("links.protected")} compact />
            <div className="drive-module-side-list">
              <InfoRow label={t("links.active")} value={String(links.filter((link) => (link.status ?? "active") === "active").length)} />
              <InfoRow label={t("links.highRisk")} value={String(riskLinks.length)} />
              <InfoRow label={t("links.expiringSoon")} value={String(expiredLinks.length)} />
              <InfoRow label={t("links.visits")} value={String(links.reduce((sum, link) => sum + (link.visitCount ?? 0), 0))} />
            </div>
          </section>
          {riskLinks.length > 0 ? (
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
          ) : null}
        </aside>
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
  onRefresh,
  onQueryChange,
  palette,
}: {
  error: string | null;
  events: AuditEventResponse[];
  query?: string;
  onRefresh: () => void;
  onQueryChange?: (query: string) => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const [actorFilter, setActorFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<AuditResultFilter>("all");
  const [resourceFilter, setResourceFilter] = useState<AuditResourceFilter>("all");
  const [timeFilter, setTimeFilter] = useState<AuditTimeFilter>("all");
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const [ipQuery, setIpQuery] = useState("");
  const [localQuery, setLocalQuery] = useState("");
  const query = controlledQuery ?? localQuery;
  const setQuery = onQueryChange ?? setLocalQuery;
  const actorOptions = useMemo(() => {
    const actors = Array.from(new Set(events.map((event) => event.actor))).sort();
    return [{ label: t("filters.allTypes"), value: "all" }, ...actors.map((actor) => ({ label: actor, value: actor }))];
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
      if (actorFilter !== "all" && event.actor !== actorFilter) return false;
      if (actionFilter !== "all" && event.action !== actionFilter) return false;
      if (resultFilter !== "all" && getAuditResult(event) !== resultFilter) return false;
      if (resourceFilter !== "all" && getAuditResourceType(event) !== resourceFilter) return false;
      if (createdAfter && new Date(event.createdAt).getTime() < createdAfter) return false;
      if (normalizedIpQuery && !getAuditMetadataValue(event, ["ip", "ipAddress", "visitorIp"]).toLocaleLowerCase().includes(normalizedIpQuery)) return false;
      if (!normalizedQuery) return true;
      return [
        event.id,
        event.action,
        event.actor,
        event.target,
        event.shareToken,
        event.nodeId,
        JSON.stringify(event.metadata),
      ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [actionFilter, actorFilter, events, ipQuery, query, resourceFilter, resultFilter, timeFilter]);
  const focusedEvent = filteredEvents.find((event) => event.id === focusedEventId) ?? filteredEvents[0] ?? events[0];
  const resetFilters = () => {
    setActorFilter("all");
    setActionFilter("all");
    setResultFilter("all");
    setResourceFilter("all");
    setTimeFilter("all");
    setIpQuery("");
    setQuery("");
  };

  return (
    <div className="drive-module-stack drive-audit-module">
      <div className="drive-audit-filter-panel">
        <div className="drive-audit-filter-panel-header">
          <div>
            <LocalIcon name="slider" size={17} />
            <span>{t("audit.filters")}</span>
          </div>
          <div className="drive-audit-filter-actions">
            <StatusPill palette={palette}>{filteredEvents.length}</StatusPill>
            <ToolButton label={t("audit.resetFilters")} palette={palette} onClick={resetFilters} tooltipPlacement="bottom">
              <LocalIcon name="cross" size={16} />
            </ToolButton>
            <ToolButton label={t("app.refresh")} palette={palette} onClick={onRefresh} tooltipPlacement="bottom end">
              <LocalIcon name="refresh" size={16} />
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
            <AppInput aria-label={t("audit.keyword")} palette={palette} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label className="drive-audit-filter" data-wide="true">
            <span>{t("audit.ipAddress")}</span>
            <AppInput aria-label={t("audit.ipAddress")} palette={palette} value={ipQuery} onChange={(event) => setIpQuery(event.target.value)} />
          </label>
        </div>
      </div>

      <section className="drive-module-split drive-audit-split">
        <div className="drive-module-panel">
          <ModulePanelHeader
            icon="shield"
            title={t("audit.title")}
            trailing={(
              <ToolButton label={t("app.refresh")} palette={palette} onClick={onRefresh}>
                <LocalIcon name="refresh" size={16} />
              </ToolButton>
            )}
          />
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
                <span>{t("audit.result")}</span>
                <span>{t("audit.ipAddress")}</span>
                <span>{t("actions.more")}</span>
              </div>
            ) : null}
            {filteredEvents.map((row) => (
              <div key={row.id} data-motion-row data-active={focusedEvent?.id === row.id ? "true" : undefined} className="drive-module-table-row drive-audit-row">
                <span className="drive-audit-time-cell icedr-truncate">{formatAbsoluteDate(row.createdAt, locale, timeZone)}</span>
                <div className="drive-audit-actor-cell">
                  <span className="drive-module-row-icon" data-tone={getAuditResult(row) === "failed" ? "danger" : getAuditIconTone(row.action)}>
                    <LocalIcon name={getAuditIcon(row.action, getAuditResult(row))} size={18} />
                  </span>
                  <div className="drive-module-row-copy">
                    <span className="drive-module-row-title icedr-truncate">{row.actor}</span>
                    <span className="drive-module-inline-note icedr-truncate">{row.id}</span>
                  </div>
                </div>

                <StatusPill palette={palette} tone={getAuditResult(row) === "failed" ? "risk" : getAuditActionTone(row.action)}>
                  {formatAuditAction(row.action, t)}
                </StatusPill>
                <div className="drive-audit-resource-cell">
                  <span className="drive-module-row-title icedr-truncate">{row.target}</span>
                  <div className="drive-module-row-meta">
                    {[row.shareToken, row.nodeId].filter(Boolean).map((value) => (
                      <MetaIcon key={value} icon="key">{value}</MetaIcon>
                    ))}
                  </div>
                </div>
                <StatusPill palette={palette} tone={getAuditResult(row) === "failed" ? "risk" : "secure"}>
                  {getAuditResult(row) === "failed" ? t("transfers.failed") : t("audit.success")}
                </StatusPill>
                <span className="drive-audit-ip-cell icedr-truncate">{getAuditMetadataValue(row, ["ip", "ipAddress", "visitorIp"])}</span>
                <ToolButton active={focusedEvent?.id === row.id} label={t("links.viewDetails")} palette={palette} size="sm" onClick={() => setFocusedEventId(row.id)}>
                  <LocalIcon name="visible" size={15} />
                </ToolButton>
              </div>
            ))}
          </MotionList>
        </div>

        <aside className="drive-module-side-card drive-audit-details">
          <ModulePanelHeader icon="info" title={t("audit.details")} compact />
          {focusedEvent ? (
            <div className="drive-audit-detail-body">
              <section className="drive-audit-details-section">
                <span>{t("audit.basicInfo")}</span>
                <InfoRow label={t("audit.id")} value={focusedEvent.id} />
                <InfoRow label={t("files.modified")} value={formatAbsoluteDate(focusedEvent.createdAt, locale, timeZone)} />
                <InfoRow label={t("audit.actor")} value={focusedEvent.actor} />
                <InfoRow label={t("audit.ipAddress")} value={getAuditMetadataValue(focusedEvent, ["ip", "ipAddress", "visitorIp"])} />
                <InfoRow label={t("audit.result")} value={getAuditResult(focusedEvent) === "failed" ? t("transfers.failed") : t("audit.success")} />
              </section>
              <section className="drive-audit-details-section">
                <span>{t("audit.actionContent")}</span>
                <InfoRow label={t("audit.actionType")} value={formatAuditAction(focusedEvent.action, t)} />
                <InfoRow label={t("audit.resource")} value={focusedEvent.target} />
              </section>
              <section className="drive-audit-details-section">
                <span>{t("audit.moreInfo")}</span>
                <InfoRow label={t("links.code")} value={focusedEvent.shareToken ?? "--"} />
                <InfoRow label={t("files.name")} value={focusedEvent.nodeId ?? "--"} />
              </section>
            </div>
          ) : (
            <EmptyModuleState icon="info" title={t("audit.emptyTitle")} hint={t("audit.emptyHint")} compact />
          )}
        </aside>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  tone = "blue",
  value,
}: {
  icon: LocalIconName;
  label: string;
  tone?: "blue" | "danger" | "purple" | "success" | "warning";
  value: string;
}) {
  return (
    <section className="drive-module-stat-card">
      <div className="drive-module-stat-copy">
        <span>{value}</span>
        <span>{label}</span>
      </div>
      <span className="drive-module-stat-icon" data-tone={tone}>
        <LocalIcon name={icon} size={22} />
      </span>
    </section>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="drive-module-info-row">
      <span>{label}</span>
      <span className="icedr-truncate">{value || "--"}</span>
    </div>
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

function getAuditResult(row: AuditEventResponse) {
  const value = row.metadata.result;
  return typeof value === "string" && value.toLowerCase().includes("fail") ? "failed" : "success";
}

function getAuditResourceType(row: AuditEventResponse): AuditResourceFilter {
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

function getAuditActionTone(action: string) {
  if (action.startsWith("share.")) return "accent" as const;
  if (action.includes("download") || action.includes("preview")) return "secure" as const;
  if (action.includes("deleted") || action.includes("archived") || action.includes("revoked")) return "risk" as const;
  return "neutral" as const;
}

function getAuditIconTone(action: string) {
  if (action.startsWith("share.")) return "blue";
  if (action.startsWith("transfer.")) return undefined;
  if (action.includes("download") || action.includes("preview")) return "green";
  return "blue";
}

function getAuditIcon(action: string, result: ReturnType<typeof getAuditResult>): LocalIconName {
  if (result === "failed") return "exclamation";
  if (action.startsWith("share.")) return "link";
  if (action.startsWith("transfer.")) return "upload";
  if (action.includes("download")) return "download";
  if (action.includes("preview")) return "visible";
  if (action.includes("deleted") || action.includes("archived")) return "trash";
  return "shield";
}

function getAuditMetadataValue(row: AuditEventResponse, keys: string[]) {
  for (const key of keys) {
    const value = row.metadata[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "--";
}
