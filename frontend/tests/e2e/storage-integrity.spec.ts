import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-08-13T12:00:00.000Z";
const acknowledgedAt = "2026-08-14T01:00:00.000Z";
const workspaceId = "workspace-alpha";
const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS, POST",
  "Access-Control-Allow-Origin": "*",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("icedr.auth.token", "storage-integrity-admin");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
});

test("runs a targeted task, cancels polling, acknowledges a finding, and retries", async ({
  page,
}) => {
  const state = await mockStorageIntegrityApi(page);
  await page.goto("/admin/system/integrity?scope=all");

  await expect(page).toHaveURL(/\/admin\/system\/integrity\?scope=all$/);
  await expect(page.getByRole("heading", { name: "Storage integrity" })).toBeVisible();
  await expect(page.getByTestId("integrity-count-unknown")).toContainText("11");
  await expect(page.getByTestId("integrity-count-verified")).toContainText("37");
  const scope = page.getByLabel("Data scope");
  await expect(scope.locator("option[value='scope:system']")).toHaveCount(0);

  const start = page.getByRole("button", { name: "Start integrity task" });
  await expect(start).toBeDisabled();
  await expect(page.getByLabel("Search target files")).toHaveCount(0);
  await expect(
    page.getByText(
      "Select a workspace scope to target one file or version. Global tasks always scan the selected global scope.",
    ),
  ).toBeVisible();
  await scope.selectOption(`workspace:${workspaceId}`);
  await expect(page).toHaveURL(
    new RegExp(`/admin/system/integrity\\?workspace=${workspaceId}$`),
  );
  await page.getByLabel("Search target files").fill("archive");
  await page.getByRole("button", { name: "Search files" }).click();
  await page.getByRole("button", { name: "archive.bin" }).click();
  await page.getByLabel("Target version").selectOption("version-2");
  await start.click();

  await expect(page).toHaveURL(/task=task-created/);
  await expect.poll(() => state.createdTaskBody).toMatchObject({
    batchSize: 100,
    concurrency: 2,
    maxAttempts: 3,
    mode: "verify",
    scope: "workspace",
    target: { nodeId: "node-1", versionId: "version-2" },
    workspaceId,
  });
  await expect(page.getByText("objects/archive.bin")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry this finding" }),
  ).toHaveCount(0);

  await scope.selectOption("scope:all");
  await expect(page).toHaveURL(/\/admin\/system\/integrity\?scope=all$/);
  await expect(page.getByText("Select a historical task or start a new integrity run.")).toBeVisible();
  const readsAfterScopeChange = state.taskReads.get("task-created") ?? 0;
  await page.waitForTimeout(1_800);
  expect(state.taskReads.get("task-created") ?? 0).toBe(readsAfterScopeChange);

  await page.goto(
    `/admin/system/integrity?workspace=${workspaceId}&task=task-workspace`,
  );
  const objectKey = page.getByText("objects/archive.bin");
  await expect(objectKey).toBeVisible();
  await expect(objectKey).toHaveAttribute("title", "objects/archive.bin");
  await expect(page.getByText("sha256:expected")).toBeVisible();
  await expect(page.getByText("sha256:actual")).toBeVisible();
  await expect(page.getByTestId("integrity-expected-size")).toHaveText("1 KB");
  await expect(page.getByTestId("integrity-actual-size")).toHaveText("2 KB");
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);

  const acknowledge = page.getByRole("button", {
    name: "Acknowledge anomaly and allow automatic cleanup",
  });
  await expect(acknowledge).toBeVisible();
  await acknowledge.click();
  await expect.poll(() => state.acknowledgedResultId).toBe("finding-1");
  await expect(page.getByText("Acknowledged", { exact: true })).toBeVisible();
  await expect(page.locator(".admin-integrity-acknowledged time")).toContainText(
    "Aug 14, 2026",
  );
  await expect(acknowledge).toHaveCount(0);
  await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Retry mismatches and failures" }).click();
  await expect(page).toHaveURL(/task=task-retried/);
  expect(state.retrySourceTaskId).toBe("task-workspace");
});

test("keeps the operational layout separated at desktop and 390px", async ({
  page,
}) => {
  await mockStorageIntegrityApi(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/admin/system/integrity?scope=all&task=task-history");
  await expect(page.getByRole("heading", { name: "Storage integrity" })).toBeVisible();
  const historyTask = page.getByRole("button", {
    name: "Open task task-history",
  });
  await expect(historyTask).toHaveAccessibleDescription("Completed 10 / 10");
  await expect(
    historyTask.locator(".admin-integrity-history-icon"),
  ).toHaveAttribute("data-status", "mismatch");
  await expectNoOverlap(
    page,
    ".admin-integrity-commandbar > div",
    ".admin-integrity-commandbar .icedr-tool-button",
  );
  await expect(page.locator(".admin-integrity-zone .admin-integrity-zone")).toHaveCount(0);

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole("heading", { name: "Storage integrity" })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expectNoOverlap(
    page,
    ".admin-integrity-zone-heading-actions > div",
    ".admin-integrity-zone-heading-actions .icedr-tool-button",
  );
  await expect(page.getByLabel("Integrity task progress")).toBeVisible();
});

async function expectNoOverlap(page: Page, left: string, right: string) {
  const boxes = await page.evaluate(
    ([leftSelector, rightSelector]) => {
      const leftElement = document.querySelector(leftSelector);
      const rightElement = document.querySelector(rightSelector);
      if (!leftElement || !rightElement) return null;
      const a = leftElement.getBoundingClientRect();
      const b = rightElement.getBoundingClientRect();
      return { a: { bottom: a.bottom, left: a.left, right: a.right, top: a.top }, b: { bottom: b.bottom, left: b.left, right: b.right, top: b.top } };
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

async function mockStorageIntegrityApi(page: Page) {
  const state = {
    acknowledgedResultId: null as string | null,
    createdTaskBody: null as Record<string, unknown> | null,
    findingAcknowledged: false,
    findingTaskId: null as string | null,
    retrySourceTaskId: null as string | null,
    taskReads: new Map<string, number>(),
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ headers: corsHeaders, status: 204 });
    if (method === "GET" && path === "/setup/status") {
      return json(route, { bootstrapCompleted: true, databaseAvailable: true, needsSetup: false });
    }
    if (method === "GET" && path === "/auth/me") return json(route, adminUser());
    if (method === "GET" && path === "/site/settings/public") {
      return json(route, { authLogoDataUrl: null, siteName: "ICEDR" });
    }
    if (method === "GET" && path === "/site/settings/public/translations") {
      return json(route, { bundles: [] });
    }
    if (method === "GET" && path === "/workspaces") {
      return json(route, [workspace()]);
    }
    if (method === "GET" && path === "/admin/storage-integrity/summary") {
      return json(route, {
        counts: { failed: 2, mismatch: 3, pending: 5, unknown: 11, verified: 37 },
        generatedAt: now,
        lastVerifiedAt: now,
        scope:
          url.searchParams.get("scope") === "workspace"
            ? {
                kind: "workspace",
                workspaceId: url.searchParams.get("workspaceId") ?? workspaceId,
              }
            : { kind: "all" },
      });
    }
    if (method === "GET" && path === "/admin/storage-integrity/tasks") {
      return json(route, {
        items: [task("task-history", "completed", url.searchParams.get("scope") === "workspace")],
        limit: Number(url.searchParams.get("limit") ?? 20),
        offset: Number(url.searchParams.get("offset") ?? 0),
        total: 1,
      });
    }
    if (method === "POST" && path === "/admin/storage-integrity/tasks") {
      state.createdTaskBody = request.postDataJSON() as Record<string, unknown>;
      return json(route, task("task-created", "running", true));
    }
    const taskMatch = path.match(/^\/admin\/storage-integrity\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      const id = decodeURIComponent(taskMatch[1]);
      state.taskReads.set(id, (state.taskReads.get(id) ?? 0) + 1);
      return json(
        route,
        task(
          id,
          id === "task-created" ? "running" : "completed",
          id === "task-created" || id === "task-workspace",
        ),
      );
    }
    const resultsMatch = path.match(/^\/admin\/storage-integrity\/tasks\/([^/]+)\/results$/);
    if (method === "GET" && resultsMatch) {
      const id = decodeURIComponent(resultsMatch[1]);
      state.findingTaskId = id;
      return json(route, {
        items:
          id === "task-retried"
            ? []
            : [finding(id, state.findingAcknowledged)],
        limit: 25,
        offset: 0,
        total: id === "task-retried" ? 0 : 1,
      });
    }
    if (
      method === "POST" &&
      path === "/admin/storage-integrity/results/finding-1/acknowledge"
    ) {
      state.acknowledgedResultId = "finding-1";
      state.findingAcknowledged = true;
      return json(route, finding(state.findingTaskId ?? "task-workspace", true));
    }
    const retryMatch = path.match(/^\/admin\/storage-integrity\/tasks\/([^/]+)\/retry$/);
    if (method === "POST" && retryMatch) {
      state.retrySourceTaskId = decodeURIComponent(retryMatch[1]);
      return json(route, task("task-retried", "queued", true));
    }
    if (method === "GET" && path === "/admin/storage-integrity/targets") {
      return json(route, { items: [fileNode()], limit: 20, offset: 0, total: 1 });
    }
    if (method === "GET" && path === "/admin/storage-integrity/targets/node-1/versions") {
      return json(route, [fileVersion()]);
    }
    return json(route, { message: `Unhandled ${method} ${path}` }, 404);
  });
  return state;
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function task(
  id: string,
  status: "queued" | "running" | "completed",
  workspace = false,
) {
  const terminal = status === "completed";
  return {
    config: { bandwidthLimitBytesPerSecond: null, batchSize: 100, concurrency: 2, maxAttempts: 3 },
    createdAt: now,
    failureCode: null,
    failureMessage: null,
    finishedAt: terminal ? now : null,
    id,
    mode: "verify",
    progress: { bytesRead: 2_048, failed: 0, matched: 8, mismatches: 2, processed: 10, total: 10 },
    scope: workspace ? "workspace" : "all",
    startedAt: now,
    status,
    target: null,
    workspaceId: workspace ? workspaceId : null,
  };
}

function finding(taskId: string, acknowledged = false) {
  return {
    acknowledgedAt: acknowledged ? acknowledgedAt : null,
    acknowledgedBy: acknowledged ? "admin-user" : null,
    actualHash: "sha256:actual",
    actualSizeBytes: 2_048,
    attempts: 2,
    checkedAt: now,
    errorCode: null,
    errorMessage: null,
    expectedHash: "sha256:expected",
    expectedSizeBytes: 1_024,
    id: "finding-1",
    nodeId: "node-1",
    objectKey: "objects/archive.bin",
    status: "mismatch",
    taskId,
    versionId: "version-2",
    workspaceId,
  };
}

function fileNode() {
  return {
    archivedAt: null,
    archivedBy: null,
    createdAt: now,
    hasContent: true,
    id: "node-1",
    integrityStatus: "unknown",
    kind: "other",
    lastVerifiedAt: null,
    mimeType: "application/octet-stream",
    name: "archive.bin",
    originalParentNodeId: null,
    originalPath: null,
    owner: "Operator",
    ownerUserId: "admin-user",
    parentNodeId: null,
    path: "/archive.bin",
    previewCapability: { downloadOnly: true, maxPreviewBytes: null, reason: "unknown-type", renderMode: "download-only", sanitized: false, supported: false },
    sizeBytes: 2_048,
    spaceScope: "workspace",
    starred: false,
    updatedAt: now,
    workspaceId,
  };
}

function fileVersion() {
  return { createdAt: now, id: "version-2", integrityStatus: "unknown", lastVerifiedAt: null, mimeType: "application/octet-stream", nodeId: "node-1", remark: "release", sizeBytes: 2_048, uploadedBy: "admin-user", versionNumber: 2 };
}

function adminUser() {
  return { avatarUrl: null, createdAt: now, displayName: "Integrity Admin", email: "admin@example.com", id: "admin-user", locale: "en", role: "admin", theme: "light", timezone: "UTC" };
}

function workspace() {
  return { createdAt: now, id: workspaceId, memberCount: 3, name: "Alpha", rootNodeId: "root-alpha", updatedAt: now };
}
