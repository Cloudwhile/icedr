import { expect, test, type Page, type Route } from "@playwright/test";

const now = new Date("2026-06-02T04:00:00.000Z").toISOString();
const workspaceId = "workspace-default";
const shareToken = "share-smoke";
const fileId = "file-smoke";
const fileName = "Smoke Roadmap.txt";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Share-Access-Session",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
  "Access-Control-Allow-Origin": "*",
};

test("smoke: creates a share, verifies email access, downloads, and sees audit", async ({ page }) => {
  const state = await mockIcedrApi(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("icedr.auth.token", "smoke-token");
  });

  await page.goto("/");
  await expect(page.getByText(fileName)).toBeVisible();

  const fileRow = page.getByRole("row", { name: new RegExp(fileName) });
  await fileRow.locator('button[aria-label="More"]').click();
  await page.getByRole("menuitem", { name: "Share" }).click();

  await expect(page.getByText("Create external link")).toBeVisible();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("External link created").first()).toBeVisible();
  expect(state.shareCreated).toBe(true);

  await page.goto(`/share/s/${shareToken}`);
  await expect(page.getByText("External share")).toBeVisible();
  await expect(page.getByText(fileName).first()).toBeVisible();

  await page.locator('button[aria-label="More"]').last().click();
  await page.getByRole("menuitem", { name: "Download" }).click();
  await page.getByPlaceholder("email@example.com").fill("reviewer@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByPlaceholder("000000").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("Verified. Downloads are available.")).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  const downloadResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().includes(`/shares/${shareToken}/items/${fileId}/download?downloadId=`) &&
    response.status() === 200
  );
  await page.getByRole("button", { name: "Download" }).last().click();
  const downloadResponse = await downloadResponsePromise;
  expect(downloadResponse.headers()["content-disposition"]).toContain(fileName);
  expect(state.downloaded).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByText("Audit log")).toBeVisible();
  await expect(page.getByText(/visitor share download_started/)).toBeVisible();
});

async function mockIcedrApi(page: Page) {
  const state = {
    downloaded: false,
    shareCreated: false,
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
      await fulfillJson(route, {
        bootstrapCompleted: true,
        databaseAvailable: true,
        needsSetup: false,
        site: publicSiteSettings(),
      });
      return;
    }

    if (method === "GET" && path === "/auth/me") {
      await fulfillJson(route, {
        avatarUrl: null,
        createdAt: now,
        displayName: "Smoke Admin",
        email: "admin@example.com",
        id: "admin-user",
        locale: "en",
        role: "admin",
        theme: "light",
        timezone: "UTC",
      });
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

    if (method === "GET" && path === "/workspaces") {
      await fulfillJson(route, [
        {
          createdAt: now,
          id: workspaceId,
          memberCount: 1,
          name: "Smoke Workspace",
          rootNodeId: "root",
          updatedAt: now,
        },
      ]);
      return;
    }

    if (method === "GET" && path === "/file-nodes") {
      const stateParam = url.searchParams.get("state");
      await fulfillJson(route, stateParam === "archived" ? [] : [fileNode()]);
      return;
    }

    if (method === "GET" && path === "/shares") {
      await fulfillJson(route, state.shareCreated ? [registeredShare()] : []);
      return;
    }

    if (method === "POST" && path === "/shares") {
      state.shareCreated = true;
      await fulfillJson(route, registeredShare());
      return;
    }

    if (method === "GET" && path === `/shares/${shareToken}`) {
      await fulfillJson(route, {
        ...registeredShare(),
        items: [shareFileNode()],
      });
      return;
    }

    if (method === "POST" && path === `/shares/${shareToken}/access-sessions/email-code`) {
      await fulfillJson(route, {
        configured: true,
        delivery: "email",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
      return;
    }

    if (method === "POST" && path === `/shares/${shareToken}/access-sessions/verify-email`) {
      await fulfillJson(route, {
        availableAt: now,
        downloadLimit: "No download limit",
        email: "reviewer@example.com",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        identityType: "email",
        sessionId: "share-session-smoke",
        shareToken,
        speedLimit: null,
        waitSeconds: 0,
      });
      return;
    }

    if (method === "GET" && path === "/identity/oauth") {
      await fulfillJson(route, {
        audience: "",
        clientId: "",
        configured: false,
        issuerUrl: "",
        protocol: "oidc",
        provider: "oauth",
        tokenType: "Bearer",
      });
      return;
    }

    if (method === "POST" && path === `/shares/${shareToken}/items/${fileId}/download-intents`) {
      await fulfillJson(route, {
        availableAt: now,
        downloadId: "download-smoke",
        downloadUrl: `/api/shares/${shareToken}/items/${fileId}/download?downloadId=download-smoke`,
        expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
        filename: fileName,
        method: "backend-manifest",
        nodeId: fileId,
      });
      return;
    }

    if (method === "GET" && path === `/shares/${shareToken}/items/${fileId}/download`) {
      state.downloaded = true;
      await route.fulfill({
        body: "smoke file content",
        headers: {
          ...corsHeaders,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": "text/plain",
        },
        status: 200,
      });
      return;
    }

    if (method === "GET" && path === "/workspaces/workspace-default/share-settings") {
      await fulfillJson(route, workspaceShareSettings());
      return;
    }

    if (method === "GET" && path === "/audit/events") {
      await fulfillJson(route, state.downloaded ? [auditEvent()] : []);
      return;
    }

    if (method === "GET" && path === "/transfers") {
      await fulfillJson(route, []);
      return;
    }

    if (method === "GET" && path === "/storage/usage") {
      await fulfillJson(route, {
        fileCount: 1,
        folderCount: 0,
        quotaBytes: 1024 * 1024,
        updatedAt: now,
        usagePercent: 1,
        usedBytes: 1024,
        workspaceId,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ message: `Unhandled ${method} ${path}` }),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 404,
    });
  });

  return state;
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
    siteName: "ICEDR Smoke",
  };
}

function fileNode() {
  return {
    archivedAt: null,
    createdAt: now,
    id: fileId,
    kind: "doc",
    mimeType: "text/plain",
    name: fileName,
    objectKey: "objects/smoke-roadmap.txt",
    owner: "Mina",
    parentNodeId: null,
    sizeBytes: 42,
    starred: false,
    updatedAt: now,
    workspaceId,
  };
}

function shareFileNode() {
  const { objectKey: _objectKey, ...node } = fileNode();
  return node;
}

function registeredShare() {
  return {
    allowDownload: true,
    allowPreview: true,
    allowedItemIds: [fileId],
    createdAt: now,
    dynamicRootId: null,
    expiresDays: 7,
    mode: "single-file",
    owner: "Mina",
    policy: {
      allowedDomain: "example.com",
      downloadLimit: "",
      expiresUnit: "days",
      expiresValue: 7,
      speedUnit: "KB/s",
      speedValue: 0,
      waitUnit: "seconds",
      waitValue: 0,
    },
    remark: "",
    revokedAt: null,
    rootItemIds: [fileId],
    title: fileName,
    token: shareToken,
    url: `http://127.0.0.1:13000/share/s/${shareToken}`,
    workspaceId,
  };
}

function workspaceShareSettings() {
  return {
    allowPermanent: false,
    allowedDomains: ["example.com"],
    anonymousAccess: "email-required",
    audit: {
      alerts: true,
      anomaly: true,
      downloads: true,
      ip: true,
      userAgent: true,
    },
    defaultExpiresDays: 7,
    emailRule: "domains",
    maxExpiresDays: 30,
    updatedAt: now,
    workspaceId,
  };
}

function auditEvent() {
  return {
    action: "share.download_started",
    actor: "visitor",
    createdAt: now,
    id: "audit-download-smoke",
    metadata: { source: "e2e" },
    nodeId: fileId,
    shareToken,
    target: shareToken,
    workspaceId,
  };
}
