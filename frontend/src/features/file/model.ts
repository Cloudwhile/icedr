import type { FilePreviewCapability } from "@/lib/drive-api";

export type Locale = string;
export type LanguageOption = {
  label: string;
  value: Locale;
};
export type ThemeMode = "dark" | "light";
export type ThemePreference = "system" | ThemeMode;
export type DriveModule = "drive" | "links" | "transfers";
export type DriveShortcutNav = "shared" | "recent" | "starred" | "trash";
export type DriveWorkspaceNav = DriveModule | DriveShortcutNav;
export type DriveUserNav = DriveWorkspaceNav | "settings";
export type DriveItemKind = "folder" | "doc" | "sheet" | "image" | "video" | "archive" | "other";
export type LocalIconName =
  | "abc"
  | "arrow_down"
  | "arrow_left"
  | "arrow_right"
  | "arrow_up"
  | "ban"
  | "calendar"
  | "clock"
  | "copy"
  | "cross"
  | "dark_mode"
  | "document"
  | "download"
  | "earth"
  | "exclamation"
  | "file"
  | "folder"
  | "grid"
  | "house"
  | "image"
  | "import"
  | "info"
  | "key"
  | "link"
  | "lock"
  | "mail"
  | "mention"
  | "menu"
  | "menu7"
  | "minus"
  | "notification"
  | "pause"
  | "play"
  | "plus"
  | "refresh"
  | "save"
  | "search"
  | "settings"
  | "share2"
  | "shield"
  | "slider"
  | "star"
  | "stop"
  | "sun"
  | "tick"
  | "time"
  | "trash"
  | "upload"
  | "user_check"
  | "user_group"
  | "user_avatar"
  | "visible"
  | "expand";

export type DriveItem = {
  id: string;
  name: string;
  kind?: DriveItemKind;
  workspaceId?: string;
  parentId: string | null;
  owner: string;
  createdAt?: string | null;
  modifiedAt: string | null;
  mimeType?: string;
  objectKey?: string | null;
  sizeBytes: number | null;
  shared: boolean;
  starred: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  originalParentNodeId?: string | null;
  originalPath?: string | null;
  searchPath?: string | null;
  previewCapability?: FilePreviewCapability;
  colorKey: "primary" | "success" | "secure" | "tertiary";
};

export type Palette = {
  primary: string;
  primaryHover: string;
  ink: string;
  muted: string;
  subtle: string;
  tertiary: string;
  canvas: string;
  surface1: string;
  surface2: string;
  surface3: string;
  hairline: string;
  hairlineStrong: string;
  danger: string;
  dangerRing: string;
  info: string;
  warning: string;
  success: string;
  secure: string;
  selected: string;
  focusRing: string;
};

export const palettes: Record<ThemeMode, Palette> = {
  dark: {
    primary: "#5e6ad2",
    primaryHover: "#828fff",
    ink: "#f7f8f8",
    muted: "#d0d6e0",
    subtle: "#8a8f98",
    tertiary: "#62666d",
    canvas: "#010102",
    surface1: "#0f1011",
    surface2: "#141516",
    surface3: "#18191a",
    hairline: "#23252a",
    hairlineStrong: "#34343a",
    danger: "#f87171",
    dangerRing: "rgba(248, 113, 113, 0.34)",
    info: "#38bdf8",
    warning: "#fbbf24",
    success: "#27a644",
    secure: "#7a7fad",
    selected: "#171a2f",
    focusRing: "rgba(94, 106, 210, 0.5)",
  },
  light: {
    primary: "#5e6ad2",
    primaryHover: "#4f5cc6",
    ink: "#111217",
    muted: "#343843",
    subtle: "#62666d",
    tertiary: "#8a8f98",
    canvas: "#f5f6f6",
    surface1: "#ffffff",
    surface2: "#f6f7f7",
    surface3: "#eef0f4",
    hairline: "#d9dce3",
    hairlineStrong: "#bdc2cf",
    danger: "#dc2626",
    dangerRing: "rgba(220, 38, 38, 0.18)",
    info: "#0284c7",
    warning: "#d97706",
    success: "#168a34",
    secure: "#666da4",
    selected: "#eef0ff",
    focusRing: "rgba(94, 106, 210, 0.35)",
  },
};

export const navItems: Array<{ id: DriveWorkspaceNav; icon: LocalIconName }> = [
  { id: "drive", icon: "folder" },
  { id: "shared", icon: "user_group" },
  { id: "recent", icon: "clock" },
  { id: "links", icon: "link" },
  { id: "transfers", icon: "upload" },
  { id: "starred", icon: "star" },
  { id: "trash", icon: "trash" },
];

export const kindIcons: Record<DriveItemKind, LocalIconName> = {
  folder: "folder",
  doc: "document",
  sheet: "grid",
  image: "image",
  video: "visible",
  archive: "file",
  other: "file",
};

const extensionKinds: Record<string, DriveItemKind> = {
  doc: "doc",
  docx: "doc",
  md: "doc",
  pdf: "doc",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
};

const extensionIconAliases: Record<string, string> = {
  md: "markdown",
  mkd: "markdown",
  markdown: "markdown",
};

export function getItemExtension(item: DriveItem) {
  const dotIndex = item.name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === item.name.length - 1) return "";
  return item.name.slice(dotIndex + 1).toLowerCase();
}

export function getItemExtensionIconName(item: DriveItem) {
  if (getItemKind(item) === "folder") return "folder";
  const extension = getItemExtension(item);
  if (!extension) return "";
  return extensionIconAliases[extension] ?? extension;
}

export function getItemKind(item: DriveItem): DriveItemKind {
  if (item.kind) return item.kind;
  if (item.mimeType === "inode/directory") return "folder";
  if (item.mimeType?.startsWith("image/")) return "image";
  if (item.mimeType?.startsWith("video/")) return "video";
  const extension = getItemExtension(item);
  if (extension) return extensionKinds[extension] ?? "other";
  if (item.objectKey === null && item.sizeBytes === null) return "folder";
  return "other";
}

export function formatFileSize(sizeBytes: number | null, locale: Locale) {
  if (sizeBytes === null) return "--";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  const formatter = new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits,
  });

  return `${formatter.format(value)} ${units[unitIndex]}`;
}

export function sumDriveItemSizes(items: DriveItem[], sourceItems: DriveItem[] = []) {
  const visited = new Set<string>();

  const sumItem = (item: DriveItem): number => {
    if (visited.has(item.id)) return 0;
    visited.add(item.id);

    if (item.sizeBytes !== null) return item.sizeBytes;
    return getChildItems(item.id, sourceItems).reduce((total, child) => total + sumItem(child), 0);
  };

  const total = items.reduce((sum, item) => sum + sumItem(item), 0);
  return total > 0 ? total : null;
}

export function itemColor(item: DriveItem, palette: Palette) {
  return palette[item.colorKey];
}

export function findDriveItem(id: string, sourceItems: DriveItem[] = []) {
  return sourceItems.find((item) => item.id === id);
}

export function getChildItems(parentId: string | null, sourceItems: DriveItem[] = []) {
  return sourceItems.filter((item) => item.parentId === parentId);
}

export function getFolderPath(folderId: string | null, sourceItems: DriveItem[] = []) {
  const path: DriveItem[] = [];
  let current = folderId ? findDriveItem(folderId, sourceItems) : undefined;

  while (current) {
    path.unshift(current);
    current = current.parentId ? findDriveItem(current.parentId, sourceItems) : undefined;
  }

  return path;
}

export function formatDriveItemModified(item: DriveItem, locale: Locale, timeZone?: string) {
  if (!item.modifiedAt) return "--";
  const date = new Date(item.modifiedAt);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function compareByModified(a: DriveItem, b: DriveItem) {
  const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
  const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
  return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
}

export function getIntlLocale(locale: Locale) {
  if (locale === "zh") return "zh-CN";
  if (locale === "en") return "en";
  return locale.replace(/_/g, "-");
}
