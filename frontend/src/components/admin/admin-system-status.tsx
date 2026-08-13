"use client";

import { LocalIcon } from "@/components/ui/app-icon";
import {
  getIntlLocale,
  type Locale,
  type LocalIconName,
} from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type { SystemOverview } from "@/lib/drive-api";
import "./admin-system-status.css";

type StatusRow = {
  label: string;
  value: string;
};

export function AdminSystemStatus({
  locale,
  systemOverview,
}: {
  locale: Locale;
  systemOverview: SystemOverview | null;
}) {
  const t = useTranslations();
  const memoryUsage = systemOverview
    ? formatPercent(systemOverview.memoryUsagePercent, locale)
    : "--";
  const systemRows: StatusRow[] = [
    {
      label: t("settings.appVersion"),
      value: systemOverview
        ? systemOverview.appVersionTag || systemOverview.appVersion || "--"
        : "--",
    },
    {
      label: t("settings.runtime"),
      value: systemOverview?.runtime || "--",
    },
    {
      label: t("settings.nodeVersion"),
      value: systemOverview?.nodeVersion || "--",
    },
    {
      label: t("settings.systemArchitecture"),
      value: systemOverview?.architecture || "--",
    },
    {
      label: t("settings.operatingSystem"),
      value: systemOverview
        ? `${systemOverview.operatingSystem} ${systemOverview.osRelease}`.trim()
        : "--",
    },
    {
      label: t("settings.hostUptime"),
      value: systemOverview
        ? formatDuration(systemOverview.osUptimeSeconds, t)
        : "--",
    },
    {
      label: t("settings.driveUptime"),
      value: systemOverview
        ? formatDuration(systemOverview.processUptimeSeconds, t)
        : "--",
    },
    {
      label: t("settings.serviceStartedAt"),
      value: formatDate(systemOverview?.serviceStartedAt, locale),
    },
  ];
  return (
    <section
      aria-label={t("settings.systemStatus")}
      className="admin-system-status"
    >
      <h1 className="icedr-sr-only">{t("settings.systemStatus")}</h1>
      <div className="admin-system-status-summary" role="list">
        <StatusMetric
          icon="info"
          label={t("settings.appVersion")}
          tone="primary"
          value={
            systemOverview
              ? systemOverview.appVersionTag || systemOverview.appVersion || "--"
              : "--"
          }
        />
        <StatusMetric
          icon="grid"
          label={t("admin.memoryUsage")}
          tone="neutral"
          value={memoryUsage}
        />
      </div>

      <div className="admin-system-status-sections">
        <StatusSection
          icon="info"
          rows={systemRows}
          title={t("settings.systemInformation")}
        />
      </div>
    </section>
  );
}

function StatusMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: LocalIconName;
  label: string;
  tone: "neutral" | "primary";
  value: string;
}) {
  return (
    <div className="admin-system-status-metric" data-tone={tone} role="listitem">
      <span className="admin-system-status-metric-icon">
        <LocalIcon name={icon} size={17} />
      </span>
      <span className="admin-system-status-metric-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function StatusSection({
  icon,
  rows,
  title,
}: {
  icon: LocalIconName;
  rows: StatusRow[];
  title: string;
}) {
  return (
    <section className="admin-system-status-section">
      <header>
        <LocalIcon name={icon} size={16} />
        <h2>{title}</h2>
      </header>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatPercent(value: number | null | undefined, locale: Locale) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "--";
  return new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value) + "%";
}

function formatDate(value: string | null | undefined, locale: Locale) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(
  seconds: number,
  t: ReturnType<typeof useTranslations>,
) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (days > 0) return t("settings.durationDaysHours", { days, hours });
  if (hours > 0)
    return t("settings.durationHoursMinutes", { hours, minutes });
  return t("settings.durationMinutes", { minutes });
}
