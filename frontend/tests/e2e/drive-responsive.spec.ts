import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const now = "2026-07-31T08:00:00.000Z";
const workspaceId = "workspace-responsive";
const reportFileName = "Quarterly Report.txt";
const budgetFileName = "Budget Forecast.csv";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
  "Access-Control-Allow-Origin": "*",
};

test.describe("responsive Drive workspace", () => {
  test("keeps the mobile list compact and exposes single- and multi-selection actions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDriveApi(page, {
      activeNodes: [reportFile(), budgetFile(), folderNode("folder-keyboard", "Keyboard Folder", null)],
    });
    await seedAuthenticatedDrive(page);

    await page.goto("/");

    const reportRow = driveItem(page, "file-report");
    await expect(reportRow).toBeVisible();
    await expect(reportRow.getByRole("button", { name: reportFileName, exact: true })).toBeVisible();
    await expect(reportRow.locator(".drive-file-meta-text")).toBeVisible();
    await expect(reportRow.locator(".drive-file-meta-text")).toContainText("Document");
    await expect(reportRow.locator(".drive-file-meta-text")).toContainText("KB");
    await expectNoHorizontalOverflow(page);

    await reportRow.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox", { name: `Select ${reportFileName}` })).toBeChecked();
    const mobileToolbar = page.locator(".drive-mobile-workspace-tools:visible");
    await expect(mobileToolbar.getByRole("status")).toHaveText("1 selected");
    await expectSelectionActions(mobileToolbar);
    await expectSelectionMoreMenu(page, mobileToolbar);

    await page.getByRole("checkbox", { name: `Select ${budgetFileName}` }).click();
    await expect(mobileToolbar.getByRole("status")).toHaveText("2 selected");
    await expectSelectionActions(mobileToolbar);
    await expectSelectionMoreMenu(page, mobileToolbar);

    await mobileToolbar.getByRole("button", { name: "Clear selection" }).click();
    await expect(mobileToolbar.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: `Select ${reportFileName}` })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: `Select ${budgetFileName}` })).not.toBeChecked();

    const folderRow = driveItem(page, "folder-keyboard");
    await folderRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('.drive-empty-state[data-state="folder-empty"]')).toBeVisible();
    await expect(page.locator(".drive-address-bar-compact:visible").getByRole("button", {
      name: "Keyboard Folder",
      exact: true,
    })).toBeVisible();
  });

  test("keeps the compact table and row actions reachable at the 900px boundary", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 768 });
    await mockDriveApi(page, { activeNodes: [reportFile(), budgetFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    const reportRow = driveItem(page, "file-report");
    await expect(reportRow.getByRole("button", { name: reportFileName, exact: true })).toBeVisible();
    await expect(reportRow.locator(".drive-file-meta-text")).toBeVisible();
    await expect(reportRow.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps details visible through desktop-to-tablet resize and restores focus on tablet and mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockDriveApi(page, { activeNodes: [reportFile(), budgetFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    let reportRow = await openDetails(page, "file-report", reportFileName);
    const details = page.getByRole("region", { name: reportFileName });
    await expect(details).toBeVisible();
    await expect(details.locator(".drive-details-heading")).toBeFocused();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(details).toBeVisible();
    await expect(details.locator(".drive-details-heading")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(reportRow).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    reportRow = await openDetails(page, "file-report", reportFileName);
    await expect(page.getByRole("region", { name: reportFileName })).toBeVisible();
    await expect(page.locator(".drive-details-heading")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: reportFileName })).toHaveCount(0);
    await expect(reportRow).toBeFocused();
  });

  test("provides contextual root, folder, search, and trash empty-state actions", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const api = await mockDriveApi(page, { activeNodes: [] });
    await seedAuthenticatedDrive(page);

    await page.goto("/");
    let emptyState = page.locator('.drive-empty-state[data-state="root-empty"]');
    await expect(emptyState).toContainText("This space is empty");
    await expectEmptyStateActions(emptyState, ["New folder", "Upload", "Refresh"]);

    api.activeNodes = [folderNode("folder-empty", "Empty Folder", null)];
    await page.reload();
    await page.getByRole("button", { name: "Empty Folder", exact: true }).click();
    emptyState = page.locator('.drive-empty-state[data-state="folder-empty"]');
    await expect(emptyState).toContainText("This folder is empty");
    await expectEmptyStateActions(emptyState, ["Up one level", "Go home", "New folder", "Upload"]);

    api.activeNodes = [reportFile()];
    api.searchItems = [];
    await page.goto("/");
    await page.getByRole("textbox", { name: "Search files, folders, share links..." }).fill("missing document");
    emptyState = page.locator('.drive-empty-state[data-state="search-empty"]');
    await expect(emptyState).toContainText("No matches");
    await page.keyboard.press("Escape");
    await expectEmptyStateActions(emptyState, ["Clear search", "Refresh"]);
    await emptyState.getByRole("button", { name: "Clear search" }).click();
    await expect(driveItem(page, "file-report")).toBeVisible();

    api.archivedNodes = [];
    await page.goto("/trash");
    emptyState = page.locator('.drive-empty-state[data-state="trash-empty"]');
    await expect(emptyState).toContainText("Trash is empty");
    await expectEmptyStateActions(emptyState, ["Refresh"]);
    await expect(emptyState.getByRole("button", { name: "New folder" })).toHaveCount(0);
    await expect(emptyState.getByRole("button", { name: "Upload" })).toHaveCount(0);

    api.archivedNodes = [archivedFile()];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("checkbox", { name: "Select Archived Notes.txt" }).click();
    const trashToolbar = page.locator(".drive-mobile-workspace-tools:visible");
    await expect(trashToolbar.getByRole("status")).toHaveText("1 selected");
    await trashToolbar.getByRole("button", { name: "More", exact: true }).click();
    const trashMenu = page.getByRole("menu", { name: "More" });
    await expect(trashMenu.getByRole("menuitem", { name: "Restore", exact: true })).toBeVisible();
    await expect(trashMenu.getByRole("menuitem", { name: "Delete permanently", exact: true })).toBeVisible();
  });

  test("collapses a deep mobile breadcrumb into a navigable ancestor menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const directoryNames = [
      "International Product Planning Archive for the 2026 Expansion Program",
      "Regional Operations Compliance Records and Supporting Documentation",
      "Quarterly Research Deliverables with References and Working Materials",
      "Current Collaboration Materials, Decisions, Follow-ups, and Meeting Notes",
    ];
    await mockDriveApi(page, {
      activeNodes: [
        folderNode("level-1", directoryNames[0], null),
        folderNode("level-2", directoryNames[1], "level-1"),
        folderNode("level-3", directoryNames[2], "level-2"),
        folderNode("level-4", directoryNames[3], "level-3"),
      ],
    });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    for (const name of directoryNames) {
      await page.getByRole("button", { name, exact: true }).click();
    }

    const compactBreadcrumb = page.locator(".drive-address-bar-compact:visible");
    await expect(compactBreadcrumb.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
    await expect(compactBreadcrumb.getByRole("button", { name: directoryNames[3], exact: true })).toBeVisible();
    await expect(compactBreadcrumb.getByRole("button", { name: "Directory: More" })).toBeVisible();
    await expect(compactBreadcrumb.getByText(directoryNames[0], { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await compactBreadcrumb.getByRole("button", { name: "Directory: More" }).click();
    const ancestorMenu = page.getByRole("menu", { name: "Directory: More" });
    await expect(ancestorMenu.getByRole("menuitem", { name: directoryNames[0], exact: true })).toBeVisible();
    await expect(ancestorMenu.getByRole("menuitem", { name: directoryNames[1], exact: true })).toBeVisible();
    await expect(ancestorMenu.getByRole("menuitem", { name: directoryNames[2], exact: true })).toBeVisible();
    await ancestorMenu.getByRole("menuitem", { name: directoryNames[1], exact: true }).click();

    await expect(compactBreadcrumb.getByRole("button", { name: directoryNames[1], exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: directoryNames[2], exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("preserves search results through a transient failure and retries the current query", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await mockDriveApi(page, { activeNodes: [budgetFile()], searchItems: [reportFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    const search = page.getByRole("textbox", { name: "Search files, folders, share links..." });
    await search.fill("Quarterly");
    await expect(driveItem(page, "file-report")).toBeVisible();

    api.failNextSearch = true;
    await search.fill("Quarterly Report");

    const errorBanner = page.locator(".drive-error-banner");
    await expect(errorBanner).toBeVisible();
    await expect(driveItem(page, "file-report")).toBeVisible();
    await expect(errorBanner.getByRole("button", { name: "Try again" })).toBeVisible();

    await errorBanner.getByRole("button", { name: "Try again" }).click();
    await expect(errorBanner).toHaveCount(0);
    await expect(driveItem(page, "file-report")).toBeVisible();
  });

  test("keeps the upload HUD, notification, and mobile toolbar from overlapping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDriveApi(page, { activeNodes: [], transfers: [runningTransfer()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    const emptyState = page.locator('.drive-empty-state[data-state="root-empty"]');
    const hud = page.getByRole("button", { name: "Transfers" });
    const toolbar = page.locator(".drive-mobile-workspace-tools:visible");
    await expect(hud).toBeVisible();
    await expect(toolbar).toBeVisible();
    await emptyState.getByRole("button", { name: "Refresh" }).click();

    const notification = page.locator(".workspace-notification:visible");
    await expect(notification).toContainText("Workspace refreshed");
    await expectElementsNotToOverlap([hud, notification, toolbar]);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps newly refreshed share flags when the file list finishes later", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, { activeNodes: [reportFile(), budgetFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");
    await expect(driveItem(page, "file-report")).toBeVisible();

    api.shares = [registeredShare()];
    api.delayNextActiveFileListMs = 150;
    await page.locator(".drive-header").getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator(".workspace-notification:visible")).toContainText("Workspace refreshed");

    await page.getByRole("button", { name: "Shared", exact: true }).click();
    await expect(driveItem(page, "file-report")).toBeVisible();
    await expect(driveItem(page, "file-budget")).toHaveCount(0);
  });

  test("keeps the current list interactive while a duplicate refresh joins the in-flight request", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, { activeNodes: [reportFile(), budgetFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");
    await expect(driveItem(page, "file-report")).toBeVisible();

    const requestsBeforeRefresh = api.activeFileListRequests;
    const refreshButton = page.locator(".drive-header").getByRole("button", { name: "Refresh" });
    api.delayNextActiveFileListMs = 300;
    await refreshButton.dispatchEvent("click");
    await refreshButton.dispatchEvent("click");

    await expect(refreshButton).toBeDisabled();
    await expect(driveItem(page, "file-report")).toBeVisible();
    await expect(driveItem(page, "file-budget")).toBeVisible();
    await expect(page.locator(".workspace-notification:visible")).toContainText("Workspace refreshed");
    expect(api.activeFileListRequests).toBe(requestsBeforeRefresh + 1);
  });

  test("reports an auxiliary refresh failure without replacing it with a success message", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, { activeNodes: [reportFile(), budgetFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");
    await expect(driveItem(page, "file-report")).toBeVisible();

    api.failNextShares = true;
    await page.locator(".drive-header").getByRole("button", { name: "Refresh" }).click();

    const notification = page.locator(".workspace-notification:visible");
    await expect(notification).toContainText("Some workspace content could not be refreshed");
    await expect(notification).toContainText("Share links");
    await expect(notification).not.toContainText("Workspace refreshed");
    const refreshStatus = page.locator(".drive-refresh-status");
    await expect(refreshStatus).toContainText("Some workspace content could not be refreshed");
    await expect(refreshStatus).toContainText("Share links");
    await expect(driveItem(page, "file-report")).toBeVisible();
    await expect(driveItem(page, "file-budget")).toBeVisible();
  });

  test("preserves the last successful file list when refresh fails and keeps Retry reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, { activeNodes: [reportFile(), budgetFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");
    await expect(driveItem(page, "file-report")).toBeVisible();

    api.failNextActiveFileList = true;
    await page.locator(".drive-header").getByRole("button", { name: "Refresh" }).click();

    const errorBanner = page.locator(".drive-error-banner");
    await expect(errorBanner).toBeVisible();
    await expect(driveItem(page, "file-report")).toBeVisible();
    await expect(driveItem(page, "file-budget")).toBeVisible();
    await expect(errorBanner.getByRole("button", { name: "Try again" })).toBeVisible();

    await errorBanner.getByRole("button", { name: "Try again" }).click();
    await expect(errorBanner).toHaveCount(0);
    await expect(driveItem(page, "file-report")).toBeVisible();
  });

  test("confirms extension changes before sending a rename request", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, {
      activeNodes: [fileNode({
        id: "file-extension",
        kind: "doc",
        mimeType: "text/plain",
        name: "report.txt",
        parentNodeId: null,
        sizeBytes: 2048,
      })],
    });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    const row = driveItem(page, "file-extension");
    await row.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: "Rename", exact: true }).click();

    const renameInput = row.getByRole("textbox", { name: "Rename" });
    await renameInput.fill("report.md");
    await renameInput.press("Enter");

    let dialog = page.getByRole("dialog").filter({ hasText: "Changing the extension" });
    await expect(dialog).toContainText("Rename .txt to .md?");
    expect(api.renamePatchRequests).toBe(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.renamePatchRequests).toBe(0);

    await renameInput.press("Enter");
    dialog = page.getByRole("dialog").filter({ hasText: "Changing the extension" });
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();

    await expect.poll(() => api.renamePatchRequests).toBe(1);
    await expect(row.getByRole("button", { name: "report.md", exact: true })).toBeVisible();
  });

  test("does not permanently delete a trash item before confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, { archivedNodes: [archivedFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/trash");

    const row = driveItem(page, "file-archived");
    await row.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menu", { name: "More" })
      .getByRole("menuitem", { name: "Delete permanently", exact: true })
      .click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Delete permanently?" });
    await expect(dialog).toContainText("This action cannot be undone");
    expect(api.permanentDeleteRequests).toBe(0);
    await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();

    await expect.poll(() => api.permanentDeleteRequests).toBe(1);
    await expect(row).toHaveCount(0);
  });

  test("offers Undo after archiving and reports the restored item accurately", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const api = await mockDriveApi(page, { activeNodes: [reportFile()] });
    await seedAuthenticatedDrive(page);
    await page.goto("/");

    const row = driveItem(page, "file-report");
    await row.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menu", { name: "More" })
      .getByRole("menuitem", { name: "Move to trash", exact: true })
      .click();

    await expect.poll(() => api.archivePatchRequests).toBe(1);
    const archiveNotification = page.locator(".workspace-notification").filter({ hasText: "Moved 1 to trash" });
    await expect(archiveNotification).toBeVisible();
    await archiveNotification.getByRole("button", { name: "Undo", exact: true }).click();

    await expect.poll(() => api.restoreRequests).toBe(1);
    await expect(page.locator(".workspace-notification").filter({ hasText: "Restored 1 item" })).toBeVisible();
    await expect(driveItem(page, "file-report")).toBeVisible();
  });
});

async function openDetails(page: Page, itemId: string, itemName: string) {
  const row = driveItem(page, itemId);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: "Details", exact: true }).click();
  await expect(page.getByRole("region", { name: itemName })).toBeVisible();
  return row;
}

function driveItem(page: Page, itemId: string) {
  return page.locator(`[data-drive-item-id="${itemId}"]`);
}

async function expectSelectionActions(toolbar: Locator) {
  for (const name of ["Share", "Download", "More", "Clear selection"]) {
    const button = toolbar.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
  }
}

async function expectSelectionMoreMenu(page: Page, toolbar: Locator) {
  await toolbar.getByRole("button", { name: "More", exact: true }).click();
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu.getByRole("menuitem", { name: "Move", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move to trash", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
}

async function expectEmptyStateActions(emptyState: Locator, labels: string[]) {
  for (const label of labels) {
    await expect(emptyState.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const tableShell = document.querySelector<HTMLElement>(".drive-table-shell");
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      tableClientWidth: tableShell?.clientWidth ?? 0,
      tableScrollWidth: tableShell?.scrollWidth ?? 0,
    };
  });
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth);
  expect(metrics.tableScrollWidth).toBeLessThanOrEqual(metrics.tableClientWidth);
}

async function expectElementsNotToOverlap(elements: Locator[]) {
  const boxes = await Promise.all(elements.map((element) => element.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  for (let index = 0; index < boxes.length; index += 1) {
    for (let next = index + 1; next < boxes.length; next += 1) {
      const first = boxes[index];
      const second = boxes[next];
      if (!first || !second) continue;
      const overlaps =
        first.x < second.x + second.width &&
        first.x + first.width > second.x &&
        first.y < second.y + second.height &&
        first.y + first.height > second.y;
      expect(overlaps).toBe(false);
    }
  }
}

type FileNode = Omit<
  ReturnType<typeof reportFile>,
  "archivedAt" | "archivedBy" | "originalPath"
> & {
  archivedAt: string | null;
  archivedBy: string | null;
  originalPath: string | null;
};
type Transfer = ReturnType<typeof runningTransfer>;
type RegisteredShare = ReturnType<typeof registeredShare>;

type DriveApiState = {
  activeNodes: FileNode[];
  activeFileListRequests: number;
  archivePatchRequests: number;
  archivedNodes: FileNode[];
  delayNextActiveFileListMs: number;
  failNextActiveFileList: boolean;
  failNextShares: boolean;
  failNextSearch: boolean;
  permanentDeleteRequests: number;
  renamePatchRequests: number;
  restoreRequests: number;
  searchItems: FileNode[];
  shares: RegisteredShare[];
  transfers: Transfer[];
};

async function mockDriveApi(
  page: Page,
  options: Partial<Pick<DriveApiState, "activeNodes" | "archivedNodes" | "searchItems" | "transfers">> = {},
) {
  const state: DriveApiState = {
    activeNodes: options.activeNodes ?? [reportFile(), budgetFile()],
    activeFileListRequests: 0,
    archivePatchRequests: 0,
    archivedNodes: options.archivedNodes ?? [],
    delayNextActiveFileListMs: 0,
    failNextActiveFileList: false,
    failNextShares: false,
    failNextSearch: false,
    permanentDeleteRequests: 0,
    renamePatchRequests: 0,
    restoreRequests: 0,
    searchItems: options.searchItems ?? [],
    shares: [],
    transfers: options.transfers ?? [],
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
      await fulfillJson(route, currentUser());
      return;
    }
    if (method === "GET" && path === "/auth/settings") {
      await fulfillJson(route, {
        localEnabled: true,
        minimumAuthenticationMethods: 1,
        oauthConfigured: false,
        oauthEnabled: false,
        passkeyConfigured: false,
        passkeyEnabled: false,
        updatedAt: now,
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
        name: "Responsive Workspace",
        rootNodeId: "root",
        updatedAt: now,
      }]);
      return;
    }
    if (method === "GET" && path === "/file-nodes/search") {
      if (state.failNextSearch) {
        state.failNextSearch = false;
        await fulfillJson(route, { code: "SEARCH_UNAVAILABLE", message: "Temporary search failure" }, 503);
        return;
      }
      await fulfillJson(route, {
        items: state.searchItems.map((item) => ({ ...item, path: `/Workspace/${item.name}` })),
        limit: 100,
        offset: 0,
        total: state.searchItems.length,
      });
      return;
    }
    if (method === "GET" && path === "/file-nodes") {
      const listState = url.searchParams.get("state");
      if (listState === "active") {
        state.activeFileListRequests += 1;
      }
      if (listState === "active" && state.delayNextActiveFileListMs > 0) {
        const delayMs = state.delayNextActiveFileListMs;
        state.delayNextActiveFileListMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (listState === "active" && state.failNextActiveFileList) {
        state.failNextActiveFileList = false;
        await fulfillJson(route, { code: "FILE_LIST_UNAVAILABLE", message: "Temporary file-list failure" }, 503);
        return;
      }
      await fulfillJson(route, listState === "archived" ? state.archivedNodes : state.activeNodes);
      return;
    }
    if (method === "GET" && /^\/file-nodes\/[^/]+\/versions$/.test(path)) {
      await fulfillJson(route, []);
      return;
    }
    if (method === "GET" && path === "/shares") {
      if (state.failNextShares) {
        state.failNextShares = false;
        await fulfillJson(route, { code: "SHARES_UNAVAILABLE", message: "Temporary shares failure" }, 503);
        return;
      }
      await fulfillJson(route, state.shares);
      return;
    }
    if (method === "GET" && path === `/workspaces/${workspaceId}/share-settings`) {
      await fulfillJson(route, workspaceShareSettings());
      return;
    }
    if (method === "GET" && path === "/transfers") {
      await fulfillJson(route, state.transfers);
      return;
    }
    if (method === "GET" && path === "/storage/usage") {
      await fulfillJson(route, storageUsage());
      return;
    }
    if (method === "PATCH" && /^\/file-nodes\/[^/]+\/state$/.test(path)) {
      state.archivePatchRequests += 1;
      const id = decodeURIComponent(path.split("/")[2]);
      const node = state.activeNodes.find((item) => item.id === id);
      if (!node) {
        await fulfillJson(route, { code: "FILE_NOT_FOUND", message: "File not found" }, 404);
        return;
      }
      const archivedNode: FileNode = {
        ...node,
        archivedAt: now,
        archivedBy: "Responsive Admin",
        originalPath: `/${node.name}`,
      };
      state.activeNodes = state.activeNodes.filter((item) => item.id !== id);
      state.archivedNodes = [...state.archivedNodes.filter((item) => item.id !== id), archivedNode];
      await fulfillJson(route, archivedNode);
      return;
    }
    if (method === "PATCH" && /^\/file-nodes\/[^/]+$/.test(path)) {
      state.renamePatchRequests += 1;
      const id = decodeURIComponent(path.split("/")[2]);
      const input = request.postDataJSON() as { name?: string };
      const node = state.activeNodes.find((item) => item.id === id);
      if (!node || !input.name) {
        await fulfillJson(route, { code: "FILE_NOT_FOUND", message: "File not found" }, 404);
        return;
      }
      const renamedNode = { ...node, name: input.name };
      state.activeNodes = state.activeNodes.map((item) => item.id === id ? renamedNode : item);
      await fulfillJson(route, renamedNode);
      return;
    }
    if (method === "DELETE" && /^\/file-nodes\/[^/]+$/.test(path)) {
      state.permanentDeleteRequests += 1;
      const id = decodeURIComponent(path.split("/")[2]);
      state.archivedNodes = state.archivedNodes.filter((item) => item.id !== id);
      await fulfillJson(route, { deleted: 1, id, ok: true });
      return;
    }
    if (method === "POST" && /^\/file-nodes\/[^/]+\/restore$/.test(path)) {
      state.restoreRequests += 1;
      const id = decodeURIComponent(path.split("/")[2]);
      const node = state.archivedNodes.find((item) => item.id === id);
      if (!node) {
        await fulfillJson(route, { code: "FILE_NOT_FOUND", message: "File not found" }, 404);
        return;
      }
      const restoredNode: FileNode = {
        ...node,
        archivedAt: null,
        archivedBy: null,
        originalPath: null,
      };
      state.archivedNodes = state.archivedNodes.filter((item) => item.id !== id);
      state.activeNodes = [...state.activeNodes.filter((item) => item.id !== id), restoredNode];
      await fulfillJson(route, restoredNode);
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

async function seedAuthenticatedDrive(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("icedr.auth.token", "responsive-drive-token");
    window.localStorage.setItem("icedr.locale", "en_US");
    window.localStorage.setItem("icedr.ui.locale", "en");
    window.localStorage.setItem("icedr.ui.themePreference", "light");
  });
}

function reportFile() {
  return fileNode({
    id: "file-report",
    kind: "doc",
    mimeType: "text/plain",
    name: reportFileName,
    parentNodeId: null,
    sizeBytes: 2048,
  });
}

function budgetFile() {
  return fileNode({
    id: "file-budget",
    kind: "sheet",
    mimeType: "text/csv",
    name: budgetFileName,
    parentNodeId: null,
    sizeBytes: 4096,
  });
}

function archivedFile() {
  return {
    ...fileNode({
      id: "file-archived",
      kind: "doc",
      mimeType: "text/plain",
      name: "Archived Notes.txt",
      parentNodeId: null,
      sizeBytes: 1024,
    }),
    archivedAt: now,
    archivedBy: "Responsive Admin",
    originalPath: "/Archived Notes.txt",
  };
}

function folderNode(id: string, name: string, parentNodeId: string | null) {
  return fileNode({ id, kind: "folder", mimeType: "inode/directory", name, parentNodeId, sizeBytes: null });
}

function fileNode(input: {
  id: string;
  kind: "doc" | "folder" | "sheet";
  mimeType: string;
  name: string;
  parentNodeId: string | null;
  sizeBytes: number | null;
}) {
  const isFolder = input.kind === "folder";
  return {
    archivedAt: null,
    archivedBy: null,
    createdAt: now,
    hasContent: !isFolder,
    id: input.id,
    kind: input.kind,
    mimeType: input.mimeType,
    name: input.name,
    originalParentNodeId: null,
    originalPath: null,
    owner: "Responsive Admin",
    ownerUserId: "responsive-admin",
    parentNodeId: input.parentNodeId,
    previewCapability: {
      downloadOnly: false,
      maxPreviewBytes: 5 * 1024 * 1024,
      reason: isFolder ? "folder" : "previewable",
      renderMode: isFolder ? "metadata" : "text",
      sanitized: false,
      supported: !isFolder,
    },
    sizeBytes: input.sizeBytes,
    spaceScope: "workspace" as const,
    starred: false,
    updatedAt: now,
    workspaceId,
  };
}

function runningTransfer() {
  return {
    createdAt: now,
    expiresAt: null,
    failureCode: null,
    hasContent: true,
    id: "transfer-running",
    lifecycle: {
      createdAt: now,
      errorCode: null,
      errorMessage: null,
      expiresAt: null,
      retryable: false,
      status: "running" as const,
      updatedAt: now,
    },
    name: "mobile-upload.bin",
    nodeId: null,
    progress: 42,
    status: "running" as const,
    type: "upload" as const,
    updatedAt: now,
    workspaceId,
  };
}

function registeredShare() {
  return {
    allowDownload: true,
    allowPreview: true,
    allowedItemIds: ["file-report"],
    createdAt: now,
    dynamicRootId: null,
    expiresDays: 7,
    mode: "single-file",
    owner: "Responsive Admin",
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
    rootItemIds: ["file-report"],
    title: reportFileName,
    token: "responsive-share",
    url: "http://127.0.0.1:13000/share/s/responsive-share",
    workspaceId,
  };
}

function currentUser() {
  return {
    avatarUrl: null,
    createdAt: now,
    displayName: "Responsive Admin",
    email: "responsive@example.com",
    id: "responsive-admin",
    locale: "en",
    role: "admin",
    theme: "light",
    timezone: "UTC",
  };
}

function publicSiteSettings() {
  return { authLogoDataUrl: null, siteName: "ICEDR Responsive" };
}

function workspaceShareSettings() {
  return {
    allowPermanent: false,
    allowedDomains: [],
    anonymousAccess: "public",
    audit: { alerts: true, anomaly: true, downloads: true, ip: true, userAgent: true },
    defaultExpiresDays: 7,
    emailRule: "any",
    maxExpiresDays: 30,
    updatedAt: now,
    workspaceId,
  };
}

function storageUsage() {
  return {
    activeBytes: 6144,
    defaultUserQuotaBytes: null,
    fileCount: 2,
    folderCount: 0,
    quotaBytes: 1024 * 1024,
    quotaSource: "workspace",
    spaceScope: "workspace",
    storagePolicyQuotaBytes: null,
    trashBytes: 0,
    trashFileCount: 0,
    updatedAt: now,
    usagePercent: 1,
    usedBytes: 6144,
    versionBytes: 0,
    versionCount: 0,
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
