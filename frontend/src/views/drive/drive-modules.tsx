"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { MotionList } from "@/components/ui/motion";
import { findDriveItem, formatFileSize, type DriveItem, type Locale, type Palette } from "@/features/file/model";
import type { AuditEventResponse } from "@/lib/drive-api";
import type { RegisteredShare } from "@/features/share/registry";
import type { TransferRow } from "./drive-types";
import { formatAbsoluteDate, formatAuditAction, getTransferMetricLine } from "./drive-formatters";
import { AnimatedCheckMark, ItemIcon, LocalIcon, StatusPill, Surface, ToolButton } from "./drive-primitives";

export type LinksModuleProps = {
  error: string | null;
  links: RegisteredShare[];
  onCloseLink: (id: string) => void;
  onCopyLink: (id: string) => void;
  onFocusRecords: () => void;
  palette: Palette;
  sourceItems: DriveItem[];
};

export function LinksModule({ error, links, onCloseLink, onCopyLink, onFocusRecords, palette, sourceItems }: LinksModuleProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const riskLinks = links.filter((link) => link.riskLevel === "high");
  const expiringSoon = links.filter((link) => link.status === "expired");
  const emailGatedLinks = links.filter((link) => Boolean(link.policy.allowedDomain || link.policy.waitValue > 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ alignItems: "center", color: palette.subtle, display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "8px" }}>
        <LocalIcon name="user_group" size={14} />
        <span>{t("links.memberScope")}</span>
        <span>/</span>
        <LocalIcon name="shield" size={14} />
        <span>{t("links.adminScope")}</span>
      </div>

      <div
        className="icedr-r-grid-template-columns"
        style={{
          display: "grid",
          gap: "12px",
          "--r-grid-template-columns-base": "1fr",
          "--r-grid-template-columns-md": "1.2fr repeat(3, minmax(0, 1fr))",
        } as React.CSSProperties}
      >
        <Surface palette={palette} style={{ padding: "16px" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "12px", justifyContent: "space-between" }}>
            <div style={{ minWidth: "0px" }}>
              <span style={{ color: palette.muted, display: "block", fontWeight: "600" }}>{t("links.overviewTitle")}</span>
              <span style={{ color: palette.subtle, display: "block", fontSize: "12px", marginTop: "4px" }}>{t("links.overviewHint")}</span>
            </div>
            <LocalIcon name="link" size={22} color={palette.primary} />
          </div>
        </Surface>
        {[
          [t("links.highRisk"), String(riskLinks.length)],
          [t("links.expiringSoon"), String(expiringSoon.length)],
          [t("links.protected"), String(emailGatedLinks.length)],
        ].map(([label, value]) => (
          <Surface key={label} palette={palette} style={{ padding: "16px" }}>
            <span style={{ color: palette.subtle, display: "block", fontSize: "12px" }}>{label}</span>
            <span style={{ color: palette.ink, display: "block", fontSize: "22px", fontWeight: "600", lineHeight: "1.2", marginTop: "8px" }}>{value}</span>
          </Surface>
        ))}
      </div>

      <div
        className="icedr-r-grid-template-columns"
        style={{
          display: "grid",
          gap: "12px",
          "--r-grid-template-columns-base": "1fr",
          "--r-grid-template-columns-lg": "repeat(2, minmax(0, 1fr))",
        } as React.CSSProperties}
      >
        {riskLinks.map((link) => {
          const item = findDriveItem(link.rootItemIds[0] ?? "", sourceItems);
          return (
            <Surface key={`risk-${link.token}`} palette={palette} style={{ borderColor: palette.hairlineStrong, padding: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ alignItems: "center", display: "flex", gap: "12px", justifyContent: "space-between" }}>
                  <div style={{ alignItems: "center", color: palette.primaryHover, display: "flex", gap: "8px", minWidth: "0px" }}>
                    <LocalIcon name="exclamation" size={17} />
                    <span className="icedr-truncate" style={{ fontWeight: "700" }}>
                      {item?.name ?? link.title}
                    </span>
                  </div>
                  <StatusPill palette={palette} tone="risk">
                    {t("links.highRisk")}
                  </StatusPill>
                </div>
                <span style={{ color: palette.subtle, fontSize: "12px" }}>{t("links.riskSignal")}</span>
                <div style={{ alignItems: "center", display: "flex", gap: "4px" }}>
                  <ToolButton label={t("links.viewDetails")} palette={palette} onClick={onFocusRecords}>
                    <LocalIcon name="visible" size={16} />
                  </ToolButton>
                  <ToolButton label={t("links.disableLink")} palette={palette} onClick={() => onCloseLink(link.token)}>
                    <LocalIcon name="ban" size={16} />
                  </ToolButton>
                </div>
              </div>
            </Surface>
          );
        })}
      </div>

      <Surface palette={palette} style={{ overflow: "hidden" }}>
        <div
          style={{
            alignItems: "center",
            borderBottomWidth: "1px",
            borderColor: palette.hairline,
            display: "flex",
            gap: "12px",
            height: "46px",
            justifyContent: "space-between",
            paddingInline: "16px",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: "8px", minWidth: "0px" }}>
            <LocalIcon name="link" size={16} color={palette.primary} />
            <span className="icedr-truncate" style={{ color: palette.muted, fontWeight: "600" }}>
              {t("links.title")}
            </span>
          </div>
          <StatusPill palette={palette}>{links.length}</StatusPill>
        </div>

        {error ? (
          <div style={{ borderBottomWidth: "1px", borderColor: palette.hairline, paddingBlock: "16px", paddingInline: "16px" }}>
            <StatusPill palette={palette} tone="risk">
              {error}
            </StatusPill>
          </div>
        ) : null}

        <MotionList key={links.map((link) => link.token).join("|")} style={{ display: "flex", flexDirection: "column" }}>
          {links.length === 0 && !error ? <EmptyModuleState icon={<LocalIcon name="link" size={24} color={palette.primary} />} palette={palette} title={t("links.emptyTitle")} hint={t("links.emptyHint")} /> : null}
          {links.map((link) => {
            const item = findDriveItem(link.rootItemIds[0] ?? "", sourceItems);
            const itemName = item?.name ?? link.title;
            const status = link.status ?? (link.revokedAt ? "revoked" : "active");
            const statusTone = link.riskLevel === "high" ? "risk" : status === "active" ? "secure" : "neutral";

            return (
              <div
                key={link.token}
                data-motion-row
                className="icedr-r-align-items icedr-last-border-reset"
                style={{
                  "--last-border-bottom-width": "0px",
                  "--r-align-items-base": "flex-start",
                  "--r-align-items-md": "center",
                  borderBottomWidth: "1px",
                  borderColor: palette.hairline,
                  display: "flex",
                  gap: "12px",
                  justifyContent: "space-between",
                  paddingBlock: "12px",
                  paddingInline: "16px",
                } as React.CSSProperties}
              >
                <div style={{ alignItems: "center", display: "flex", flex: "1 1 auto", gap: "12px", minWidth: "0px" }}>
                  {item ? <ItemIcon item={item} palette={palette} size={18} /> : <LocalIcon name="link" size={18} color={palette.primary} />}
                  <div style={{ minWidth: "0px" }}>
                    <span className="icedr-truncate" style={{ color: palette.ink, display: "block", fontWeight: "500" }}>
                      {itemName}
                    </span>
                    <div style={{ alignItems: "center", color: palette.subtle, display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "12px", marginTop: "4px" }}>
                      <StatusPill palette={palette} tone={statusTone}>
                        {link.riskLevel === "high" ? t("links.highRisk") : t(`links.status.${status}`)}
                      </StatusPill>
                      <MetaIcon icon="user_group">{link.allowDownload ? t("links.anyone") : t("links.teamOnly")}</MetaIcon>
                      <MetaIcon icon="clock">{t("links.daysValue", { count: link.expiresDays })}</MetaIcon>
                      <MetaIcon icon="visible">{t("links.visitsValue", { count: String(link.visitCount ?? 0) })}</MetaIcon>
                      <MetaIcon icon="download">{t("links.downloadsValue", { count: String(link.downloadCount ?? 0) })}</MetaIcon>
                      <MetaIcon icon="calendar">{formatAbsoluteDate(link.createdAt, locale, timeZone)}</MetaIcon>
                      {link.lastAccessAt ? <MetaIcon icon="key">{t("links.lastAccessValue", { value: formatAbsoluteDate(link.lastAccessAt, locale, timeZone) })}</MetaIcon> : null}
                    </div>
                  </div>
                </div>

                <div style={{ alignItems: "center", display: "flex", flexShrink: "0", gap: "4px" }}>
                  {emailGatedLinks.includes(link) ? (
                    <StatusPill
                      palette={palette}
                      tone="secure"
                      className="icedr-r-display"
                      style={{
                        "--r-display-base": "none",
                        "--r-display-sm": "inline-flex",
                      } as React.CSSProperties}
                    >
                      {t("links.protectedLink")}
                    </StatusPill>
                  ) : null}
                  <ToolButton label={t("actions.copyLink")} palette={palette} onClick={() => onCopyLink(link.token)}>
                    <LocalIcon name="copy" size={16} />
                  </ToolButton>
                  <ToolButton label={t("links.viewRecords")} palette={palette} onClick={onFocusRecords}>
                    <LocalIcon name="shield" size={16} />
                  </ToolButton>
                  <ToolButton label={t("links.closeLink")} palette={palette} onClick={() => onCloseLink(link.token)}>
                    <LocalIcon name="ban" size={16} />
                  </ToolButton>
                </div>
              </div>
            );
          })}
        </MotionList>
      </Surface>
    </div>
  );
}

function MetaIcon({ children, icon }: { children: React.ReactNode; icon: "calendar" | "clock" | "download" | "key" | "user_group" | "visible" }) {
  return (
    <div style={{ alignItems: "center", display: "flex", gap: "4px", minWidth: "0px" }}>
      <LocalIcon name={icon} size={13} />
      <span className="icedr-truncate">{children}</span>
    </div>
  );
}

export function TransfersModule({ palette, rows }: { palette: Palette; rows: TransferRow[] }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  return (
    <Surface palette={palette} style={{ overflow: "hidden" }}>
      <div style={{ alignItems: "center", borderBottomWidth: "1px", borderColor: palette.hairline, display: "flex", height: "46px", paddingInline: "16px" }}>
        <span style={{ color: palette.muted, fontWeight: "600" }}>{t("transfers.title")}</span>
      </div>
      <MotionList key={rows.map((row) => row.id).join("|")} style={{ display: "flex", flexDirection: "column" }}>
        {rows.length === 0 ? <EmptyModuleState icon={<LocalIcon name="upload" size={24} color={palette.primary} />} palette={palette} title={t("transfers.emptyTitle")} hint={t("transfers.emptyHint")} /> : null}
        {rows.map((row) => {
          const metricLine = getTransferMetricLine(row, locale, t);
          return (
            <div
              key={row.id}
              data-motion-row
              className="icedr-r-align-items icedr-last-border-reset"
              style={{
                "--last-border-bottom-width": "0px",
                "--r-align-items-base": "flex-start",
                "--r-align-items-md": "center",
                borderBottomWidth: "1px",
                borderColor: palette.hairline,
                display: "flex",
                gap: "16px",
                justifyContent: "space-between",
                paddingBlock: "16px",
                paddingInline: "16px",
              } as React.CSSProperties}
            >
              <div style={{ alignItems: "center", display: "flex", flex: "1 1 auto", gap: "12px", minWidth: "0px" }}>
                {row.status === "completed" ? (
                  <div aria-hidden="true" style={{ alignItems: "center", color: palette.success, display: "flex", height: "18px", justifyContent: "center", width: "18px" }}>
                    <AnimatedCheckMark size={18} />
                  </div>
                ) : (
                  <LocalIcon name={row.status === "failed" ? "exclamation" : row.type === "upload" ? "upload" : "download"} size={18} color={row.status === "failed" ? palette.primaryHover : palette.primary} />
                )}
                <div style={{ minWidth: "0px" }}>
                  <span className="icedr-truncate" style={{ color: palette.ink, display: "block", fontWeight: "500" }}>
                    {row.name}
                  </span>
                  <span style={{ color: palette.subtle, display: "block", fontSize: "12px" }}>
                    {t(`transfers.${row.type}`)} - {t(`transfers.${row.status}`)}
                  </span>
                  {metricLine ? (
                    <span className="icedr-truncate" style={{ color: palette.tertiary, display: "block", fontSize: "12px", marginTop: "4px" }}>
                      {metricLine}
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                className="icedr-r-width"
                style={{
                  alignItems: "stretch",
                  display: "flex",
                  flexDirection: "column",
                  flexShrink: "0",
                  gap: "6px",
                  "--r-width-base": "120px",
                  "--r-width-md": "220px",
                } as React.CSSProperties}
              >
                <div style={{ alignItems: "center", color: palette.subtle, display: "flex", fontSize: "12px", gap: "8px", justifyContent: "space-between", lineHeight: "1.2" }}>
                  <span style={{ fontWeight: "650" }}>{Math.round(row.progress)}%</span>
                  {row.loadedBytes !== undefined && row.totalBytes !== undefined ? (
                    <span
                      className="icedr-r-display"
                      style={{
                        "--r-display-base": "none",
                        "--r-display-md": "block",
                        color: palette.tertiary,
                      } as React.CSSProperties}
                    >
                      {formatFileSize(row.loadedBytes, locale)} / {formatFileSize(row.totalBytes, locale)}
                    </span>
                  ) : null}
                </div>
                <ProgressMeter ariaLabel={row.name} color={row.status === "failed" ? palette.primaryHover : row.status === "completed" ? palette.success : palette.primary} palette={palette} value={row.progress} />
              </div>
            </div>
          );
        })}
      </MotionList>
    </Surface>
  );
}

function EmptyModuleState({ hint, icon, palette, title }: { hint: string; icon: React.ReactNode; palette: Palette; title: string }) {
  return (
    <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: "8px", paddingBlock: "40px", paddingInline: "16px", textAlign: "center" }}>
      <div style={{ alignItems: "center", background: palette.surface2, borderRadius: "8px", display: "flex", height: "44px", justifyContent: "center", width: "44px" }}>{icon}</div>
      <span style={{ color: palette.ink, fontWeight: "700" }}>{title}</span>
      <span style={{ color: palette.subtle, fontSize: "12px", maxWidth: "360px" }}>{hint}</span>
    </div>
  );
}

export function AuditModule({
  error,
  events,
  onRefresh,
  palette,
}: {
  error: string | null;
  events: AuditEventResponse[];
  onRefresh: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();

  return (
    <Surface palette={palette} style={{ overflow: "hidden" }}>
      <div
        style={{
          alignItems: "center",
          borderBottomWidth: "1px",
          borderColor: palette.hairline,
          display: "flex",
          gap: "12px",
          height: "46px",
          justifyContent: "space-between",
          paddingInline: "16px",
        }}
      >
        <span style={{ color: palette.muted, fontWeight: "600" }}>{t("audit.title")}</span>
        <ToolButton label={t("app.refresh")} palette={palette} onClick={onRefresh}>
          <LocalIcon name="refresh" size={16} />
        </ToolButton>
      </div>
      {error ? (
        <div style={{ borderBottomWidth: "1px", borderColor: palette.hairline, paddingBlock: "16px", paddingInline: "16px" }}>
          <StatusPill palette={palette} tone="risk">
            {error}
          </StatusPill>
        </div>
      ) : null}
      <MotionList key={events.map((row) => row.id).join("|")} style={{ display: "flex", flexDirection: "column" }}>
        {events.length === 0 && !error ? <EmptyModuleState icon={<LocalIcon name="shield" size={24} color={palette.secure} />} palette={palette} title={t("audit.emptyTitle")} hint={t("audit.emptyHint")} /> : null}
        {events.map((row) => (
          <div
            key={row.id}
            data-motion-row
            className="icedr-last-border-reset"
            style={{
              "--last-border-bottom-width": "0px",
              alignItems: "center",
              borderBottomWidth: "1px",
              borderColor: palette.hairline,
              display: "flex",
              gap: "16px",
              justifyContent: "space-between",
              paddingBlock: "16px",
              paddingInline: "16px",
            } as React.CSSProperties}
          >
            <div style={{ alignItems: "center", display: "flex", gap: "12px", minWidth: "0px" }}>
              <LocalIcon name="shield" size={18} color={palette.secure} />
              <div style={{ minWidth: "0px" }}>
                <span className="icedr-truncate" style={{ color: palette.muted, display: "block" }}>
                  <span style={{ color: palette.ink, fontWeight: "600" }}>{row.actor}</span> {formatAuditAction(row.action)} {row.target}
                </span>
                <span className="icedr-truncate" style={{ color: palette.subtle, display: "block", fontSize: "12px" }}>
                  {[row.shareToken, row.nodeId].filter(Boolean).join(" / ")}
                </span>
              </div>
            </div>
            <span style={{ color: palette.subtle, flexShrink: "0", fontSize: "12px", whiteSpace: "nowrap" }}>{formatAbsoluteDate(row.createdAt, locale, timeZone)}</span>
          </div>
        ))}
      </MotionList>
    </Surface>
  );
}
