import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-07-25T04:00:00.000Z";
const workspaceId = "workspace-scope";
const shareToken = "scope-share";
const rootId = "scope-root";
const publicFileId = "public-a";
const privateFileId = "private-b";
const selectedFolderId = "selected-folder-c";
const emptyFolderId = "empty-folder";
const archivedFileId = "archived-draft";
const missingFileId = "missing-notes";
const rootName = "Scope Folder";
const publicFileName = "Public A.txt";
const privateFileName = "Private B.txt";
const selectedFolderName = "Selected Folder C";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-Share-Access-Session",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
  "Access-Control-Allow-Origin": "*",
};

test("scope: submits only folder selection intent and shows management lifecycle details", async ({
  page,
}, testInfo) => {
  const state = await mockScopeApi(page);
  await useSignedInSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  const folderRow = page
    .locator("tr[data-drive-entry]", { hasText: rootName })
    .first();
  await expect(folderRow).toBeVisible();
  await folderRow.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();

  const dialog = page.getByRole("dialog", { name: "Create external link" });
  await expect(dialog).toBeVisible();
  const entireFolderRadio = dialog.getByRole("radio", {
    name: "Entire folder",
  });
  const selectedItemsRadio = dialog.getByRole("radio", {
    name: "Selected items",
  });
  await expect(entireFolderRadio).toHaveAttribute("tabindex", "0");
  await expect(selectedItemsRadio).toHaveAttribute("tabindex", "-1");
  await entireFolderRadio.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(selectedItemsRadio).toBeFocused();
  await expect(selectedItemsRadio).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Home");
  await expect(entireFolderRadio).toBeFocused();
  await expect(entireFolderRadio).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  await expect(selectedItemsRadio).toBeFocused();
  await expect(selectedItemsRadio).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowUp");
  await expect(entireFolderRadio).toBeFocused();
  await expect(entireFolderRadio).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("End");
  await expect(selectedItemsRadio).toBeFocused();
  await expect(selectedItemsRadio).toHaveAttribute("aria-checked", "true");
  await expect(entireFolderRadio).toHaveAttribute("tabindex", "-1");
  await expect(selectedItemsRadio).toHaveAttribute("tabindex", "0");

  const createButton = dialog.getByRole("button", { name: "Create link" });
  await expect(createButton).toBeDisabled();
  const scopeTree = dialog.getByRole("tree", {
    name: "Select shared content",
  });
  const scopeError = dialog.getByRole("alert");
  await expect(scopeTree).toHaveAttribute("aria-invalid", "true");
  await expect(scopeTree).toHaveAttribute(
    "aria-describedby",
    "drive-share-dialog-scope-error",
  );
  await expect(scopeError).toHaveAttribute(
    "id",
    "drive-share-dialog-scope-error",
  );
  await expect(scopeError).toHaveText("Select at least one item");

  await dialog
    .getByRole("checkbox", { name: `Select ${publicFileName}` })
    .click();
  await expect(scopeTree).not.toHaveAttribute("aria-invalid");
  await expect(scopeTree).not.toHaveAttribute("aria-describedby");
  await expect(scopeError).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: `Select ${selectedFolderName}` })
    .click();
  await expect(createButton).toBeEnabled();
  await expectNoViewportOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("issue27-scope-dialog-desktop.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expectNoViewportOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("issue27-scope-dialog-mobile.png"),
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await createButton.click();
  await expect(page.locator(".drive-share-dialog-created")).toBeVisible();

  expect(state.createBody).toBeTruthy();
  expect(state.createBody?.selection).toEqual({
    folderId: rootId,
    selectedItemIds: [publicFileId, selectedFolderId],
    type: "folder",
    visibility: "selected-items",
  });
  expect(Object.keys(state.createBody ?? {}).sort()).toEqual([
    "allowDownload",
    "allowPreview",
    "expiresDays",
    "policy",
    "remark",
    "selection",
    "workspaceId",
  ]);
  for (const forbidden of [
    "allowedItemIds",
    "contentSummary",
    "dynamicRootId",
    "items",
    "mode",
    "name",
    "owner",
    "path",
    "rootItemIds",
    "title",
    "totalSizeBytes",
  ]) {
    expect(state.createBody).not.toHaveProperty(forbidden);
  }

  await page
    .locator(".drive-share-dialog")
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("button", { name: "Links" }).click();
  const linkRow = page.locator(".drive-link-row", { hasText: rootName });
  await expect(linkRow).toBeVisible();
  await linkRow.getByRole("button", { name: "View details" }).click();

  const details = page.getByRole("complementary", { name: "View details" });
  await expect(details).toBeVisible();
  await expectMetric(details, "Files", "1");
  await expectMetric(details, "Folders", "2");
  await expectMetric(details, "Total size", "20 B");
  await expectMetric(details, "Unavailable items", "2");
  await expect(details).toContainText("Selected contents");
  await expect(details).toContainText("Renamed / Moved");
  await expect(details).toContainText("Archived");
  await expect(details).toContainText("Deleted");
  expect(state.managementRequests).toBeGreaterThanOrEqual(1);
  await expectNoViewportOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("issue27-share-details-desktop.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(details).toBeVisible();
  await expectNoViewportOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("issue27-share-details-mobile.png"),
  });
});

test("scope: public tree excludes private members and remains usable at both viewports", async ({
  page,
}, testInfo) => {
  const state = await mockScopeApi(page, {
    allowPreview: false,
    authenticated: false,
  });
  await useSignedOutSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/share/s/${shareToken}`);
  await expect(page.getByText("External share")).toBeVisible();
  await expect
    .poll(() => state.unauthorizedAuthRequests)
    .toBeGreaterThanOrEqual(1);
  expect(state.publicSharePayloads.length).toBeGreaterThanOrEqual(1);
  for (const payload of state.publicSharePayloads) {
    expect(payload).not.toContain(privateFileId);
    expect(payload).not.toContain(privateFileName);
    expect(payload).not.toContain(workspaceId);
    expect(payload).not.toContain("ownerUserId");
    expect(payload).not.toContain("originalPath");
  }
  await expect(page.locator("body")).not.toContainText(privateFileId);
  await expect(page.locator("body")).not.toContainText(privateFileName);

  const rootRow = page.locator(".external-share-file-row", {
    hasText: rootName,
  });
  const rootNameButton = rootRow.getByRole("button", {
    name: `Enter ${rootName}`,
  });
  await rootNameButton.focus();
  await expect(rootNameButton).toBeFocused();
  await expect
    .poll(() =>
      rootNameButton.evaluate(
        (element) => window.getComputedStyle(element).outlineWidth,
      ),
    )
    .toBe("2px");
  await page.keyboard.press("Enter");
  await expect(page.getByText(publicFileName).first()).toBeVisible();
  await expect(page.getByText(selectedFolderName).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(privateFileName);
  const publicFileRow = page.locator(".external-share-file-row", {
    hasText: publicFileName,
  });
  await expect(
    publicFileRow.getByRole("button", {
      name: "Previews are disabled for this link",
    }),
  ).toBeDisabled();
  await openFolder(page, selectedFolderName);

  await expect(page.getByText("Empty Folder").first()).toBeVisible();
  await expect(page.getByText("Archived draft.txt").first()).toBeVisible();
  await expect(page.getByText("Missing notes.txt").first()).toBeVisible();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await expect(page.getByText("Deleted", { exact: true })).toBeVisible();

  const archivedRow = page.locator(".external-share-file-row", {
    hasText: "Archived draft.txt",
  });
  await expect(
    archivedRow.getByRole("button", {
      name: "Archived",
    }),
  ).toBeDisabled();
  await archivedRow.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await openFolder(page, "Empty Folder");
  await expect(page.locator(".external-share-browser-empty")).toBeVisible();
  await expect(page.locator(".external-share-browser-footer")).toHaveCount(0);
  await expectNoViewportOverflow(page);

  await page.goto(`/share/s/${shareToken}`);
  const footer = page.locator(".external-share-browser-footer");
  await expect(footer).toHaveAccessibleName(`Enter ${rootName}`);
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expectNoViewportOverflow(page);
  await expectNoMajorOverlap(page, ".external-share-topbar", ".external-share-content");
  await page.keyboard.press("Escape");
  await page.mouse.move(1, 1);
  await page.screenshot({
    path: testInfo.outputPath("issue27-share-desktop.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expectNoViewportOverflow(page);
  await expectNoMajorOverlap(page, ".external-share-topbar", ".external-share-content");
  await page.keyboard.press("Escape");
  await page.mouse.move(1, 1);
  await page.screenshot({
    path: testInfo.outputPath("issue27-share-mobile.png"),
  });
  expect(state.unhandledRequests).toEqual([]);
});

type ScopeMockState = {
  createBody: Record<string, unknown> | null;
  managementRequests: number;
  publicSharePayloads: string[];
  shareCreated: boolean;
  unauthorizedAuthRequests: number;
  unhandledRequests: string[];
};

type ScopeMockOptions = {
  allowPreview?: boolean;
  authenticated?: boolean;
};

async function mockScopeApi(page: Page, options: ScopeMockOptions = {}) {
  const state: ScopeMockState = {
    createBody: null,
    managementRequests: 0,
    publicSharePayloads: [],
    shareCreated: false,
    unauthorizedAuthRequests: 0,
    unhandledRequests: [],
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
        state.unauthorizedAuthRequests += 1;
        await fulfillJson(route, { message: "Unauthorized" }, 401);
        return;
      }
      await fulfillJson(route, currentUser());
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
        name: "Scope Workspace",
        rootNodeId: "root",
        updatedAt: now,
      }]);
      return;
    }
    if (method === "GET" && path === "/file-nodes") {
      await fulfillJson(
        route,
        url.searchParams.get("state") === "archived" ? [] : driveNodes(),
      );
      return;
    }
    if (method === "GET" && path === "/shares") {
      await fulfillJson(route, state.shareCreated ? [managementShare()] : []);
      return;
    }
    if (method === "POST" && path === "/shares") {
      state.createBody = request.postDataJSON() as Record<string, unknown>;
      state.shareCreated = true;
      await fulfillJson(route, managementShare());
      return;
    }
    if (method === "GET" && path === `/shares/${shareToken}/management`) {
      state.managementRequests += 1;
      await fulfillJson(route, managementShare());
      return;
    }
    if (method === "GET" && path === `/shares/${shareToken}`) {
      const payload = publicShare(options);
      const serialized = JSON.stringify(payload);
      state.publicSharePayloads.push(serialized);
      await route.fulfill({
        body: serialized,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
      return;
    }
    if (method === "GET" && path === `/workspaces/${workspaceId}/share-settings`) {
      await fulfillJson(route, workspaceShareSettings());
      return;
    }
    if (method === "GET" && path === "/audit/events") {
      await fulfillJson(route, { items: [], limit: 0, offset: 0, total: 0 });
      return;
    }
    if (method === "GET" && path === "/transfers") {
      await fulfillJson(route, []);
      return;
    }
    if (method === "GET" && path === "/storage/usage") {
      await fulfillJson(route, {
        fileCount: 4,
        folderCount: 3,
        quotaBytes: 1024 * 1024,
        updatedAt: now,
        usagePercent: 1,
        usedBytes: 84,
        workspaceId,
      });
      return;
    }

    state.unhandledRequests.push(`${method} ${path}`);
    await route.fulfill({
      body: JSON.stringify({ message: `Unhandled ${method} ${path}` }),
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 404,
    });
  });

  return state;
}

async function useSignedInSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("icedr.auth.token", "scope-token");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
}

async function useSignedOutSession(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("icedr.auth.token");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
}

async function openFolder(page: Page, name: string) {
  const row = page.locator(".external-share-file-row", { hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open" }).click();
}

async function expectMetric(
  details: ReturnType<Page["locator"]>,
  label: string,
  value: string,
) {
  const metric = details.locator(".share-details-metric", { hasText: label });
  await expect(metric).toContainText(value);
}

async function expectNoViewportOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectNoMajorOverlap(page: Page, first: string, second: string) {
  const firstBox = await page.locator(first).boundingBox();
  const secondBox = await page.locator(second).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  if (!firstBox || !secondBox) return;
  const overlapWidth = Math.max(
    0,
    Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) -
      Math.max(firstBox.x, secondBox.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height) -
      Math.max(firstBox.y, secondBox.y),
  );
  expect(overlapWidth * overlapHeight).toBeLessThanOrEqual(1);
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function driveNodes() {
  return [
    fileNode(rootId, rootName, "folder", null, null),
    fileNode(publicFileId, publicFileName, "doc", rootId, 20),
    fileNode(privateFileId, privateFileName, "doc", rootId, 42),
    fileNode(selectedFolderId, selectedFolderName, "folder", rootId, null),
    fileNode(emptyFolderId, "Empty Folder", "folder", selectedFolderId, null),
    fileNode(archivedFileId, "Archived draft.txt", "doc", selectedFolderId, 10),
    fileNode(missingFileId, "Missing notes.txt", "doc", selectedFolderId, 12),
  ];
}

function fileNode(
  id: string,
  name: string,
  kind: "doc" | "folder",
  parentNodeId: string | null,
  sizeBytes: number | null,
) {
  return {
    archivedAt: null,
    createdAt: now,
    hasContent: kind !== "folder",
    id,
    kind,
    mimeType: kind === "folder" ? "inode/directory" : "text/plain",
    name,
    owner: "Scope Owner",
    parentNodeId,
    sizeBytes,
    starred: false,
    updatedAt: now,
    workspaceId,
  };
}

function publicShare(options: ScopeMockOptions = {}) {
  return {
    ...shareBase(),
    allowPreview: options.allowPreview ?? true,
    items: shareItems(),
  };
}

function managementShare() {
  return {
    ...shareBase(),
    items: shareItems(),
    workspaceId,
  };
}

function shareBase() {
  return {
    allowDownload: true,
    allowPreview: true,
    allowedItemIds: [
      rootId,
      publicFileId,
      selectedFolderId,
      emptyFolderId,
      archivedFileId,
      missingFileId,
    ],
    contentSummary: {
      changedCount: 1,
      fileCount: 1,
      folderCount: 2,
      totalSizeBytes: 20,
      unavailableCount: 2,
    },
    createdAt: now,
    dynamicRootId: rootId,
    expiresDays: 7,
    mode: "folder",
    owner: "Scope Owner",
    policy: {
      allowedDomain: "",
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
    rootItemIds: [rootId],
    scopeMode: "selected-items",
    status: "active",
    title: rootName,
    token: shareToken,
    url: `/share/s/${shareToken}`,
  };
}

function shareItems() {
  return [
    shareItem(rootId, rootName, "folder", null, "root", "available", null),
    {
      ...shareItem(publicFileId, publicFileName, "doc", rootId, "selected", "available", 20),
      changes: ["renamed", "moved"],
      snapshotName: "Public original.txt",
    },
    shareItem(selectedFolderId, selectedFolderName, "folder", rootId, "selected", "available", null),
    shareItem(emptyFolderId, "Empty Folder", "folder", selectedFolderId, "descendant", "available", null),
    {
      ...shareItem(archivedFileId, "Archived draft.txt", "doc", selectedFolderId, "descendant", "archived", 10),
      snapshotName: "Draft.txt",
    },
    shareItem(missingFileId, "Missing notes.txt", "doc", selectedFolderId, "descendant", "missing", 12),
  ];
}

function shareItem(
  id: string,
  name: string,
  kind: "doc" | "folder",
  parentNodeId: string | null,
  role: "descendant" | "root" | "selected",
  availability: "archived" | "available" | "missing",
  sizeBytes: number | null,
) {
  return {
    availability,
    changes: [],
    createdAt: now,
    hasContent: kind !== "folder",
    id,
    kind,
    mimeType: kind === "folder" ? "inode/directory" : "text/plain",
    name,
    parentNodeId,
    role,
    sizeBytes,
    updatedAt: now,
  };
}

function currentUser() {
  return {
    avatarUrl: null,
    createdAt: now,
    displayName: "Scope Admin",
    email: "scope@example.com",
    id: "scope-admin",
    locale: "en",
    role: "admin",
    theme: "light",
    timezone: "UTC",
  };
}

function publicSiteSettings() {
  return { authLogoDataUrl: null, siteName: "ICEDR Scope" };
}

function workspaceShareSettings() {
  return {
    allowPermanent: false,
    allowedDomains: [],
    anonymousAccess: "anonymous",
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
    updatedAt: now,
    workspaceId,
  };
}
