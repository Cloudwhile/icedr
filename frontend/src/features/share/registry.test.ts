import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "@/features/file/model";
import {
  createRegisteredShare,
  fetchRegisteredShare,
  getShareItems,
  type RegisteredShare,
  type RegisteredShareItem,
} from "./registry";

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

function createDriveItem(
  input: Partial<DriveItem> & Pick<DriveItem, "id" | "name" | "parentId">,
): DriveItem {
  return {
    archivedAt: null,
    colorKey: "primary",
    hasContent: true,
    kind: "doc",
    mimeType: "text/plain",
    modifiedAt: "2026-07-25T00:00:00.000Z",
    owner: "Mina",
    ownerUserId: "user-a",
    shared: true,
    sizeBytes: 120,
    spaceScope: "workspace",
    starred: false,
    workspaceId: "workspace-default",
    ...input,
  };
}

function createShareItem(
  item: DriveItem,
  role: RegisteredShareItem["role"],
): RegisteredShareItem {
  return {
    availability: "available",
    changes: [],
    hasContent: Boolean(item.hasContent),
    id: item.id,
    kind: item.kind ?? "other",
    mimeType: item.mimeType ?? "application/octet-stream",
    name: item.name,
    parentNodeId: item.parentId,
    role,
    sizeBytes: item.sizeBytes,
  };
}

const folderRoot = createDriveItem({
  id: "folder-root",
  name: "Folder root",
  parentId: null,
  hasContent: false,
  kind: "folder",
  mimeType: "inode/directory",
  sizeBytes: null,
});
const visibleFile = createDriveItem({
  id: "visible-file",
  name: "Visible.txt",
  parentId: folderRoot.id,
});
const privateFile = createDriveItem({
  id: "private-file",
  name: "Private.txt",
  parentId: folderRoot.id,
});
const sourceItems = [folderRoot, visibleFile, privateFile];

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
    expect(String(url)).toMatch(/\/shares$/);
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
    expect(String(url)).toMatch(/\/shares\/share-token$/);
    expect(new Headers(init.headers).get("x-share-access-session")).toBe("access-session-1");
  });
});

describe("share registry item scope", () => {
  it("uses response members as the single authoritative allowed set", () => {
    const { allowed, allowedItems } = getShareItems(
      {
        ...selectedFolderShare,
        items: [
          createShareItem(folderRoot, "root"),
          createShareItem(visibleFile, "selected"),
        ],
      },
      sourceItems,
    );

    expect([...allowed]).toEqual([folderRoot.id, visibleFile.id]);
    expect(allowedItems.map((item) => item.id)).toEqual([
      folderRoot.id,
      visibleFile.id,
    ]);
  });

  it("keeps an explicit empty response member list authoritative", () => {
    const { allowed, allowedItems } = getShareItems(
      { ...selectedFolderShare, items: [] },
      sourceItems,
    );

    expect([...allowed]).toEqual([]);
    expect(allowedItems).toEqual([]);
  });
});
