import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegisteredShare, fetchRegisteredShare, type RegisteredShare } from "./registry";

const policy = {
  waitValue: 0,
  waitUnit: "seconds" as const,
  speedValue: 0,
  speedUnit: "KB/s" as const,
  expiresValue: 7,
  expiresUnit: "days" as const,
  downloadLimit: "",
  allowedDomain: "",
};

const selectedFolderShare: RegisteredShare = {
  allowDownload: true,
  allowPreview: true,
  allowedItemIds: ["folder-root", "visible-file", "private-file"],
  createdAt: "2026-07-25T00:00:00.000Z",
  dynamicRootId: "folder-root",
  expiresDays: 7,
  mode: "folder",
  owner: "Mina",
  policy,
  remark: "Review",
  rootItemIds: ["folder-root"],
  selection: {
    type: "folder",
    folderId: "folder-root",
    visibility: "selected-items",
    selectedItemIds: ["visible-file"],
  },
  title: "Private project name",
  token: "",
  workspaceId: "workspace-default",
};

describe("share registry create contract", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only selection intent and policy for the new share contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ...selectedFolderShare,
        allowedItemIds: ["folder-root", "visible-file"],
        contentSummary: {
          fileCount: 1,
          folderCount: 0,
          totalSizeBytes: 120,
          unavailableCount: 0,
          changedCount: 0,
        },
        scopeMode: "selected-items",
        token: "share-token",
        url: "/share/s/share-token",
        revokedAt: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createRegisteredShare(selectedFolderShare);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/shares");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(body).toEqual({
      workspaceId: "workspace-default",
      selection: selectedFolderShare.selection,
      allowDownload: true,
      allowPreview: true,
      expiresDays: 7,
      remark: "Review",
      policy,
    });
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("owner");
    expect(body).not.toHaveProperty("rootItemIds");
    expect(body).not.toHaveProperty("allowedItemIds");
    expect(body).not.toHaveProperty("dynamicRootId");
    expect(JSON.stringify(body)).not.toContain("Private project name");
    expect(JSON.stringify(body)).not.toContain("private-file");
  });

  it("sends the access session when refreshing locked share content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ...selectedFolderShare,
        allowedItemIds: ["folder-root", "visible-file"],
        rootItemIds: ["folder-root"],
        token: "share-token",
        url: "/share/s/share-token",
        revokedAt: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchRegisteredShare("share-token", "access-session-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/shares/share-token");
    expect(new Headers(init.headers).get("x-share-access-session")).toBe("access-session-1");
  });
});
