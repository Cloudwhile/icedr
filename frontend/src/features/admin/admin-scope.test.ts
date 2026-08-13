import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADMIN_AUDIT_FILTERS,
  parseAdminAuditFilters,
  parseAdminScope,
  reconcileAdminScope,
  writeAdminStateSearchParams,
} from "./admin-scope";

describe("admin scope URL state", () => {
  it("reads canonical global, system, and workspace scopes", () => {
    expect(parseAdminScope(new URLSearchParams("scope=all"))).toEqual({
      kind: "all",
    });
    expect(parseAdminScope(new URLSearchParams("scope=system"))).toEqual({
      kind: "system",
    });
    expect(
      parseAdminScope(new URLSearchParams("workspace=workspace%2Fone")),
    ).toEqual({ kind: "workspace", workspaceId: "workspace/one" });
  });

  it("supports the legacy workspace=all URL and rejects blank workspace ids", () => {
    expect(parseAdminScope(new URLSearchParams("workspace=all"))).toEqual({
      kind: "all",
    });
    expect(parseAdminScope(new URLSearchParams("workspace=%20%20"))).toEqual({
      kind: "all",
    });
  });

  it("falls back when a bookmarked workspace no longer exists", () => {
    expect(
      reconcileAdminScope(
        { kind: "workspace", workspaceId: "deleted" },
        [{ id: "available" }],
      ),
    ).toEqual({ kind: "all" });
  });
});

describe("admin audit URL state", () => {
  it("normalizes supported filters and ignores invalid enum or paging values", () => {
    const filters = parseAdminAuditFilters(
      new URLSearchParams(
        "actor=account&action=file.moved&result=failed&resourceType=file" +
          "&ipAddress=%2010.0.0.1%20&query=%20report%20" +
          "&createdFrom=2026-08-01T00%3A00%3A00.000Z" +
          "&createdTo=2026-08-12T00%3A00%3A00.000Z" +
          "&sortBy=unknown&sortDirection=sideways&limit=-1&offset=NaN",
      ),
    );

    expect(filters).toEqual({
      ...DEFAULT_ADMIN_AUDIT_FILTERS,
      action: "file.moved",
      actor: "account",
      createdFrom: "2026-08-01T00:00:00.000Z",
      createdTo: "2026-08-12T00:00:00.000Z",
      ipAddress: "10.0.0.1",
      query: "report",
      resourceType: "file",
      result: "failed",
    });
  });

  it("writes a shareable URL and round-trips scope, filters, and offset", () => {
    const filters = {
      action: "share.viewed",
      actor: "visitor" as const,
      createdFrom: "2026-08-01T00:00:00.000Z",
      createdTo: "2026-08-12T00:00:00.000Z",
      ipAddress: "203.0.113.8",
      limit: 25,
      offset: 50,
      query: "quarterly report",
      resourceType: "share" as const,
      result: "success" as const,
      sortBy: "action" as const,
      sortDirection: "asc" as const,
    };
    const params = writeAdminStateSearchParams(
      new URLSearchParams("unrelated=kept&scope=all"),
      { kind: "workspace", workspaceId: "workspace/one" },
      filters,
    );

    expect(params.get("unrelated")).toBe("kept");
    expect(params.get("scope")).toBeNull();
    expect(params.get("workspace")).toBe("workspace/one");
    expect(parseAdminScope(params)).toEqual({
      kind: "workspace",
      workspaceId: "workspace/one",
    });
    expect(parseAdminAuditFilters(params)).toEqual(filters);
  });
});
