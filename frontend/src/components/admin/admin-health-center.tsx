"use client";

import { LocalIcon } from "@/components/ui/app-icon";
import { ToolButton } from "@/components/ui/tool-button";
import {
  getIntlLocale,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type {
  AdminHealthCheckId,
  AdminHealthResponse,
  AdminHealthStatus,
} from "@/lib/drive-api";
import "./admin-health-center.css";

export function AdminHealthCenter({
  data,
  error,
  initialLoading,
  lastSuccessfulAt,
  locale,
  onOpenSettings,
  onRetry,
  palette,
  refreshing,
  stale,
  timeZone,
}: {
  data: AdminHealthResponse | null;
  error: string | null;
  initialLoading: boolean;
  lastSuccessfulAt: string | null;
  locale: Locale;
  onOpenSettings: (path: string) => void;
  onRetry: () => void;
  palette: Palette;
  refreshing: boolean;
  stale: boolean;
  timeZone: string;
}) {
  const t = useTranslations();
  const status = data?.status ?? "unknown";
  const checkedAt = data?.checkedAt ?? lastSuccessfulAt;

  return (
    <section
      aria-busy={initialLoading || refreshing || undefined}
      aria-label={t("admin.healthSummary")}
      className="admin-health-center"
    >
      <header className="admin-health-header">
        <div>
          <span className="admin-health-overall" data-status={status}>
            <LocalIcon name={statusIcon(status)} size={18} />
          </span>
          <div>
            <h2>{t("admin.healthSummary")}</h2>
            <span>
              {t("admin.healthCheckedAt", {
                time: initialLoading && !checkedAt
                  ? t("app.loading")
                  : formatCheckedAt(checkedAt, locale, timeZone),
              })}
            </span>
          </div>
        </div>
        <div>
          {stale ? <span className="admin-health-stale">{t("audit.stale")}</span> : null}
          <strong data-status={status}>{t(`admin.healthStatus.${status}`)}</strong>
          <ToolButton
            isPending={initialLoading || refreshing}
            label={t("actions.refresh")}
            onClick={onRetry}
            palette={palette}
          >
            <LocalIcon name="refresh" size={16} />
          </ToolButton>
        </div>
      </header>

      {error ? <div className="admin-health-error" role="alert">{error}</div> : null}

      <div className="admin-health-checks" role="list">
        {(data?.checks ?? defaultChecks).map((check) => (
          <article className="admin-health-check" data-status={check.status} key={check.id} role="listitem">
            <span className="admin-health-check-icon">
              <LocalIcon name={checkIcon(check.id)} size={17} />
            </span>
            <div className="admin-health-check-copy">
              <strong>{t(`admin.healthCheck.${check.id}`)}</strong>
              <span>{check.reason || t(`admin.healthStatus.${check.status}`)}</span>
              <small>
                {check.checkedAt
                  ? `${t("admin.healthDuration", {
                      duration: String(check.durationMs),
                    })} · ${formatCheckedAt(check.checkedAt, locale, timeZone)}`
                  : initialLoading
                    ? t("app.loading")
                    : t("admin.healthStatus.unknown")}
              </small>
            </div>
            <div className="admin-health-check-actions">
              <span className="admin-health-status" data-status={check.status}>
                {t(`admin.healthStatus.${check.status}`)}
              </span>
              {check.settingsPath ? (
                <ToolButton
                  label={t("admin.openRelatedSettings")}
                  onClick={() => onOpenSettings(check.settingsPath!)}
                  palette={palette}
                >
                  <LocalIcon name="settings" size={15} />
                </ToolButton>
              ) : null}
              {check.status !== "ok" ? (
                <ToolButton
                  isPending={initialLoading || refreshing}
                  label={t("admin.retryHealthCheck", {
                    check: t(`admin.healthCheck.${check.id}`),
                  })}
                  onClick={onRetry}
                  palette={palette}
                >
                  <LocalIcon name="refresh" size={15} />
                </ToolButton>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const defaultChecks = ([
  "application",
  "database",
  "storage",
  "mail",
  "queue",
  "reconcile",
] as AdminHealthCheckId[]).map((id) => ({
  checkedAt: "",
  durationMs: 0,
  id,
  reason: null,
  settingsPath: null,
  status: "unknown" as const,
}));

function checkIcon(id: AdminHealthCheckId) {
  const icons = {
    application: "laptop",
    database: "grid",
    mail: "mail",
    queue: "time",
    reconcile: "refresh",
    storage: "folder",
  } as const;
  return icons[id];
}

function statusIcon(status: AdminHealthStatus) {
  if (status === "ok") return "tick" as const;
  if (status === "error") return "exclamation" as const;
  if (status === "warning") return "info" as const;
  return "clock" as const;
}

function formatCheckedAt(
  value: string | null | undefined,
  locale: Locale,
  timeZone: string,
) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  }).format(date);
}
