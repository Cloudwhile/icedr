import { getIntlLocale, type Locale } from "@/features/file/model";

export type QuotaUnit = "B" | "KB" | "MB" | "GB" | "TB";

export type QuotaDraftState = {
  source: number | null;
  unit: QuotaUnit;
  value: string;
};

export const quotaUnits: Array<{
  factor: number;
  key: string;
  value: QuotaUnit;
}> = [
  { factor: 1, key: "settings.quotaUnitBytes", value: "B" },
  { factor: 1024, key: "settings.quotaUnitKilobytes", value: "KB" },
  { factor: 1024 ** 2, key: "settings.quotaUnitMegabytes", value: "MB" },
  { factor: 1024 ** 3, key: "settings.quotaUnitGigabytes", value: "GB" },
  { factor: 1024 ** 4, key: "settings.quotaUnitTerabytes", value: "TB" },
];

export function createQuotaDraftState(source: number | null): QuotaDraftState {
  if (source === null) return { source, unit: "GB", value: "" };
  const unit = chooseQuotaUnit(source);
  const factor = getQuotaUnitFactor(unit);
  return { source, unit, value: formatQuotaInputValue(source / factor) };
}

export function resolveQuotaDraftState(
  state: QuotaDraftState,
  source: number | null,
) {
  return state.source === source ? state : createQuotaDraftState(source);
}

export function changeQuotaDraftUnit(
  current: QuotaDraftState,
  source: number | null,
  unit: QuotaUnit,
) {
  const bytes = parseQuotaBytes(current.value, current.unit);
  if (bytes === null) return { source, unit, value: "" };
  if (bytes === undefined) return { ...current, source, unit };
  return {
    source,
    unit,
    value: formatQuotaInputValue(bytes / getQuotaUnitFactor(unit)),
  };
}

export function parseQuotaBytes(
  value: string,
  unit: QuotaUnit,
): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const bytes = Math.round(amount * getQuotaUnitFactor(unit));
  if (!Number.isSafeInteger(bytes) || bytes < 0) return undefined;
  return bytes;
}

export function normalizeQuotaInput(value: string) {
  const normalized = value.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(".");
  if (decimalParts.length === 0) return integerPart;
  return `${integerPart}.${decimalParts.join("")}`;
}

export function formatCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null, locale: Locale) {
  if (value === null) return "--";
  return new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value / 100);
}

export function formatSystemDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= 0)
    return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function chooseQuotaUnit(bytes: number): QuotaUnit {
  const positiveBytes = Math.max(0, bytes);
  return (
    [...quotaUnits].reverse().find((unit) => positiveBytes >= unit.factor)
      ?.value ?? "B"
  );
}

function getQuotaUnitFactor(unit: QuotaUnit) {
  return quotaUnits.find((quotaUnit) => quotaUnit.value === unit)?.factor ?? 1;
}

function formatQuotaInputValue(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}
