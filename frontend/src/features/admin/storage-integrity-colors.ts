import type { Palette } from "@/features/file/model";

type StorageIntegrityVisualStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "matched"
  | "mismatch"
  | "pending"
  | "queued"
  | "running"
  | "unknown"
  | "verified";

const semanticWeight = 0.72;

export function storageIntegrityStatusTextColor(
  palette: Palette,
  status: StorageIntegrityVisualStatus,
) {
  const semanticColor =
    status === "failed"
      ? palette.danger
      : status === "mismatch" ||
          status === "pending" ||
          status === "queued" ||
          status === "running"
        ? palette.warning
        : status === "matched" ||
            status === "verified" ||
            status === "completed"
          ? palette.success
          : palette.info;
  return mixHexColors(semanticColor, palette.ink, semanticWeight);
}

function mixHexColors(foreground: string, background: string, weight: number) {
  const left = parseHexColor(foreground);
  const right = parseHexColor(background);
  if (!left || !right) return background;
  const channels = left.map((channel, index) =>
    Math.round(channel * weight + right[index] * (1 - weight)),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseHexColor(color: string) {
  const match = color.match(/^#([\da-f]{6})$/i);
  if (!match) return null;
  return [0, 2, 4].map((offset) =>
    Number.parseInt(match[1].slice(offset, offset + 2), 16),
  );
}
