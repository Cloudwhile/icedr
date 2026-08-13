import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAdminAuditEvents,
  updateAdminAuthPolicy,
  updateAdminStoragePolicy,
} from "./drive-api-admin";
import type {
  AdminAuditEventsResponse,
  AdminAuthPolicyResponse,
  AdminStoragePolicyResponse,
} from "./drive-api-admin-types";

const responseBody: AdminAuditEventsResponse = {
  facets: {
    actions: ["file.moved"],
    actors: ["account"],
  },
  generatedAt: "2026-08-12T04:00:00.000Z",
  items: [],
  limit: 25,
  offset: 50,
  scope: { kind: "all" },
  summary: { failed: 1, success: 12 },
  total: 13,
};

describe("admin audit api", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends every audit filter to the existing audit endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(responseBody));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAdminAuditEvents(
        { kind: "all" },
        {
          action: "file.moved",
          actor: "account",
          createdFrom: "2026-08-01T00:00:00.000Z",
          createdTo: "2026-08-12T00:00:00.000Z",
          ipAddress: "203.0.113.8",
          limit: 25,
          offset: 50,
          query: "quarterly report",
          resourceType: "file",
          result: "failed",
          sortBy: "actor",
          sortDirection: "asc",
        },
      ),
    ).resolves.toEqual(responseBody);

    const [rawUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl, "http://localhost");
    expect(url.pathname).toBe("/api/audit/events");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "file.moved",
      actor: "account",
      createdFrom: "2026-08-01T00:00:00.000Z",
      createdTo: "2026-08-12T00:00:00.000Z",
      ipAddress: "203.0.113.8",
      limit: "25",
      offset: "50",
      query: "quarterly report",
      resourceType: "file",
      result: "failed",
      scope: "all",
      sortBy: "actor",
      sortDirection: "asc",
    });
    expect(url.searchParams.has("workspaceId")).toBe(false);
  });

  it("maps workspace and system scopes without ever sending workspaceId=all", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(responseBody)));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdminAuditEvents(
      { kind: "workspace", workspaceId: "workspace/one" },
      { limit: 50, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
    );
    await fetchAdminAuditEvents(
      { kind: "system" },
      { limit: 50, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
    );

    const workspaceUrl = new URL(
      fetchMock.mock.calls[0][0] as string,
      "http://localhost",
    );
    expect(workspaceUrl.searchParams.get("scope")).toBe("workspace");
    expect(workspaceUrl.searchParams.get("workspaceId")).toBe("workspace/one");

    const systemUrl = new URL(
      fetchMock.mock.calls[1][0] as string,
      "http://localhost",
    );
    expect(systemUrl.searchParams.get("scope")).toBe("system");
    expect(systemUrl.searchParams.has("workspaceId")).toBe(false);
  });

  it("omits blank optional filters and forwards the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(responseBody));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchAdminAuditEvents(
      { kind: "all" },
      {
        action: " ",
        ipAddress: "",
        limit: 25,
        offset: 0,
        query: "",
        sortBy: "createdAt",
        sortDirection: "desc",
      },
      { signal: controller.signal },
    );

    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl, "http://localhost");
    expect(url.searchParams.has("action")).toBe(false);
    expect(url.searchParams.has("ipAddress")).toBe(false);
    expect(url.searchParams.has("query")).toBe(false);
    expect(init.signal).toBe(controller.signal);
  });
});

describe("atomic admin policy api", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates storage and workspace quotas in one request", async () => {
    const response = {
      settings: { quotaBytes: 1_000 },
      usage: {
        defaultUserQuotaBytes: 500,
        workspaceId: "workspace-1",
      },
    } as AdminStoragePolicyResponse;
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      defaultUserQuotaBytes: 500,
      quotaBytes: 1_000,
      workspaceId: "workspace-1",
    };

    await expect(updateAdminStoragePolicy(input)).resolves.toEqual(response);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/storage-policy");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify(input));
  });

  it("updates authentication methods and passkey settings atomically", async () => {
    const response = {
      auth: {
        localEnabled: true,
        minimumAuthenticationMethods: 1,
        oauthEnabled: false,
        passkeyEnabled: true,
      },
      passkey: {
        origin: "https://drive.example.com",
        rpId: "drive.example.com",
        rpName: "ICEDR",
      },
    } as AdminAuthPolicyResponse;
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      auth: {
        localEnabled: true,
        minimumAuthenticationMethods: 1,
        oauthEnabled: false,
        passkeyEnabled: true,
      },
      passkey: {
        origin: "https://drive.example.com",
        rpId: "drive.example.com",
        rpName: "ICEDR",
      },
    };

    await expect(updateAdminAuthPolicy(input)).resolves.toEqual(response);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/auth-policy");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify(input));
  });
});
