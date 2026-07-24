import { findDriveItem, getItemKind, type DriveItem, type DriveUserNav, type ThemePreference } from "@/features/file/model";
import { getDefaultFileOpenWith, getFileOpenWithOptions, getFileOpenWithStorageKey, type FileOpenWithApp } from "@/features/file/open-with";
import type { WorkspaceResponse, DriveSpaceScope } from "@/lib/drive-api";
import type { useTranslations } from "@/i18n/react";
import type { RegisteredShare } from "@/features/share/registry";

export function withShareFlags(items: DriveItem[], shares: RegisteredShare[]) {
  const activeSharedIds = new Set(
    shares
      .filter((share) => share.status !== "revoked" && !share.revokedAt && share.status !== "expired")
      .flatMap((share) => [...share.rootItemIds, ...share.allowedItemIds]),
  );
  return items.map((item) => ({ ...item, shared: activeSharedIds.has(item.id) }));
}

export function getRememberedFileOpenWith(item: DriveItem) {
  if (typeof window === "undefined") return null;
  const remembered = window.localStorage.getItem(getFileOpenWithStorageKey(item));
  if (!remembered) return null;
  return getFileOpenWithOptions(item).some((option) => option.value === remembered)
    ? remembered as FileOpenWithApp
    : null;
}

export function getPreviewOpenWith(item: DriveItem) {
  return getRememberedFileOpenWith(item) ?? getDefaultFileOpenWith(item);
}

export function createUniqueDriveName(defaultName: string, siblingItems: DriveItem[]) {
  const existingNames = new Set(siblingItems.map((item) => item.name.toLocaleLowerCase()));
  if (!existingNames.has(defaultName.toLocaleLowerCase())) return defaultName;

  const { baseName, extension } = splitNameForDuplicate(defaultName);
  let index = 2;
  let candidate = `${baseName} (${index})${extension}`;
  while (existingNames.has(candidate.toLocaleLowerCase())) {
    index += 1;
    candidate = `${baseName} (${index})${extension}`;
  }
  return candidate;
}

function splitNameForDuplicate(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return { baseName: name, extension: "" };
  return { baseName: name.slice(0, dotIndex), extension: name.slice(dotIndex) };
}

export function getNameExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLocaleLowerCase();
}

export function formatExtensionLabel(extension: string, emptyLabel: string) {
  return extension ? `.${extension}` : emptyLabel;
}

export function isFolderWithinItems(folderId: string, items: DriveItem[], sourceItems: DriveItem[]) {
  const blockedIds = new Set(items.filter((item) => getItemKind(item) === "folder").map((item) => item.id));
  if (blockedIds.has(folderId)) return true;
  let current = findDriveItem(folderId, sourceItems);
  while (current?.parentId) {
    if (blockedIds.has(current.parentId)) return true;
    current = findDriveItem(current.parentId, sourceItems);
  }
  return false;
}

export function localizeWorkspaceName(
  workspace: WorkspaceResponse | undefined,
  t: ReturnType<typeof useTranslations>,
) {
  if (!workspace) return t("app.workspaceSpace");
  if (workspace.id === "workspace-default" || workspace.name === "Default Workspace") {
    return t("app.defaultWorkspace");
  }
  return workspace.name;
}

export function isThemePreferenceValue(value: string | null | undefined): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

export function isTimeZonePreferenceValue(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value === "system") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export type DriveWorkspaceModule = "drive" | "links" | "transfers" | "settings";
export type DriveClipboardState = {
  items: DriveItem[];
  mode: "copy" | "move";
  spaceScope: DriveSpaceScope;
  workspaceId: string | null;
};

export const driveNavPaths: Record<DriveUserNav, string> = {
  drive: "/",
  links: "/links",
  recent: "/recent",
  settings: "/settings",
  shared: "/shared",
  starred: "/starred",
  transfers: "/transfers",
  trash: "/trash",
};

export function normalizeDrivePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}
