import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "./model";
import { downloadSharedDriveItem } from "./download-actions";

const item: DriveItem = {
  id: "file-1",
  name: "report.txt",
  kind: "doc",
  parentId: null,
  owner: "Mina",
  modifiedAt: "2026-07-18T00:00:00.000Z",
  mimeType: "text/plain",
  hasContent: true,
  sizeBytes: 128,
  shared: true,
  starred: false,
  colorKey: "primary",
};

describe("download action lifecycle contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens a newly created shared download intent while it is pending", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      availableAt: "2026-07-18T00:00:00.000Z",
      downloadId: "download-1",
      downloadUrl: "/api/shares/share-token/items/file-1/download?downloadId=download-1",
      expiresAt: "2099-07-18T01:00:00.000Z",
      filename: "report.txt",
      lifecycle: {
        status: "pending",
        errorCode: null,
        errorMessage: null,
        retryable: false,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
        expiresAt: "2099-07-18T01:00:00.000Z",
      },
      method: "stream",
      purpose: "download",
    }));
    vi.stubGlobal("fetch", fetchMock);
    let openedUrl = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      openedUrl = this.href;
    });

    await downloadSharedDriveItem("share-token", item, "share-session-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/shares/share-token/items/file-1/download-intents"),
      expect.objectContaining({
        body: JSON.stringify({ purpose: "download" }),
        headers: expect.objectContaining({
          "X-Share-Access-Session": "share-session-1",
        }),
        method: "POST",
      }),
    );
    expect(openedUrl).toContain(
      "/api/shares/share-token/items/file-1/download?downloadId=download-1",
    );
  });
});
