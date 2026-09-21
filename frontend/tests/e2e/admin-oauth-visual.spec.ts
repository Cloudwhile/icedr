import { expect, test, type Page, type Route } from "@playwright/test";
import { resolve } from "node:path";

const now = "2026-09-20T12:00:00.000Z";
const workspaceId = "workspace-ui";
const screenshotRoot = resolve(process.cwd(), "../output/playwright");
const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST",
  "Access-Control-Allow-Origin": "*",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("icedr.auth.token", "visual-admin-token");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
  await mockApplicationApi(page);
});

test("keeps the admin and OAuth layouts readable across breakpoints", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/admin/system/oauth");

  await expect(
    page.getByRole("heading", { name: "OAuth configuration" }),
  ).toBeVisible();
  await expect(page.locator(".admin-sidebar-status-icon")).toBeVisible();
  await expect(page.locator(".admin-sidebar-status-dot")).toHaveCount(0);
  await expect(page.locator(".drive-oauth-provider-group")).toHaveCount(1);
  await page.waitForTimeout(450);
  await expectNoHorizontalOverflow(page);
  await expectNoOverlap(page, ".admin-header-title", ".admin-header-actions");
  await page.screenshot({
    fullPage: true,
    path: resolve(screenshotRoot, "oauth-admin-final-1440.png"),
  });

  await page.setViewportSize({ height: 900, width: 867 });
  await expectSidebarBesideMain(page);
  await expectNoHorizontalOverflow(page);
  await expectNoOverlap(
    page,
    ".drive-oauth-provider-group-copy",
    ".drive-oauth-provider-count",
  );
  await page.screenshot({
    fullPage: true,
    path: resolve(screenshotRoot, "oauth-admin-final-867.png"),
  });

  await page.getByRole("button", { name: "Add provider" }).click();
  await expect(
    page.getByRole("heading", { name: "Add OAuth provider" }),
  ).toBeVisible();
  await expect(page.locator(".drive-oauth-template-option")).toHaveCount(6);
  await page.waitForTimeout(500);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: resolve(screenshotRoot, "oauth-dialog-final-867.png"),
  });
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(
    page.getByRole("heading", { name: "OAuth configuration" }),
  ).toBeVisible();
  await expectActiveMobileAdminNavigationInView(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: resolve(screenshotRoot, "oauth-admin-final-mobile.png"),
  });
});

test("hides file actions and the decorative icon for an empty root", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");

  const emptyState = page.locator(".drive-empty-state");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toHaveCSS("opacity", "1");
  await expect(emptyState.locator(".drive-empty-state-title")).toBeVisible();
  await page.waitForTimeout(450);
  await expect(emptyState.locator(".drive-empty-state-icon")).toHaveCount(0);
  await expect(emptyState.locator(".drive-empty-state-actions")).toHaveCount(0);
  await expect(page.locator(".drive-toolbar-action-group")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    fullPage: true,
    path: resolve(screenshotRoot, "drive-empty-root-final.png"),
  });
});

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectSidebarBesideMain(page: Page) {
  const boxes = await page.evaluate(() => {
    const sidebar = document.querySelector(".admin-sidebar");
    const main = document.querySelector(".admin-main");
    if (!sidebar || !main) return null;
    const a = sidebar.getBoundingClientRect();
    const b = main.getBoundingClientRect();
    return {
      mainLeft: b.left,
      sidebarRight: a.right,
      sidebarWidth: a.width,
    };
  });
  expect(boxes).not.toBeNull();
  expect(boxes?.sidebarWidth ?? 0).toBeGreaterThan(220);
  expect(boxes?.mainLeft ?? 0).toBeGreaterThanOrEqual(
    (boxes?.sidebarRight ?? 0) - 1,
  );
}

async function expectActiveMobileAdminNavigationInView(page: Page) {
  const box = await page
    .locator('.admin-panel-subnav button[data-active="true"]')
    .boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
}

async function expectNoOverlap(page: Page, left: string, right: string) {
  const boxes = await page.evaluate(
    ([leftSelector, rightSelector]) => {
      const leftElement = document.querySelector(leftSelector);
      const rightElement = document.querySelector(rightSelector);
      if (!leftElement || !rightElement) return null;
      const a = leftElement.getBoundingClientRect();
      const b = rightElement.getBoundingClientRect();
      return {
        a: { bottom: a.bottom, left: a.left, right: a.right, top: a.top },
        b: { bottom: b.bottom, left: b.left, right: b.right, top: b.top },
      };
    },
    [left, right] as const,
  );
  expect(boxes).not.toBeNull();
  const overlaps = Boolean(
    boxes &&
      boxes.a.left < boxes.b.right &&
      boxes.a.right > boxes.b.left &&
      boxes.a.top < boxes.b.bottom &&
      boxes.a.bottom > boxes.b.top,
  );
  expect(overlaps).toBe(false);
}

async function mockApplicationApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();
    if (method === "OPTIONS") {
      return route.fulfill({ headers: corsHeaders, status: 204 });
    }
    if (method === "GET" && path === "/setup/status") {
      return json(route, {
        bootstrapCompleted: true,
        databaseAvailable: true,
        needsSetup: false,
      });
    }
    if (method === "GET" && path === "/auth/me") {
      return json(route, adminUser());
    }
    if (method === "GET" && path === "/site/settings/public") {
      return json(route, { authLogoDataUrl: null, siteName: "ICEDR" });
    }
    if (
      method === "GET" &&
      path === "/site/settings/public/translations"
    ) {
      return json(route, { bundles: [] });
    }
    if (method === "GET" && path === "/workspaces") {
      return json(route, [workspace()]);
    }
    if (method === "GET" && path === "/auth/settings") {
      return json(route, {
        localEnabled: true,
        minimumAuthenticationMethods: 1,
        oauthConfigured: true,
        oauthEnabled: false,
        passkeyConfigured: true,
        passkeyEnabled: true,
        updatedAt: now,
      });
    }
    if (
      method === "GET" &&
      path === "/identity/oauth/settings/providers"
    ) {
      const provider = oauthProvider();
      return json(route, {
        activeProvider: provider,
        configured: true,
        providers: [provider],
      });
    }
    if (method === "GET" && path === "/shares") {
      return json(route, []);
    }
    if (method === "GET" && path === "/file-nodes") {
      return json(route, []);
    }
    if (method === "GET" && path === "/transfers") {
      return json(route, []);
    }
    if (method === "GET" && path === `/workspaces/${workspaceId}/share-settings`) {
      return json(route, shareSettings());
    }
    if (method === "GET" && path === "/storage/usage") {
      return json(route, storageUsage(url.searchParams.get("spaceScope")));
    }
    return json(route, { message: `Unhandled ${method} ${path}` }, 404);
  });
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function adminUser() {
  return {
    avatarUrl: null,
    createdAt: now,
    displayName: "Admin",
    email: "admin@example.com",
    id: "admin-user",
    locale: "en",
    role: "admin",
    theme: "light",
    timezone: "UTC",
  };
}

function workspace() {
  return {
    createdAt: now,
    id: workspaceId,
    memberCount: 1,
    name: "Operations",
    rootNodeId: "root-ui",
    updatedAt: now,
  };
}

function oauthProvider() {
  return {
    allowedEmailDomains: ["example.com"],
    allowSignup: true,
    audience: "",
    authorizationUrl: "",
    clientId: "oauth-client-1234567890",
    clientSecretConfigured: true,
    configured: true,
    createdAt: now,
    displayName: "Google Workspace",
    enabled: true,
    id: "oauth-google",
    issuerUrl: "https://accounts.google.com",
    linkByVerifiedEmail: true,
    providerKey: "google",
    providerMode: "standard",
    providerProfile: "oidc",
    redirectUri: "http://127.0.0.1:13000/callback",
    requireVerifiedEmail: true,
    scopes: "openid email profile",
    tokenUrl: "",
    updatedAt: now,
    userinfoUrl: "",
  };
}

function shareSettings() {
  return {
    allowedDomains: [],
    anonymousAccess: "blocked",
    audit: {
      alerts: true,
      anomaly: true,
      downloads: true,
      ip: true,
      userAgent: true,
    },
    defaultExpiresDays: 7,
    emailRule: "any",
    maxExpiresDays: 30,
    allowPermanent: false,
    updatedAt: now,
    workspaceId,
  };
}

function storageUsage(spaceScope: string | null) {
  return {
    activeBytes: 0,
    defaultUserQuotaBytes: null,
    fileCount: 0,
    folderCount: 0,
    quotaBytes: null,
    quotaSource: "unlimited",
    spaceScope: spaceScope ?? "workspace",
    storagePolicyQuotaBytes: null,
    trashBytes: 0,
    trashFileCount: 0,
    updatedAt: now,
    usagePercent: null,
    usedBytes: 0,
    versionBytes: 0,
    versionCount: 0,
    workspaceId,
  };
}
