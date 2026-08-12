import {
  writeAdminScopeSearchParams,
  type AdminScope,
} from "./admin-scope";

export type AdminPanel = "overview" | "status" | "audit" | "system";
export type AdminSystemSection =
  | "platform"
  | "oauth"
  | "storage"
  | "lifecycle"
  | "external-share";

const panelSegments: Record<AdminPanel, string> = {
  audit: "audit",
  overview: "overview",
  status: "status",
  system: "system",
};

const panelsBySegment = new Map(
  Object.entries(panelSegments).map(([panel, segment]) => [
    segment,
    panel as AdminPanel,
  ]),
);

const systemSectionSegments: Record<AdminSystemSection, string> = {
  "external-share": "external-share",
  lifecycle: "lifecycle",
  oauth: "oauth",
  platform: "platform",
  storage: "storage",
};

const systemSectionsBySegment = new Map(
  Object.entries(systemSectionSegments).map(([section, segment]) => [
    segment,
    section as AdminSystemSection,
  ]),
);

export function resolveAdminPanelFromPath(pathname: string): AdminPanel {
  const normalized = normalizePath(pathname, "/admin");
  if (normalized === "/admin") return "overview";
  if (normalized === "/admin/external-share") return "system";
  const segment = normalized.match(/^\/admin\/([^/]+)$/)?.[1];
  if (segment === "system" || normalized.startsWith("/admin/system/")) {
    return "system";
  }
  return segment ? (panelsBySegment.get(segment) ?? "overview") : "overview";
}

export function getAdminPanelPath(panel: AdminPanel) {
  return panel === "overview" ? "/admin" : `/admin/${panelSegments[panel]}`;
}

export function resolveAdminSystemSectionFromPath(
  pathname: string,
): AdminSystemSection {
  const normalized = normalizePath(pathname, "/admin/system");
  if (normalized === "/admin/external-share") return "external-share";
  const segment = normalized.match(/^\/admin\/system\/([^/]+)$/)?.[1];
  return segment
    ? (systemSectionsBySegment.get(segment) ?? "platform")
    : "platform";
}

export function getAdminSystemSectionPath(section: AdminSystemSection) {
  return section === "platform"
    ? "/admin/system"
    : `/admin/system/${systemSectionSegments[section]}`;
}

export function buildAdminUrl(path: string, scope: AdminScope) {
  const search = writeAdminScopeSearchParams(new URLSearchParams(), scope);
  return `${path}?${search.toString()}`;
}

export function getAdminPanelScope(panel: AdminPanel, current: AdminScope) {
  return panel === "status" ? ({ kind: "system" } as const) : current;
}

export function serializeAdminScope(scope: AdminScope) {
  return scope.kind === "workspace"
    ? `workspace:${scope.workspaceId}`
    : scope.kind;
}

export function adminScopesEqual(left: AdminScope, right: AdminScope) {
  return serializeAdminScope(left) === serializeAdminScope(right);
}

function normalizePath(pathname: string, fallback: string) {
  return pathname.replace(/\/+$/, "") || fallback;
}
