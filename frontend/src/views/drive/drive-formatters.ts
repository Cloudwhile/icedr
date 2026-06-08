import type { useTranslations } from "@/i18n/react";
import { formatFileSize, getIntlLocale, type Locale } from "@/features/file/model";
import type { SystemOverview } from "@/lib/drive-api";
import type { TransferRow } from "./drive-types";

type DriveTranslator = ReturnType<typeof useTranslations>;

export function getTransferMetricLine(row: TransferRow, locale: Locale, t: DriveTranslator) {
  if (row.status === "completed") return row.totalBytes ? formatFileSize(row.totalBytes, locale) : null;
  if (row.status === "failed" || row.status === "canceled") return null;

  const parts: string[] = [];
  parts.push(t("transfers.speedValue", {
    speed: row.speedBytesPerSecond && row.speedBytesPerSecond > 0 ? formatFileSize(row.speedBytesPerSecond, locale) : "--",
  }));
  parts.push(t("transfers.remainingValue", {
    time: row.remainingSeconds !== undefined && row.remainingSeconds !== null ? formatRemainingTime(row.remainingSeconds, t) : "--",
  }));
  return parts.join(" / ") || null;
}

export function formatRemainingTime(seconds: number, t: DriveTranslator) {
  const rounded = Math.max(0, Math.ceil(seconds));
  if (rounded <= 1) return t("time.lessThanSecond");
  if (rounded < 60) return t("time.seconds", { count: rounded });

  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return remainingSeconds > 0
    ? t("time.minutesSeconds", { minutes, seconds: remainingSeconds })
    : t("time.minutes", { count: minutes });
}

export function formatAbsoluteDate(value: string, locale: Locale, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatAuditAction(action: string, t: DriveTranslator) {
  const translationKey = `audit.actions.${action}`;
  const mapped = t(translationKey);
  if (mapped !== translationKey) return mapped;

  return t("audit.actions.unknown", { action });
}

export function formatSystemOperatingSystem(systemOverview: SystemOverview) {
  return `${systemOverview.operatingSystem} ${systemOverview.osRelease}`.trim();
}

export function formatSystemDuration(seconds: number, t: DriveTranslator) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (days > 0) return t("settings.durationDaysHours", { days, hours });
  if (hours > 0) return t("settings.durationHoursMinutes", { hours, minutes });
  return t("settings.durationMinutes", { minutes });
}
