import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeStorageIntegrityResult,
  createStorageIntegrityTask,
  fetchAdminAuditEvents,
  fetchStorageIntegrityTasks,
  fetchStorageIntegrityResults,
  fetchStorageIntegritySummary,
  fetchStorageIntegrityTargetVersions,
  fetchStorageIntegrityTask,
  retryStorageIntegrityTask,
  searchStorageIntegrityTargets,
  updateAdminAuthPolicy,
  updateAdminStoragePolicy,
} from "./drive-api-admin";
import type {
  AdminAuditEventsResponse,
  AdminAuthPolicyResponse,
  AdminStoragePolicyResponse,
  StorageIntegrityResult,
  StorageIntegritySummary,
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

describe("storage integrity api", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a scoped verification task with its operational limits", async () => {
    const task = createIntegrityTask();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(task));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      batchSize: 250,
      bandwidthLimitBytesPerSecond: 8_388_608,
      concurrency: 3,
      maxAttempts: 4,
      mode: "verify" as const,
      scope: "workspace" as const,
      target: { nodeId: " node-1 ", versionId: "version-2" },
      workspaceId: " workspace-1 ",
    };

    await expect(createStorageIntegrityTask(input)).resolves.toEqual(task);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/storage-integrity/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      ...input,
      target: { nodeId: "node-1", versionId: "version-2" },
      workspaceId: "workspace-1",
    });
  });

  it("never leaks a workspace identifier into an all-scope task", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(createIntegrityTask({ scope: "all" })));
    vi.stubGlobal("fetch", fetchMock);

    await createStorageIntegrityTask({
      batchSize: 100,
      concurrency: 2,
      maxAttempts: 3,
      mode: "backfill",
      scope: "all",
      target: { nodeId: "stale-node", versionId: "stale-version" },
      workspaceId: "stale-workspace",
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("workspaceId");
    expect(body).not.toHaveProperty("target");
  });

  it("rejects workspace tasks without a workspace identifier", async () => {
    await expect(
      createStorageIntegrityTask({
        batchSize: 100,
        concurrency: 2,
        maxAttempts: 3,
        mode: "verify",
        scope: "workspace",
        workspaceId: " ",
      }),
    ).rejects.toThrow("Workspace scope requires workspaceId");
  });

  it("rejects task limits outside the backend operating envelope", async () => {
    const base = {
      batchSize: 100,
      concurrency: 2,
      maxAttempts: 3,
      mode: "verify" as const,
      scope: "all" as const,
    };

    await expect(
      createStorageIntegrityTask({ ...base, batchSize: 501 }),
    ).rejects.toThrow("batchSize must be between 1 and 500");
    await expect(
      createStorageIntegrityTask({ ...base, concurrency: 9 }),
    ).rejects.toThrow("concurrency must be between 1 and 8");
    await expect(
      createStorageIntegrityTask({
        ...base,
        bandwidthLimitBytesPerSecond: 1_000_000_001,
      }),
    ).rejects.toThrow(
      "bandwidthLimitBytesPerSecond must be between 1 and 1000000000",
    );
  });

  it("loads a task and a filtered result page with abort support", async () => {
    const task = createIntegrityTask();
    const page = { items: [], limit: 25, offset: 50, total: 125 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(task))
      .mockResolvedValueOnce(Response.json(page));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchStorageIntegrityTask("task/one", {
      signal: controller.signal,
    });
    await expect(
      fetchStorageIntegrityResults(
        "task/one",
        { limit: 25, offset: 50, status: "mismatch" },
        { signal: controller.signal },
      ),
    ).resolves.toEqual(page);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/admin/storage-integrity/tasks/task%2Fone",
    );
    const [rawUrl, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const url = new URL(rawUrl, "http://localhost");
    expect(url.pathname).toBe(
      "/api/admin/storage-integrity/tasks/task%2Fone/results",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "25",
      offset: "50",
      status: "mismatch",
    });
    expect(init.signal).toBe(controller.signal);
  });

  it("lists task history for an explicit workspace scope", async () => {
    const page = {
      items: [createIntegrityTask()],
      limit: 20,
      offset: 40,
      total: 61,
    };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      fetchStorageIntegrityTasks(
        { kind: "workspace", workspaceId: "workspace/one" },
        { limit: 20, offset: 40 },
        { signal: controller.signal },
      ),
    ).resolves.toEqual(page);

    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl, "http://localhost");
    expect(url.pathname).toBe("/api/admin/storage-integrity/tasks");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "20",
      offset: "40",
      scope: "workspace",
      workspaceId: "workspace/one",
    });
    expect(init.signal).toBe(controller.signal);
  });

  it("loads scope summary independently from task history", async () => {
    const summary = {
      counts: {
        failed: 2,
        mismatch: 3,
        pending: 4,
        unknown: 5,
        verified: 6,
      },
      generatedAt: "2026-08-13T12:00:00.000Z",
      lastVerifiedAt: "2026-08-13T11:00:00.000Z",
      scope: { kind: "all" },
    } satisfies StorageIntegritySummary;
    const fetchMock = vi.fn().mockResolvedValue(Response.json(summary));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      fetchStorageIntegritySummary(
        { kind: "all" },
        { signal: controller.signal },
      ),
    ).resolves.toEqual(summary);

    const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(rawUrl, "http://localhost");
    expect(url.pathname).toBe("/api/admin/storage-integrity/summary");
    expect(Object.fromEntries(url.searchParams)).toEqual({ scope: "all" });
    expect(init.signal).toBe(controller.signal);
  });

  it("preserves the workspace discriminator returned by the summary API", async () => {
    const summary = {
      counts: {
        failed: 0,
        mismatch: 0,
        pending: 1,
        unknown: 2,
        verified: 3,
      },
      generatedAt: "2026-08-13T12:00:00.000Z",
      lastVerifiedAt: null,
      scope: { kind: "workspace", workspaceId: "workspace-1" },
    } satisfies StorageIntegritySummary;
    const fetchMock = vi.fn().mockResolvedValue(Response.json(summary));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchStorageIntegritySummary({
        kind: "workspace",
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual(summary);

    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scope: "workspace",
      workspaceId: "workspace-1",
    });
  });

  it("searches integrity targets through storage.manage-scoped admin routes", async () => {
    const targets = { items: [], limit: 20, offset: 0, total: 0 };
    const versions = [
      {
        createdAt: "2026-08-13T12:00:00.000Z",
        id: "version-1",
        integrityStatus: "unknown",
        lastVerifiedAt: null,
        mimeType: "application/octet-stream",
        nodeId: "node/one",
        remark: "",
        sizeBytes: 10,
        uploadedBy: "admin",
        versionNumber: 1,
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(targets))
      .mockResolvedValueOnce(Response.json(versions));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await searchStorageIntegrityTargets(" workspace-1 ", " report ", {
      signal: controller.signal,
    });
    await fetchStorageIntegrityTargetVersions("workspace-1", "node/one", {
      signal: controller.signal,
    });

    const targetsUrl = new URL(
      fetchMock.mock.calls[0][0] as string,
      "http://localhost",
    );
    expect(targetsUrl.pathname).toBe("/api/admin/storage-integrity/targets");
    expect(Object.fromEntries(targetsUrl.searchParams)).toEqual({
      limit: "20",
      offset: "0",
      query: "report",
      workspaceId: "workspace-1",
    });
    const versionsUrl = new URL(
      fetchMock.mock.calls[1][0] as string,
      "http://localhost",
    );
    expect(versionsUrl.pathname).toBe(
      "/api/admin/storage-integrity/targets/node%2Fone/versions",
    );
    expect(versionsUrl.searchParams.get("workspaceId")).toBe("workspace-1");
  });

  it("retries selected findings into a new task", async () => {
    const nextTask = createIntegrityTask({ id: "task-2", status: "queued" });
    const fetchMock = vi.fn().mockResolvedValue(Response.json(nextTask));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      retryStorageIntegrityTask("task-1", { resultIds: ["result-1"] }),
    ).resolves.toEqual(nextTask);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/storage-integrity/tasks/task-1/retry");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ resultIds: ["result-1"] }));
  });

  it("acknowledges an anomalous integrity result", async () => {
    const acknowledged = createIntegrityResult({
      acknowledgedAt: "2026-08-14T01:00:00.000Z",
      acknowledgedBy: "admin-1",
    });
    const fetchMock = vi.fn().mockResolvedValue(Response.json(acknowledged));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      acknowledgeStorageIntegrityResult("result/one"),
    ).resolves.toEqual(acknowledged);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "/api/admin/storage-integrity/results/result%2Fone/acknowledge",
    );
    expect(init.method).toBe("POST");
  });
});

function createIntegrityResult(
  overrides: Partial<StorageIntegrityResult> = {},
): StorageIntegrityResult {
  return {
    acknowledgedAt: null,
    acknowledgedBy: null,
    actualHash: "sha256:actual",
    actualSizeBytes: 2_048,
    attempts: 1,
    checkedAt: "2026-08-13T12:01:00.000Z",
    errorCode: null,
    errorMessage: null,
    expectedHash: "sha256:expected",
    expectedSizeBytes: 1_024,
    id: "result-1",
    nodeId: "node-1",
    objectKey: "objects/archive.bin",
    status: "mismatch",
    taskId: "task-1",
    versionId: "version-1",
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function createIntegrityTask(
  overrides: Record<string, unknown> = {},
) {
  return {
    config: {
      bandwidthLimitBytesPerSecond: 8_388_608,
      batchSize: 250,
      concurrency: 3,
      maxAttempts: 4,
    },
    createdAt: "2026-08-13T12:00:00.000Z",
    failureCode: null,
    failureMessage: null,
    finishedAt: null,
    id: "task-1",
    mode: "verify",
    progress: {
      bytesRead: 4_096,
      failed: 0,
      matched: 4,
      mismatches: 1,
      processed: 5,
      total: 10,
    },
    scope: "workspace",
    startedAt: "2026-08-13T12:00:01.000Z",
    status: "running",
    target: { nodeId: "node-1", versionId: "version-2" },
    workspaceId: "workspace-1",
    ...overrides,
  };
}
