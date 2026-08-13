type DateTimeParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function formatZonedDateTimeLocal(
  value: string | undefined,
  timeZone?: string,
) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = readZonedParts(date, timeZone);
  if (!parts) return "";
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseZonedDateTimeLocal(value: string, timeZone?: string) {
  if (!value) return undefined;
  const desired = parseDateTimeLocal(value);
  if (!desired) return undefined;

  const desiredWallTime = toUtcTimestamp(desired);
  let candidate = desiredWallTime;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = readZonedParts(new Date(candidate), timeZone);
    if (!actual) return undefined;
    const difference = desiredWallTime - toUtcTimestamp(actual);
    if (difference === 0) return new Date(candidate).toISOString();
    candidate += difference;
  }

  return undefined;
}

function parseDateTimeLocal(value: string): DateTimeParts | null {
  const match = dateTimeLocalPattern.exec(value);
  if (!match) return null;
  const parts = {
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    month: Number(match[2]),
    year: Number(match[1]),
  };
  const normalized = new Date(toUtcTimestamp(parts));
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() + 1 !== parts.month ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute
  ) {
    return null;
  }
  return parts;
}

function readZonedParts(date: Date, timeZone?: string): DateTimeParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      calendar: "gregory",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
    });
    const values = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const parts = {
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      month: values.month,
      year: values.year,
    };
    return Object.values(parts).every(Number.isFinite) ? parts : null;
  } catch {
    return null;
  }
}

function toUtcTimestamp(parts: DateTimeParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}
