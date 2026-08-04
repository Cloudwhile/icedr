import type { DriveItem, Locale } from "@/features/file/model";

export function formatDriveItemDate(value: string | null | undefined, locale: Locale, timeZone?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale.replace(/_/g, "-"), {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function getFilePathHint(item: DriveItem) {
  return item.searchPath || item.originalPath || null;
}
