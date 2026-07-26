import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-06-02T04:00:00.000Z";
const validSetupToken = "fixed-test-setup-token-000000000001";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Setup-Token",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
  "Access-Control-Allow-Origin": "*",
};

test("visual smoke: renders auth and gated setup surfaces", async ({ page }, testInfo) => {
  const setupState = await mockAuthSetupApi(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("icedr.auth.token");
    window.localStorage.setItem("icedr.ui.locale", "en");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
  await page.setViewportSize({ width: 1536, height: 1024 });

  await page.goto("/login");
  await expect(page.locator(".icedr-auth-shell")).toBeVisible();
  await expect(page.locator(".icedr-auth-visual-panel")).toBeVisible();
  await expect(page.locator(".icedr-auth-form-card")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await capture(page, "auth-login.png", testInfo);

  await page.goto("/register");
  await expect(page.locator(".icedr-auth-shell")).toBeVisible();
  await expect(page.locator(".icedr-auth-form-card")).toBeVisible();
  await capture(page, "auth-register.png", testInfo);

  await page.goto("/forgot-password");
  await expect(page.locator(".icedr-auth-shell")).toBeVisible();
  await expect(page.locator(".icedr-auth-form-card")).toBeVisible();
  await capture(page, "auth-forgot.png", testInfo);

  setupState.currentUser = authUser();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".icedr-auth-shell")).toHaveCount(0);

  setupState.currentUser = null;
  setupState.needsSetup = true;
  await page.goto("/setup");
  await expectSetupGate(page);
  await expect(page.locator(".icedr-setup-rail")).toHaveCount(0);
  await expect(page.locator(".icedr-setup-section")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAccessPanelControlsDoNotOverlap(page);
  await capture(page, "setup-access-gate-desktop.png", testInfo);

  const accessInput = page.getByLabel("Access credential");
  await expect(accessInput).toHaveAttribute("type", "password");
  await page.evaluate(() =>
    window.sessionStorage.setItem(
      "icedr.setup.token",
      "previous-stale-setup-token",
    ),
  );
  await accessInput.fill("wrong-token");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByText("The credential is invalid. Try again.")).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.getItem("icedr.setup.token"))).toBeNull();
  expect(setupState.lastSetupStatusToken).toBe("wrong-token");

  await accessInput.fill(validSetupToken);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expectSetupFlow(page, "Database");
  expect(await page.evaluate(() => window.sessionStorage.getItem("icedr.setup.token"))).toBe(validSetupToken);
  expect(setupState.lastSetupStatusToken).toBe(validSetupToken);
  await capture(page, "setup-authorized-desktop.png", testInfo);

  await page.reload();
  await expectSetupFlow(page, "Database");
  expect(setupState.lastSetupStatusToken).toBe(validSetupToken);

  setupState.statusMode = "ordinary-503";
  await page.reload();
  await expect(page.getByText("Setup status is temporarily unavailable.")).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.getItem("icedr.setup.token"))).toBe(validSetupToken);

  setupState.statusMode = "normal";
  await page.getByRole("button", { name: "Retry" }).click();
  await expectSetupFlow(page, "Database");

  await fillSensitiveSetupFields(page);
  await page.getByRole("button", { name: "Lock setup" }).click();
  await expectSetupGate(page);
  expect(await page.evaluate(() => window.sessionStorage.getItem("icedr.setup.token"))).toBeNull();
  await expectNoInputValue(page, [
    "remote-db-password",
    "admin-password",
    "oauth-client-secret",
    "smtp-password",
    "s3-secret-access-key",
  ]);

  await page.getByLabel("Access credential").fill(validSetupToken);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expectSetupFlow(page);
  await expect(page.getByLabel("Remote password")).toHaveCount(0);
  await expectAllVisiblePasswordInputsEmpty(page);

  setupState.statusMode = "forbidden";
  await page.reload();
  await expectSetupGate(page);
  expect(await page.evaluate(() => window.sessionStorage.getItem("icedr.setup.token"))).toBeNull();

  await page.evaluate((token) => window.sessionStorage.setItem("icedr.setup.token", token), validSetupToken);
  setupState.statusMode = "bootstrap-unavailable";
  await page.goto("/setup");
  await expect(page.getByText("Setup is temporarily unavailable. Try again later.")).toBeVisible();
  expect(await page.evaluate(() => window.sessionStorage.getItem("icedr.setup.token"))).toBeNull();

  setupState.statusMode = "normal";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.sessionStorage.removeItem("icedr.setup.token"));
  await page.goto("/setup");
  await expectSetupGate(page);
  await expect(page.locator(".icedr-setup-rail")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAccessPanelControlsDoNotOverlap(page);
  await capture(page, "setup-access-gate-mobile.png", testInfo);
});

async function fillSensitiveSetupFields(page: Page) {
  await page.getByRole("button", { name: "Switch to PostgreSQL" }).click();
  await page.getByLabel("Host").fill("db.example.com");
  await page.getByLabel("Database name").fill("icedr");
  await page.getByLabel("User").fill("icedr");
  await page.getByLabel("Remote password").fill("remote-db-password");

  await page.getByRole("button", { name: /Administrator account/ }).click();
  await page.getByLabel("Display name").fill("Admin");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("admin-password");

  await page.getByRole("button", { name: /Authentication/ }).click();
  await page.getByRole("button", { name: "Allow OAuth login" }).click();
  await page.getByLabel("OAuth client secret").fill("oauth-client-secret");

  await page.getByRole("button", { name: /Mail \/ SMTP/ }).click();
  await page.getByRole("button", { name: "Enable SMTP delivery" }).click();
  await page.getByLabel("SMTP password").fill("smtp-password");

  await page.getByRole("button", { name: /Storage & external link policy/ }).click();
  await page.getByRole("button", { name: "Use distributed object storage" }).click();
  await page.getByLabel("Secret access key").fill("s3-secret-access-key");
}

async function expectSetupGate(page: Page) {
  await expect(page.locator(".icedr-setup-access-panel")).toBeVisible();
  await expect(page.locator(".icedr-setup-access-panel").getByRole("heading", { name: "Verify setup access" })).toBeVisible();
  await expect(page.getByLabel("Access credential")).toBeVisible();
}

async function expectSetupFlow(page: Page, expectedSectionText?: string) {
  await expect(page.locator(".icedr-setup-access-panel")).toHaveCount(0);
  await expect(page.locator(".icedr-setup-page")).toBeVisible();
  await expect(page.locator(".icedr-setup-section")).toHaveCount(1);
  if (expectedSectionText) {
    await expect(page.locator(".icedr-setup-section")).toContainText(expectedSectionText);
  }
  await expect(page.getByRole("button", { name: "Lock setup" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
}

async function capture(page: Page, name: string, testInfo: { outputPath: (path: string) => string }) {
  const path = resolve(process.cwd(), "../output/playwright", name);
  mkdirSync(resolve(process.cwd(), "../output/playwright"), { recursive: true });
  await page.waitForTimeout(180);
  await page.screenshot({ fullPage: true, path });
  await page.screenshot({ fullPage: true, path: testInfo.outputPath(name) });
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

async function expectAccessPanelControlsDoNotOverlap(page: Page) {
  const overlap = await page.locator(".icedr-setup-access-panel").evaluate((panel) => {
    const controls = Array.from(panel.querySelectorAll("input, button"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect());
    for (let index = 0; index < controls.length; index += 1) {
      for (let next = index + 1; next < controls.length; next += 1) {
        const a = controls[index];
        const b = controls[next];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          return true;
        }
      }
    }
    return false;
  });

  expect(overlap).toBe(false);
}

async function expectNoInputValue(page: Page, forbiddenValues: string[]) {
  const values = await page.locator("input").evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  for (const value of forbiddenValues) {
    expect(values).not.toContain(value);
  }
}

async function expectAllVisiblePasswordInputsEmpty(page: Page) {
  const values = await page.locator("input[type='password']:visible").evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
  expect(values.every((value) => value === "")).toBe(true);
}

async function mockAuthSetupApi(page: Page) {
  const setupState = {
    currentUser: null as ReturnType<typeof authUser> | null,
    lastSetupStatusToken: null as string | null,
    needsSetup: false,
    statusMode: "normal" as "normal" | "ordinary-503" | "forbidden" | "bootstrap-unavailable",
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (method === "GET" && path === "/setup/status") {
      setupState.lastSetupStatusToken = request.headers()["x-setup-token"] ?? null;
      if (setupState.statusMode === "ordinary-503") {
        await fulfillJson(route, { code: "DATABASE_UNAVAILABLE", message: "Database unavailable" }, 503);
        return;
      }
      if (setupState.statusMode === "forbidden") {
        await fulfillJson(route, { code: "SETUP_BOOTSTRAP_INVALID", message: "Invalid credential" }, 403);
        return;
      }
      if (setupState.statusMode === "bootstrap-unavailable") {
        await fulfillJson(route, { code: "SETUP_BOOTSTRAP_UNAVAILABLE", message: "Setup unavailable" }, 503);
        return;
      }
      await fulfillJson(route, setupStatus(setupState.needsSetup, setupState.lastSetupStatusToken === validSetupToken));
      return;
    }

    if (method === "GET" && path === "/site/settings/public") {
      await fulfillJson(route, publicSiteSettings());
      return;
    }

    if (method === "GET" && path === "/site/settings/public/translations") {
      await fulfillJson(route, { bundles: [] });
      return;
    }

    if (method === "GET" && path === "/auth/settings") {
      await fulfillJson(route, {
        localEnabled: true,
        minimumAuthenticationMethods: 2,
        oauthConfigured: true,
        oauthEnabled: true,
        passkeyConfigured: true,
        passkeyEnabled: true,
        updatedAt: now,
      });
      return;
    }

    if (method === "GET" && path === "/auth/me") {
      await fulfillJson(route, setupState.currentUser);
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ message: `Unhandled ${method} ${path}` }),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 404,
    });
  });
  return setupState;
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function publicSiteSettings() {
  return {
    authLogoDataUrl: null,
    siteName: "ICEDR",
  };
}

function authUser() {
  return {
    avatarUrl: null,
    createdAt: now,
    displayName: "Admin",
    email: "admin@example.com",
    id: "user-admin",
    locale: "en",
    role: "admin",
    theme: "light",
    timezone: "Asia/Hong_Kong",
  };
}

function setupStatus(needsSetup: boolean, authorized: boolean) {
  if (!needsSetup) {
    return {
      bootstrapCompleted: true,
      databaseAvailable: true,
      needsSetup: false,
    };
  }

  if (!authorized) {
    return {
      bootstrapCompleted: false,
      databaseAvailable: true,
      needsSetup: true,
      setupAccess: { authorized: false, configured: true },
    };
  }

  return {
    bootstrapCompleted: false,
    databaseAvailable: true,
    databaseProfile: {
      dbName: "icedr.sqlite",
      host: "local",
      passwordProvided: false,
      passwordSource: "local",
      port: 0,
      provider: "sqlite",
      user: "",
      verified: true,
      verifiedAt: now,
    },
    mail: {
      configured: true,
      enabled: false,
      fromEmail: "noreply@example.com",
      fromName: "ICEDR",
      host: "smtp.example.com",
      passwordConfigured: true,
      port: 587,
      replyTo: "support@example.com",
      secure: false,
      username: "noreply@example.com",
      verifiedAt: now,
    },
    needsSetup: true,
    oauth: {
      audience: "",
      clientId: "icedr-client",
      clientSecretConfigured: true,
      enabled: false,
      issuerUrl: "https://identity.example.com",
      providerMode: "standard",
      providerProfile: "oidc",
      redirectUri: "http://127.0.0.1:13000/callback",
      scopes: "openid profile email",
    },
    passkey: {
      origin: "http://127.0.0.1:13000",
      rpId: "127.0.0.1",
      rpName: "ICEDR",
    },
    setupAccess: { authorized: true, configured: true },
    site: publicSiteSettings(),
    storage: {
      accessKeyId: "",
      bucket: "icedr-drive",
      distributedStorageEnabled: false,
      endpoint: "",
      forcePathStyle: true,
      localRoot: "data",
      objectStorageConfigured: false,
      physicalAvailableBytes: null,
      physicalCapacityBytes: null,
      physicalCapacityCheckedAt: now,
      physicalCapacityKnown: false,
      physicalCapacityReason: null,
      physicalQuotaLimitBytes: null,
      quotaBytes: null,
      region: "us-east-1",
      secretAccessKeyConfigured: false,
      storageProvider: "local",
      updatedAt: now,
    },
  };
}
