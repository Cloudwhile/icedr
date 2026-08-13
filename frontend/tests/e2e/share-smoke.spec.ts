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
  await expect(page.getByText("admin@example.com").first()).toBeVisible();

  await page.locator('button[aria-label="More"]').last().click();
  await page.getByRole("menuitem", { name: "Download" }).click();
  const useCurrentAccount = page.getByRole("button", { name: "Use current account" });
  await expect(useCurrentAccount).toBeVisible();
  await useCurrentAccount.click();
  const downloadButton = page
    .getByRole("dialog")
    .getByRole("button", { name: "Download", exact: true });
  await expect(downloadButton).toBeVisible();
  const downloadResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().includes(`/shares/${shareToken}/items/${fileId}/download?downloadId=`) &&
    response.status() === 200
  );
  await downloadButton.click();
  const downloadResponse = await downloadResponsePromise;
  expect(new URL(downloadResponse.url()).origin).toBe(new URL(page.url()).origin);
  expect(downloadResponse.headers()["content-disposition"]).toContain(fileName);
  expect(state.downloadIntentPurpose).toBe("download");
  expect(state.downloaded).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Admin panel" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.locator(".admin-panel-nav").getByRole("button", { name: "Audit log" }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?scope=all$/);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  const auditRow = page.locator(".drive-audit-table .drive-audit-row").filter({
    hasText:
      /Smoke Admin.*Share downloaded.*Share link.*admin@example.com downloaded File/,
  });
  await expect(auditRow).toBeVisible();
  await expect(auditRow.locator(".drive-audit-actor-avatar")).toBeVisible();
  await expect(auditRow).toContainText("192.168.1.45");
  await expect(page.locator(".drive-audit-table")).not.toContainText(shareToken);
  await expect(page.locator(".drive-audit-table")).not.toContainText(fileName);
  await expect(page.locator(".drive-audit-table")).not.toContainText(fileId);
});

test("smoke: verifies external share access with an email code", async ({ page }) => {
  const state = await mockIcedrApi(page, { authenticated: false });

  await page.goto(`/share/s/${shareToken}`);
  await expect(page.getByText("External share")).toBeVisible();
  await expect(page.locator(".external-share-file-row")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(fileId);

  await page.getByRole("button", { name: "Verify and download" }).click();

  await page.getByRole("textbox", { name: "Enter your email to continue" }).fill("visitor@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("textbox", { name: "Enter the 6-digit code" })).toBeVisible();
  expect(state.emailCodeSentTo).toBe("visitor@example.com");

  await page.getByRole("textbox", { name: "Enter the 6-digit code" }).fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("Email verified visitor verification succeeded")).toBeVisible();
  expect(state.emailVerifiedFor).toBe("visitor@example.com");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(fileName).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" }).last()).toBeVisible();
  expect(state.contentAccessSessionId).toBe("share-session-email");
});

async function mockIcedrApi(
  page: Page,
  options: { authenticated?: boolean } = {},
) {
  const state = {
    contentAccessSessionId: "",
    downloadIntentPurpose: "",
    downloaded: false,
    emailCodeSentTo: "",
    emailVerifiedFor: "",
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
      if (options.authenticated === false) {
        await fulfillJson(route, { message: "Unauthorized" }, 401);
        return;
      }
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
      const accessSessionId = request.headers()["x-share-access-session"] ?? "";
      const hasContentAccess =
        options.authenticated !== false || accessSessionId === "share-session-email";

      if (!hasContentAccess) {
        await fulfillJson(route, lockedRegisteredShare());
        return;
      }

      state.contentAccessSessionId = accessSessionId;
      await fulfillJson(route, unlockedRegisteredShare());
      return;
    }

    if (method === "POST" && path === `/shares/${shareToken}/access-sessions/email-code`) {
      const requestBody = request.postDataJSON() as { email: string };
      state.emailCodeSentTo = requestBody.email;
      await fulfillJson(route, {
        configured: true,
        delivery: "email",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      return;
    }

    if (method === "POST" && path === `/shares/${shareToken}/access-sessions/verify-email`) {
      const requestBody = request.postDataJSON() as { code: string; email: string };
      state.emailVerifiedFor = requestBody.email;
      await fulfillJson(route, {
        availableAt: now,
        downloadLimit: "No download limit",
        email: requestBody.email,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        identityType: "email",
        policyDecision: {
          bypassSpeedLimit: false,
          bypassWait: false,
          downloadLimit: "No download limit",
          identityType: "email",
          maxDownloads: 0,
          remainingDownloads: null,
          requiresAccessSession: true,
          requiresEmailVerification: true,
          speedLimit: null,
          waitSeconds: 0,
        },
        sessionId: "share-session-email",
        shareToken,
        speedLimit: null,
        waitSeconds: 0,
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
        facets: {
          actions: ["share.download_started"],
          actors: ["account"],
        },
        generatedAt: now,
        items,
        limit: Number(url.searchParams.get("limit") ?? items.length),
        offset: Number(url.searchParams.get("offset") ?? 0),
        scope: { kind: "all" },
        summary: { failed: 0, success: items.length },
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
  return {
    availability: "available",
    changes: [],
    createdAt: now,
    hasContent: true,
    id: fileId,
    kind: "doc",
    mimeType: "text/plain",
    name: fileName,
    parentNodeId: null,
    role: "root",
    sizeBytes: 42,
    updatedAt: now,
  };
}

function lockedRegisteredShare() {
  return {
    ...registeredShare(),
    allowedItemIds: [],
    contentSummary: shareContentSummary(),
    dynamicRootId: null,
    rootItemIds: [],
    scopeMode: "items",
    workspaceId: undefined,
  };
}

function unlockedRegisteredShare() {
  return {
    ...registeredShare(),
    contentSummary: shareContentSummary(),
    items: [shareFileNode()],
    scopeMode: "items",
    workspaceId: undefined,
  };
}

function shareContentSummary() {
  return {
    changedCount: 0,
    fileCount: 1,
    folderCount: 0,
    totalSizeBytes: 42,
    unavailableCount: 0,
  };
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
    actorDisplayName: "Smoke Admin",
    actorEmail: "admin@example.com",
    actorUserId: "admin-user",
    createdAt: now,
    id: "audit-download-smoke",
    ipAddress: "192.168.1.45",
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
    resourceType: "share",
    result: "success",
    shareToken,
    target: shareToken,
    workspaceId,
  };
}
