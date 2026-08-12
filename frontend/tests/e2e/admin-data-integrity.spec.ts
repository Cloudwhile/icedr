import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-08-12T09:00:00.000Z";
const windowFrom = "2026-08-05T09:00:00.000Z";
const workspaceAlpha = "workspace-alpha";
const workspaceBeta = "workspace-beta";
const gibibyte = 1024 ** 3;

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
  "Access-Control-Allow-Origin": "*",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("icedr.auth.token", "admin-integrity-token");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
});

test("switches explicit admin scope and restores it from the URL", async ({
  page,
}) => {
  const state = await mockAdminIntegrityApi(page);

  await page.goto(`/admin?workspace=${workspaceAlpha}`);
  const scope = page.getByLabel("Data scope");
  await expect(scope).toHaveValue(`workspace:${workspaceAlpha}`);
  await expect.poll(() => state.overviewRequests.at(-1)?.scope).toBe("workspace");
  expect(state.overviewRequests.at(-1)?.workspaceId).toBe(workspaceAlpha);

  await scope.selectOption("scope:all");
  await expect(page).toHaveURL(/\/admin\?scope=all$/);
  await expect.poll(() => state.overviewRequests.at(-1)?.scope).toBe("all");

  await scope.selectOption("scope:system");
  await expect(page).toHaveURL(/\/admin\?scope=system$/);
  await expect.poll(() => state.overviewRequests.at(-1)?.scope).toBe("system");

  await page.reload();
  await expect(page.getByLabel("Data scope")).toHaveValue("scope:system");
  await expect(page.getByText("Scope: System only").first()).toBeVisible();
});

test("keeps server-side audit filters and totals across pages and reload", async ({
  page,
}) => {
  const state = await mockAdminIntegrityApi(page);

  await page.goto(
    "/admin/audit?scope=all&sortBy=createdAt&sortDirection=desc&limit=25&offset=0",
  );
  await page.getByLabel("Keyword").fill("risk");

  await expect(page).toHaveURL(/query=risk/);
  await expect(page.getByText("25 on this page / 31 total")).toBeVisible();
  await expect(page.getByTitle("Risk record 1", { exact: true })).toBeVisible();
  await expect.poll(() => state.auditRequests.at(-1)?.query).toBe("risk");
  expect(state.auditRequests.at(-1)).toMatchObject({
    limit: 25,
    offset: 0,
    scope: "all",
  });

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/offset=25/);
  await expect(page.getByText("6 on this page / 31 total")).toBeVisible();
  await expect(page.getByTitle("Risk record 26", { exact: true })).toBeVisible();
  await expect.poll(() => state.auditRequests.at(-1)?.offset).toBe(25);

  await page.reload();
  await expect(page.getByLabel("Keyword")).toHaveValue("risk");
  await expect(page.getByText("Page 2 / 2")).toBeVisible();
  await expect(page.getByTitle("Risk record 26", { exact: true })).toBeVisible();
  expect(state.auditRequests.at(-1)).toMatchObject({
    limit: 25,
    offset: 25,
    query: "risk",
    scope: "all",
  });
});

test("retains last successful overview data and marks it stale after refresh failure", async ({
  page,
}) => {
  const state = await mockAdminIntegrityApi(page);

  await page.goto("/admin?scope=all");
  const workspaceMetric = page.locator(".admin-overview-stat-card", {
    hasText: "Workspaces",
  });
  await expect(workspaceMetric).toContainText("2");
  state.overviewShouldFail = true;

  await page
    .locator(".admin-data-freshness")
    .getByRole("button", { name: "Refresh" })
    .click();

  await expect.poll(() => state.overviewRequests.length).toBeGreaterThan(1);
  await expect(page.getByRole("status")).toHaveText("Stale data");
  await expect(page.getByRole("alert")).toContainText(
    "Unable to load administration settings",
  );
  await expect(workspaceMetric).toContainText("2");
});

test("pulls authoritative quota state after an atomic save fails", async ({
  page,
}) => {
  const state = await mockAdminIntegrityApi(page, {
    failStoragePolicy: true,
  });

  await page.goto(`/admin/system/storage?workspace=${workspaceAlpha}`);
  const quotaInput = page.getByRole("textbox", {
    name: /^Storage policy limit /,
  });
  await expect(quotaInput).toHaveValue("1");
  await quotaInput.fill("2");
  await page
    .locator("#storage-policy")
    .getByRole("button", { name: "Save settings" })
    .click();

  await expect.poll(() => state.storagePolicyRequests.length).toBe(1);
  expect(state.storagePolicyRequests[0]).toEqual({
    defaultUserQuotaBytes: gibibyte / 2,
    quotaBytes: gibibyte * 2,
    workspaceId: workspaceAlpha,
  });
  await expect.poll(() => state.authoritativeSettingsReads).toBeGreaterThan(0);
  await expect.poll(() => state.authoritativeUsageReads).toBeGreaterThan(0);
  await expect(quotaInput).toHaveValue("3");
});

test("blocks internal navigation and supports cancel, discard, and save", async ({
  page,
}) => {
  const state = await mockAdminIntegrityApi(page);

  await page.goto(`/admin/system/storage?workspace=${workspaceAlpha}`);
  let quotaInput = page.getByRole("textbox", {
    name: /^Storage policy limit /,
  });
  await expect(quotaInput).toHaveValue("1");
  await quotaInput.fill("2");
  await page
    .locator(".admin-panel-nav")
    .getByRole("button", { name: "Audit log" })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Unsaved administration settings");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(
    new RegExp(`/admin/system/storage\\?workspace=${workspaceAlpha}$`),
  );
  await expect(quotaInput).toHaveValue("2");

  await page
    .locator(".admin-panel-nav")
    .getByRole("button", { name: "Audit log" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await expect(page).toHaveURL(/\/admin\/audit\?workspace=workspace-alpha/);
  expect(state.storagePolicyRequests).toHaveLength(0);

  await page
    .locator(".admin-panel-nav")
    .getByRole("button", { name: "System settings" })
    .click();
  await page
    .locator(".admin-panel-subnav")
    .getByRole("button", { name: "Storage policy" })
    .click();
  await expect(page).toHaveURL(/\/admin\/system\/storage\?workspace=workspace-alpha/);
  quotaInput = page.getByRole("textbox", {
    name: /^Storage policy limit /,
  });
  await expect(quotaInput).toHaveValue("1");
  await quotaInput.fill("4");

  await page
    .locator(".admin-panel-nav")
    .getByRole("button", { name: "Audit log" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save and continue" })
    .click();

  await expect(page).toHaveURL(/\/admin\/audit\?workspace=workspace-alpha/);
  await expect.poll(() => state.storagePolicyRequests.length).toBe(1);
  expect(state.storagePolicyRequests[0]).toMatchObject({
    quotaBytes: gibibyte * 4,
    workspaceId: workspaceAlpha,
  });
});

test("shows degraded aggregate health when one subsystem fails", async ({
  page,
}) => {
  await mockAdminIntegrityApi(page, { degradedHealth: true });

  await page.goto("/admin/status?scope=system");
  const health = page.locator(".admin-health-center");
  await expect(
    health.locator(".admin-health-header strong[data-status='error']"),
  ).toHaveText("Unavailable");
  const storageCheck = health.locator(".admin-health-check", {
    hasText: "Storage backend",
  });
  await expect(storageCheck).toHaveAttribute("data-status", "error");
  await expect(storageCheck).toContainText("Unavailable");
  await expect(storageCheck).toContainText("Object store timeout");
  await expect(
    health.locator(".admin-health-check", { hasText: "Database" }),
  ).toHaveAttribute("data-status", "ok");
});

type MockOptions = {
  degradedHealth?: boolean;
  failStoragePolicy?: boolean;
};

async function mockAdminIntegrityApi(page: Page, options: MockOptions = {}) {
  const state = {
    auditRequests: [] as Array<Record<string, string | number | null>>,
    authoritativeSettingsReads: 0,
    authoritativeUsageReads: 0,
    overviewRequests: [] as Array<Record<string, string | null>>,
    overviewShouldFail: false,
    storagePolicyRequests: [] as Array<Record<string, unknown>>,
  };
  let authoritativeStorage = false;
  let savedDefaultUserQuotaBytes = gibibyte / 2;
  let savedQuotaBytes = gibibyte;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (method === "GET" && path === "/setup/status") {
      await json(route, {
        bootstrapCompleted: true,
        databaseAvailable: true,
        needsSetup: false,
      });
      return;
    }
    if (method === "GET" && path === "/auth/me") {
      await json(route, adminUser());
      return;
    }
    if (method === "GET" && path === "/site/settings/public") {
      await json(route, siteSettings());
      return;
    }
    if (method === "GET" && path === "/site/settings/public/translations") {
      await json(route, { bundles: [] });
      return;
    }
    if (method === "GET" && path === "/site/settings/translations") {
      await json(route, { bundles: [] });
      return;
    }
    if (method === "GET" && path === "/workspaces") {
      await json(route, workspaces());
      return;
    }
    if (method === "GET" && path === "/admin/overview") {
      state.overviewRequests.push({
        scope: url.searchParams.get("scope"),
        workspaceId: url.searchParams.get("workspaceId"),
      });
      if (state.overviewShouldFail) {
        await json(route, { message: "overview unavailable" }, 503);
        return;
      }
      await json(route, overviewResponse(readAdminScope(url)));
      return;
    }
    if (method === "GET" && path === "/admin/health") {
      await json(route, healthResponse(Boolean(options.degradedHealth)));
      return;
    }
    if (method === "GET" && path === "/audit/events") {
      state.auditRequests.push({
        limit: Number(url.searchParams.get("limit")),
        offset: Number(url.searchParams.get("offset")),
        query: url.searchParams.get("query"),
        scope: url.searchParams.get("scope"),
        workspaceId: url.searchParams.get("workspaceId"),
      });
      await json(route, auditResponse(url));
      return;
    }
    if (method === "GET" && path === "/storage/settings") {
      if (authoritativeStorage) state.authoritativeSettingsReads += 1;
      await json(
        route,
        storageSettings(
          authoritativeStorage ? gibibyte * 3 : savedQuotaBytes,
        ),
      );
      return;
    }
    if (method === "GET" && path === "/storage/usage") {
      if (authoritativeStorage) state.authoritativeUsageReads += 1;
      await json(
        route,
        storageUsage(
          authoritativeStorage ? gibibyte * 3 : savedQuotaBytes,
          authoritativeStorage
            ? (gibibyte * 3) / 4
            : savedDefaultUserQuotaBytes,
        ),
      );
      return;
    }
    if (method === "GET" && path === "/storage/usage/breakdown") {
      await json(route, storageBreakdown());
      return;
    }
    if (method === "PUT" && path === "/admin/storage-policy") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.storagePolicyRequests.push(body);
      if (options.failStoragePolicy) {
        authoritativeStorage = true;
        await json(route, { message: "atomic write rolled back" }, 409);
        return;
      }
      savedQuotaBytes = body.quotaBytes as number;
      savedDefaultUserQuotaBytes = body.defaultUserQuotaBytes as number;
      await json(route, {
        settings: storageSettings(savedQuotaBytes),
        usage: storageUsage(savedQuotaBytes, savedDefaultUserQuotaBytes),
      });
      return;
    }
    if (method === "GET" && path === "/file-nodes/trash-policy") {
      await json(route, filePolicy());
      return;
    }
    if (method === "PATCH" && path === "/file-nodes/trash-policy") {
      await json(route, { ...filePolicy(), ...request.postDataJSON() });
      return;
    }
    if (method === "GET" && path === "/system/overview") {
      await json(route, systemOverview());
      return;
    }
    if (method === "GET" && path === "/site/settings") {
      await json(route, adminSiteSettings());
      return;
    }
    if (method === "GET" && path === "/mail/settings") {
      await json(route, mailSettings());
      return;
    }
    if (method === "GET" && path === "/auth/settings") {
      await json(route, authSettings());
      return;
    }
    if (
      method === "GET" &&
      path === "/identity/oauth/settings/providers"
    ) {
      await json(route, { activeProvider: null, configured: false, providers: [] });
      return;
    }
    if (method === "GET" && path === "/auth/passkeys") {
      await json(route, []);
      return;
    }
    if (method === "GET" && path === "/auth/security/methods") {
      await json(route, {
        compliant: true,
        methodCount: 1,
        minimumAuthenticationMethods: 1,
        methods: { oauth: false, passkey: false, password: true, recoveryCodes: 0 },
      });
      return;
    }

    await json(route, { message: `Unhandled ${method} ${path}` }, 404);
  });

  return state;
}

function auditResponse(url: URL) {
  const query = url.searchParams.get("query");
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const total = query === "risk" ? 31 : 3;
  const pageCount = Math.max(0, Math.min(limit, total - offset));
  const items = Array.from({ length: pageCount }, (_, index) =>
    auditEvent(offset + index + 1, query === "risk"),
  );
  const failed = query === "risk" ? total : 1;
  return {
    facets: {
      actions: ["auth.login_failed", "file.download_started"],
      actors: ["account", "workspace"],
    },
    generatedAt: now,
    items,
    limit,
    offset,
    scope: readAdminScope(url),
    summary: { failed, success: total - failed },
    total,
  };
}

function auditEvent(index: number, risk = false) {
  return {
    action: risk ? "auth.login_failed" : "file.download_started",
    actor: risk ? "account" : "workspace",
    actorDisplayName: risk ? "Risk Reviewer" : "Admin Ada",
    actorEmail: risk ? "risk@example.com" : "admin@example.com",
    actorUserId: risk ? "user-risk" : "user-admin",
    createdAt: new Date(Date.parse(now) - index * 60_000).toISOString(),
    id: `audit-${index}`,
    ipAddress: risk ? "203.0.113.9" : "10.0.0.8",
    metadata: { result: risk ? "failed" : "success" },
    nodeId: risk ? null : `file-${index}`,
    resourceType: risk ? "system" : "file",
    result: risk ? "failed" : "success",
    shareToken: null,
    target: risk ? `Risk record ${index}` : `Document ${index}`,
    workspaceId: risk ? null : workspaceAlpha,
  };
}

function overviewResponse(scope: ReturnType<typeof readAdminScope>) {
  return {
    audit: {
      dailyTrend: [
        { date: "2026-08-11", failed: 1, total: 3 },
        { date: "2026-08-12", failed: 0, total: 5 },
      ],
      failed: 1,
      recentRiskEvents: [auditEvent(1, true)],
      resourceDistribution: [
        { resourceType: "file", total: 5 },
        { resourceType: "system", total: 3 },
      ],
      total: 8,
    },
    generatedAt: now,
    scope,
    storage: {
      activeBytes: gibibyte,
      fileCount: 12,
      folderCount: 3,
      trashBytes: gibibyte / 4,
      trashFileCount: 2,
      usedBytes: gibibyte * 1.5,
      versionBytes: gibibyte / 4,
      versionCount: 4,
    },
    window: { from: windowFrom, to: now },
    workspaceCount: scope.kind === "system" ? 0 : scope.kind === "all" ? 2 : 1,
  };
}

function healthResponse(degraded: boolean) {
  const ids = [
    "application",
    "database",
    "storage",
    "mail",
    "queue",
    "reconcile",
  ];
  return {
    checkedAt: now,
    checks: ids.map((id) => {
      const failed = degraded && id === "storage";
      return {
        checkedAt: now,
        durationMs: failed ? 1200 : 4,
        id,
        reason: failed ? "Object store timeout" : null,
        settingsPath: failed ? "/admin/system/storage" : null,
        status: failed ? "error" : "ok",
      };
    }),
    status: degraded ? "error" : "ok",
  };
}

function readAdminScope(url: URL) {
  const scope = url.searchParams.get("scope");
  if (scope === "workspace") {
    return {
      kind: "workspace" as const,
      workspaceId: url.searchParams.get("workspaceId") ?? workspaceAlpha,
    };
  }
  return { kind: scope === "system" ? ("system" as const) : ("all" as const) };
}

function adminUser() {
  return {
    avatarUrl: null,
    createdAt: now,
    displayName: "Admin Ada",
    email: "admin@example.com",
    id: "user-admin",
    locale: "en",
    role: "admin",
    theme: "light",
    timezone: "UTC",
  };
}

function workspaces() {
  return [
    {
      createdAt: now,
      id: workspaceAlpha,
      memberCount: 4,
      name: "Alpha",
      rootNodeId: "root-alpha",
      updatedAt: now,
    },
    {
      createdAt: now,
      id: workspaceBeta,
      memberCount: 2,
      name: "Beta",
      rootNodeId: "root-beta",
      updatedAt: now,
    },
  ];
}

function siteSettings() {
  return { authLogoDataUrl: null, siteName: "ICEDR" };
}

function adminSiteSettings() {
  return {
    bootstrapCompleted: true,
    databaseProfile: {
      dbName: "icedr",
      host: "127.0.0.1",
      passwordProvided: true,
      passwordSource: "env",
      port: 5432,
      provider: "postgresql",
      user: "icedr",
      verified: true,
      verifiedAt: now,
    },
    mail: mailSettings(),
    oauth: {
      audience: "",
      clientId: "",
      clientSecretConfigured: false,
      enabled: false,
      issuerUrl: "",
      providerMode: "standard",
      providerProfile: "oidc",
      redirectUri: "",
      scopes: "openid profile email",
    },
    passkey: passkeySettings(),
    site: siteSettings(),
  };
}

function authSettings() {
  return {
    localEnabled: true,
    minimumAuthenticationMethods: 1,
    oauthConfigured: false,
    oauthEnabled: false,
    passkeyConfigured: false,
    passkeyEnabled: false,
    updatedAt: now,
  };
}

function passkeySettings() {
  return {
    enabled: false,
    origin: "http://127.0.0.1:13000",
    rpId: "127.0.0.1",
    rpName: "ICEDR",
  };
}

function mailSettings() {
  return {
    configured: false,
    enabled: false,
    fromEmail: "",
    fromName: "ICEDR",
    host: "",
    passwordConfigured: false,
    port: 587,
    replyTo: "",
    secure: false,
    username: "",
    verifiedAt: null,
  };
}

function storageSettings(quotaBytes: number) {
  return {
    accessKeyId: "",
    bucket: "",
    distributedStorageEnabled: false,
    endpoint: "",
    forcePathStyle: true,
    localRoot: "data/local-files",
    objectStorageConfigured: false,
    physicalAvailableBytes: gibibyte * 9,
    physicalCapacityBytes: gibibyte * 10,
    physicalCapacityCheckedAt: now,
    physicalCapacityKnown: true,
    physicalCapacityReason: null,
    physicalQuotaLimitBytes: gibibyte * 10,
    quotaBytes,
    region: "us-east-1",
    secretAccessKeyConfigured: false,
    storageProvider: "local",
    updatedAt: now,
  };
}

function storageUsage(
  storagePolicyQuotaBytes: number,
  defaultUserQuotaBytes: number,
) {
  return {
    activeBytes: gibibyte / 4,
    defaultUserQuotaBytes,
    fileCount: 3,
    folderCount: 1,
    quotaBytes: storagePolicyQuotaBytes,
    quotaSource: "policy",
    spaceScope: "workspace",
    storagePolicyQuotaBytes,
    trashBytes: 0,
    trashFileCount: 0,
    updatedAt: now,
    usagePercent: 25,
    usedBytes: gibibyte / 4,
    versionBytes: 0,
    versionCount: 0,
    workspaceId: workspaceAlpha,
  };
}

function storageBreakdown() {
  return {
    byDirectory: [],
    byType: [],
    byUser: [],
    trend: [],
    updatedAt: now,
    workspaceId: workspaceAlpha,
  };
}

function filePolicy() {
  return {
    trashRetentionDays: 30,
    updatedAt: now,
    versionRetentionCount: 20,
    versionRetentionDays: 180,
  };
}

function systemOverview() {
  return {
    apiName: "ICEDR API",
    appPrereleaseLabel: null,
    appReleaseChannel: "stable",
    appVersion: "0.1.0",
    appVersionTag: "v0.1.0",
    architecture: "x64",
    loadAverage: [0.1, 0.2, 0.3],
    memoryFreeBytes: gibibyte * 4,
    memoryTotalBytes: gibibyte * 8,
    memoryUsagePercent: 50,
    nodeVersion: "v24.0.0",
    operatingSystem: "Windows",
    osPlatform: "win32",
    osRelease: "10",
    osUptimeSeconds: 3600,
    processUptimeSeconds: 600,
    runtime: "node",
    serviceStartedAt: windowFrom,
    updatedAt: now,
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
