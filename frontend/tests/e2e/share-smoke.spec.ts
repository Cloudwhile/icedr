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

test("smoke: creates a share, uses main auth for external access, downloads, and sees audit", async ({ page }) => {
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
  const useCurrentAccount = page.getByRole("button", { name: "Use current account" });
  if (await useCurrentAccount.isVisible({ timeout: 1000 }).catch(() => false)) {
    await useCurrentAccount.click();
  }
  const downloadResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().includes(`/shares/${shareToken}/items/${fileId}/download?downloadId=`) &&
    response.status() === 200
  );
  await page.getByRole("button", { name: "Download" }).last().click();
  const downloadResponse = await downloadResponsePromise;
  expect(new URL(downloadResponse.url()).origin).toBe("http://127.0.0.1:13000");
  expect(downloadResponse.headers()["content-disposition"]).toContain(fileName);
  expect(state.downloadIntentPurpose).toBe("download");
  expect(state.downloaded).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Admin panel" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.locator(".admin-panel-nav").getByRole("button", { name: "Audit log" }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  const auditRow = page.locator(".drive-audit-table .drive-audit-row").filter({
    hasText: /Smoke Admin.*Download.*Share link.*admin@example.com downloaded File/,
  });
  await expect(auditRow).toBeVisible();
  await expect(auditRow.locator(".drive-audit-actor-avatar")).toBeVisible();
  await expect(auditRow).toContainText("192.168.1.45");
  await expect(page.locator(".drive-audit-table")).not.toContainText(shareToken);
  await expect(page.locator(".drive-audit-table")).not.toContainText(fileName);
  await expect(page.locator(".drive-audit-table")).not.toContainText(fileId);
});

async function mockIcedrApi(page: Page) {
  const state = {
    downloadIntentPurpose: "",
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

    if (method === "POST" && path === `/shares/${shareToken}/access-sessions/account`) {
      await fulfillJson(route, {
        availableAt: now,
        downloadLimit: "No download limit",
        email: "admin@example.com",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        identityType: "ica",
        policyDecision: {
          bypassSpeedLimit: true,
          bypassWait: true,
          downloadLimit: "No download limit",
          identityType: "ica",
          maxDownloads: 0,
          remainingDownloads: null,
          requiresAccessSession: true,
          requiresEmailVerification: true,
          speedLimit: null,
          waitSeconds: 0,
        },
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
      const requestBody = request.postDataJSON() as { purpose?: string };
      state.downloadIntentPurpose = requestBody.purpose ?? "";
      await fulfillJson(route, {
        availableAt: now,
        downloadId: "download-smoke",
        downloadUrl: `/api/shares/${shareToken}/items/${fileId}/download?downloadId=download-smoke`,
        expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
        filename: fileName,
        method: "manifest",
        purpose: "download",
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
      const items = state.downloaded ? [auditEvent()] : [];
      await fulfillJson(route, {
        items,
        limit: Number(url.searchParams.get("limit") ?? items.length),
        offset: Number(url.searchParams.get("offset") ?? 0),
        total: items.length,
      });
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
    hasContent: true,
    id: fileId,
    kind: "doc",
    mimeType: "text/plain",
    name: fileName,
    owner: "Mina",
    parentNodeId: null,
    sizeBytes: 42,
    starred: false,
    updatedAt: now,
    workspaceId,
  };
}

function shareFileNode() {
  return fileNode();
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
    actor: "account",
    createdAt: now,
    id: "audit-download-smoke",
    metadata: {
      actorDisplayName: "Smoke Admin",
      actorEmail: "admin@example.com",
      actorName: "Smoke Admin",
      actorUserId: "admin-user",
      identityType: "ica",
      ip: "192.168.1.45",
      result: "success",
      source: "e2e",
    },
    nodeId: fileId,
    shareToken,
    target: shareToken,
    workspaceId,
  };
}
