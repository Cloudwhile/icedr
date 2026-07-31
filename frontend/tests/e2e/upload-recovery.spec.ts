import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";

const now = new Date("2026-07-30T04:00:00.000Z").toISOString();
const workspaceId = "workspace-default";
const ownerUserId = "admin-user";
const sessionId = "upload-session-recovery";
const transferId = "upload-transfer-recovery";
const fileName = "resume-me.txt";
const fileContent = Buffer.from("abcdefgh");
const mimeType = "text/plain";
const chunkSizeBytes = 4;

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
  "Access-Control-Allow-Origin": "*",
};

test("resumes a persisted upload after selecting the original file", async ({ page }) => {
  const state = await mockUploadRecoveryApi(page);
  await seedAuthenticatedRecovery(page);

  await page.goto("/transfers");

  const row = page.locator(".drive-transfer-row").filter({ hasText: fileName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Select the original file to continue");
  await expect(row).toContainText("48%");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await row.getByRole("button", { name: "Resume" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    buffer: fileContent,
    mimeType,
    name: fileName,
  });

  await expect(row).toContainText("100%");
  await expect(row).toContainText("Completed");
  await expect.poll(() => state.uploadedPartIndexes).toEqual([1]);
  expect(state.completed).toBe(true);
  expect(state.intentResumeKey).toBe(createRecoveryDescriptor().resumeIdentity);
  await expect.poll(() => page.evaluate(() =>
    window.sessionStorage.getItem("icedr.upload.recovery.v2"),
  )).toBeNull();
});

test("keeps the recovery action usable without horizontal page overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockUploadRecoveryApi(page);
  await seedAuthenticatedRecovery(page);

  await page.goto("/transfers");

  const row = page.locator(".drive-transfer-row").filter({ hasText: fileName });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Resume" })).toBeVisible();
  const pageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
});

async function seedAuthenticatedRecovery(page: Page) {
  const descriptor = createRecoveryDescriptor();
  await page.addInitScript(({ recovery }) => {
    window.localStorage.setItem("icedr.auth.token", "upload-recovery-token");
    window.localStorage.setItem("icedr.locale", "en_US");
    window.sessionStorage.setItem(
      "icedr.upload.recovery.v2",
      JSON.stringify({ records: [recovery], version: 2 }),
    );
  }, { recovery: descriptor });
}

function createRecoveryDescriptor() {
  const contentFingerprint = createContentFingerprint(fileContent);
  const identityPayload = JSON.stringify({
    contentFingerprint,
    fileName,
    fileSize: fileContent.byteLength,
    mimeType,
    parentNodeId: null,
    spaceScope: "workspace",
    version: 2,
    workspaceId,
  });
  return {
    batchId: "upload-batch-recovery",
    conflictStrategy: "version",
    contentFingerprint,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    failureCode: null,
    fileLastModified: 0,
    fileName,
    fileSize: fileContent.byteLength,
    mimeType,
    ownerUserId,
    parentNodeId: null,
    progress: 47.5,
    resumeIdentity: `drive-upload-v2:${sha256(Buffer.from(identityPayload))}`,
    sessionId,
    spaceScope: "workspace",
    status: "running",
    transferId,
    updatedAt: now,
    uploadedBytes: chunkSizeBytes,
    version: 2,
    workspaceId,
  };
}

function createContentFingerprint(content: Buffer) {
  return `sha256:${sha256(content)}`;
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function mockUploadRecoveryApi(page: Page) {
  const state = {
    completed: false,
    intentResumeKey: "",
    uploadedPartIndexes: [] as number[],
  };
  let sessionStatus: "running" | "paused" = "running";

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
        displayName: "Upload Admin",
        email: "admin@example.com",
        id: ownerUserId,
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
      await fulfillJson(route, [{
        createdAt: now,
        id: workspaceId,
        memberCount: 1,
        name: "Upload Workspace",
        rootNodeId: "root",
        updatedAt: now,
      }]);
      return;
    }
    if (method === "GET" && path === "/file-nodes") {
      await fulfillJson(route, []);
      return;
    }
    if (method === "GET" && path === "/transfers") {
      await fulfillJson(route, []);
      return;
    }
    if (method === "GET" && path === "/storage/usage") {
      await fulfillJson(route, {
        fileCount: state.completed ? 1 : 0,
        folderCount: 0,
        quotaBytes: 1024 * 1024,
        spaceScope: "workspace",
        updatedAt: now,
        usagePercent: 0,
        usedBytes: state.completed ? fileContent.byteLength : 0,
        workspaceId,
      });
      return;
    }
    if (method === "GET" && path === `/file-nodes/upload-sessions/${sessionId}`) {
      await fulfillJson(route, uploadSessionResponse(sessionStatus));
      return;
    }
    if (method === "PATCH" && path === `/transfers/${transferId}`) {
      const body = request.postDataJSON() as { status: "running" | "paused" };
      sessionStatus = body.status;
      await fulfillJson(route, {
        failureCode: null,
        id: transferId,
        lifecycle: lifecycle(sessionStatus),
        progress: 47.5,
        status: sessionStatus,
      });
      return;
    }
    if (method === "POST" && path === "/file-nodes/upload-intents") {
      const body = request.postDataJSON() as { resumeKey?: string };
      state.intentResumeKey = body.resumeKey ?? "";
      sessionStatus = "running";
      await fulfillJson(route, {
        chunkSizeBytes,
        conflictStrategy: "version",
        expiresAt: createRecoveryDescriptor().expiresAt,
        expiresInSeconds: 3600,
        fileName,
        headers: {},
        lifecycle: lifecycle("running"),
        objectKey: "uploads/recovery-object",
        recoveryMode: "upload",
        sessionId,
        status: "running",
        transferId,
        uploadedBytes: chunkSizeBytes,
        uploadedPartIndexes: [0],
        uploadMethod: "chunked",
        uploadUrl: `/file-nodes/upload-sessions/${sessionId}/chunks`,
      });
      return;
    }
    if (
      method === "PUT" &&
      path === `/file-nodes/upload-sessions/${sessionId}/chunks/1`
    ) {
      state.uploadedPartIndexes.push(1);
      await fulfillJson(route, {
        uploadedBytes: fileContent.byteLength,
        uploadedPartIndexes: [0, 1],
      });
      return;
    }
    if (method === "POST" && path === "/file-nodes/upload-completions") {
      state.completed = true;
      await fulfillJson(route, uploadedFileNode());
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

function uploadSessionResponse(status: "running" | "paused") {
  return {
    chunkSizeBytes,
    conflictStrategy: "version",
    expiresAt: createRecoveryDescriptor().expiresAt,
    failureCode: null,
    fileName,
    lifecycle: lifecycle(status),
    mimeType,
    parentNodeId: null,
    progress: 47.5,
    recoveryMode: "upload",
    requestedFileName: fileName,
    sessionId,
    sizeBytes: fileContent.byteLength,
    spaceScope: "workspace",
    status,
    transferId,
    uploadedBytes: chunkSizeBytes,
    uploadedPartIndexes: [0],
    workspaceId,
  };
}

function lifecycle(status: "running" | "paused") {
  return {
    createdAt: now,
    errorCode: null,
    errorMessage: null,
    expiresAt: createRecoveryDescriptor().expiresAt,
    retryable: false,
    status,
    updatedAt: now,
  };
}

function publicSiteSettings() {
  return {
    authLogoDataUrl: null,
    siteName: "ICEDR Upload Recovery",
  };
}

function uploadedFileNode() {
  return {
    archivedAt: null,
    createdAt: now,
    hasContent: true,
    id: "uploaded-file",
    kind: "doc",
    mimeType,
    name: fileName,
    owner: "Upload Admin",
    parentNodeId: null,
    sizeBytes: fileContent.byteLength,
    starred: false,
    updatedAt: now,
    workspaceId,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
