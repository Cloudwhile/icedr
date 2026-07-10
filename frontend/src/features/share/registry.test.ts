import { describe, expect, it } from "vitest";
import type { DriveItem } from "@/features/file/model";
import {
  collectShareDescendants,
  getRegisteredShareParent,
  getVisibleRegisteredShareItems,
  type RegisteredShare,
} from "./registry";

const now = new Date(0).toISOString();

function createItem(input: Partial<DriveItem> & Pick<DriveItem, "id" | "name" | "parentId">): DriveItem {
  return {
    archivedAt: null,
    colorKey: "primary",
    createdAt: now,
    hasContent: true,
    mimeType: "text/plain",
    modifiedAt: now,
    owner: "Mina",
    shared: false,
    sizeBytes: 128,
    starred: false,
    workspaceId: "workspace-default",
    ...input,
  };
}

function createShare(input: Partial<RegisteredShare> = {}): RegisteredShare {
  return {
    allowDownload: true,
    allowPreview: true,
    allowedItemIds: ["folder-product", "roadmap", "brief"],
    createdAt: now,
    dynamicRootId: "folder-product",
    expiresDays: 7,
    mode: "folder",
    owner: "Mina",
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
    rootItemIds: ["folder-product"],
    title: "Product",
    token: "s_product",
    workspaceId: "workspace-default",
    ...input,
  };
}

describe("share registry helpers", () => {
  const items = [
    createItem({
      id: "folder-product",
      mimeType: "inode/directory",
      name: "Product",
      hasContent: false,
      parentId: null,
      sizeBytes: null,
    }),
    createItem({ id: "roadmap", name: "Roadmap.txt", parentId: "folder-product" }),
    createItem({ id: "brief", name: "Brief.txt", parentId: "folder-product" }),
    createItem({ id: "private-note", name: "Private.txt", parentId: "folder-product" }),
  ];

  it("collects descendants when a folder is shared", () => {
    const descendants = collectShareDescendants(items[0], items);

    expect(descendants.map((item) => item.id)).toEqual([
      "roadmap",
      "brief",
      "private-note",
    ]);
  });

  it("only exposes allowed items inside a dynamic share folder", () => {
    const visibleItems = getVisibleRegisteredShareItems(
      createShare(),
      "folder-product",
      items,
    );

    expect(visibleItems.map((item) => item.id)).toEqual(["roadmap", "brief"]);
  });

  it("stops parent navigation at the dynamic root", () => {
    const share = createShare();

    expect(getRegisteredShareParent(share, "folder-product", items)).toBeNull();
    expect(getRegisteredShareParent(share, "roadmap", items)).toBeNull();
  });
});
