import { describe, expect, it } from "vitest";
import {
  adminScopesEqual,
  buildAdminUrl,
  getAdminPanelPath,
  getAdminPanelScope,
  getAdminSystemSectionPath,
  getAdminSystemSectionScope,
  resolveAdminPanelFromPath,
  resolveAdminSystemSectionFromPath,
  shouldShowAdminGlobalRefresh,
} from "./admin-routes";

describe("admin routes", () => {
  it("resolves canonical panels and nested system sections", () => {
    expect(resolveAdminPanelFromPath("/admin")).toBe("overview");
    expect(resolveAdminPanelFromPath("/admin/audit/")).toBe("audit");
    expect(resolveAdminPanelFromPath("/admin/system/storage")).toBe("system");
    expect(resolveAdminSystemSectionFromPath("/admin/system/storage/")).toBe(
      "storage",
    );
    expect(resolveAdminSystemSectionFromPath("/admin/system/integrity")).toBe(
      "integrity",
    );
    expect(resolveAdminSystemSectionFromPath("/admin/external-share")).toBe(
      "external-share",
    );
  });

  it("falls back safely for unknown paths", () => {
    expect(resolveAdminPanelFromPath("/admin/not-a-panel")).toBe("overview");
    expect(
      resolveAdminSystemSectionFromPath("/admin/system/not-a-section"),
    ).toBe("platform");
  });

  it("creates stable paths with an explicit data scope", () => {
    expect(getAdminPanelPath("overview")).toBe("/admin");
    expect(getAdminPanelPath("status")).toBe("/admin/status");
    expect(getAdminSystemSectionPath("platform")).toBe("/admin/system");
    expect(getAdminSystemSectionPath("lifecycle")).toBe(
      "/admin/system/lifecycle",
    );
    expect(getAdminSystemSectionPath("integrity")).toBe(
      "/admin/system/integrity",
    );
    expect(buildAdminUrl("/admin/audit", { kind: "all" })).toBe(
      "/admin/audit?scope=all",
    );
    expect(
      buildAdminUrl("/admin/system/storage", {
        kind: "workspace",
        workspaceId: "workspace/one",
      }),
    ).toBe("/admin/system/storage?workspace=workspace%2Fone");
  });

  it("compares workspace scopes by their identifier", () => {
    expect(
      adminScopesEqual(
        { kind: "workspace", workspaceId: "workspace-1" },
        { kind: "workspace", workspaceId: "workspace-1" },
      ),
    ).toBe(true);
    expect(
      adminScopesEqual(
        { kind: "workspace", workspaceId: "workspace-1" },
        { kind: "workspace", workspaceId: "workspace-2" },
      ),
    ).toBe(false);
  });

  it("canonicalizes the system status panel to system scope", () => {
    const workspaceScope = {
      kind: "workspace" as const,
      workspaceId: "workspace-1",
    };

    expect(getAdminPanelScope("status", workspaceScope)).toEqual({
      kind: "system",
    });
    expect(getAdminPanelScope("overview", workspaceScope)).toBe(
      workspaceScope,
    );
    expect(
      buildAdminUrl(
        getAdminPanelPath("status"),
        getAdminPanelScope("status", workspaceScope),
      ),
    ).toBe("/admin/status?scope=system");
  });

  it("canonicalizes storage integrity system scope to all", () => {
    expect(getAdminSystemSectionScope("integrity", { kind: "system" })).toEqual(
      { kind: "all" },
    );
    expect(
      getAdminSystemSectionScope("integrity", {
        kind: "workspace",
        workspaceId: "workspace-1",
      }),
    ).toEqual({ kind: "workspace", workspaceId: "workspace-1" });
  });

  it("lets each system settings section own its refresh state", () => {
    expect(shouldShowAdminGlobalRefresh("system", "integrity")).toBe(false);
    expect(shouldShowAdminGlobalRefresh("system", "storage")).toBe(false);
    expect(shouldShowAdminGlobalRefresh("system", "oauth")).toBe(false);
    expect(shouldShowAdminGlobalRefresh("overview", "integrity")).toBe(true);
  });
});
