import { describe, expect, it } from "vitest";
import type { DriveItem } from "@/features/file/model";
import {
  buildShareMemberScope,
  getMemberCheckboxState,
  normalizeSelectedMemberIds,
  toggleSelectedMemberId,
} from "./member-scope";

const now = new Date(0).toISOString();

function createItem(
  input: Partial<DriveItem> & Pick<DriveItem, "id" | "name" | "parentId">,
): DriveItem {
  return {
    archivedAt: null,
    colorKey: "primary",
    createdAt: now,
    hasContent: true,
    kind: "doc",
    mimeType: "text/plain",
    modifiedAt: now,
    owner: "Mina",
    shared: false,
    sizeBytes: 100,
    spaceScope: "workspace",
    starred: false,
    workspaceId: "workspace-default",
    ownerUserId: "user-a",
    ...input,
  };
}

function createFolder(
  id: string,
  parentId: string | null,
  input: Partial<DriveItem> = {},
) {
  return createItem({
    id,
    name: id,
    parentId,
    hasContent: false,
    kind: "folder",
    mimeType: "inode/directory",
    sizeBytes: null,
    ...input,
  });
}

const root = createFolder("root", null);
const privateFile = createItem({
  id: "private-file",
  name: "Private.txt",
  parentId: root.id,
  sizeBytes: 40,
});
const navigationFolder = createFolder("navigation", root.id);
const selectedFile = createItem({
  id: "selected-file",
  name: "Selected.txt",
  parentId: navigationFolder.id,
  sizeBytes: 100,
});
const privateSibling = createItem({
  id: "private-sibling",
  name: "Sibling.txt",
  parentId: navigationFolder.id,
  sizeBytes: 70,
});
const selectedFolder = createFolder("selected-folder", root.id);
const nestedFolder = createFolder("nested-folder", selectedFolder.id);
const nestedFile = createItem({
  id: "nested-file",
  name: "Nested.txt",
  parentId: nestedFolder.id,
  sizeBytes: 200,
});
const archivedFile = createItem({
  id: "archived-file",
  name: "Archived.txt",
  parentId: root.id,
  archivedAt: now,
  sizeBytes: 900,
});
const outsideFile = createItem({
  id: "outside-file",
  name: "Outside.txt",
  parentId: null,
  sizeBytes: 800,
});

const sourceItems = [
  root,
  privateFile,
  navigationFolder,
  selectedFile,
  privateSibling,
  selectedFolder,
  nestedFolder,
  nestedFile,
  archivedFile,
  outsideFile,
];

describe("share member scope", () => {
  it("builds the entire active folder closure without counting the root", () => {
    const scope = buildShareMemberScope({
      rootFolder: root,
      sourceItems,
      mode: "entire-folder",
      selectedIds: [selectedFile.id],
    });

    expect(scope.normalizedSelectedIds).toEqual([]);
    expect(scope.visibleMemberIds).toEqual([
      root.id,
      privateFile.id,
      navigationFolder.id,
      selectedFile.id,
      privateSibling.id,
      selectedFolder.id,
      nestedFolder.id,
      nestedFile.id,
    ]);
    expect(scope.previewMemberIds).toEqual(scope.visibleMemberIds);
    expect(scope.rolesById).toEqual({
      root: "root",
      "private-file": "descendant",
      navigation: "descendant",
      "selected-file": "descendant",
      "private-sibling": "descendant",
      "selected-folder": "descendant",
      "nested-folder": "descendant",
      "nested-file": "descendant",
    });
    expect(scope).toMatchObject({
      fileCount: 4,
      folderCount: 3,
      totalSizeBytes: 410,
    });
    expect(scope.visibleMemberIds).not.toContain(archivedFile.id);
    expect(scope.visibleMemberIds).not.toContain(outsideFile.id);
  });

  it("matches workspace and space while keeping workspace collaborators", () => {
    const collaboratorFile = createItem({
      id: "collaborator-file",
      name: "Collaborator.txt",
      ownerUserId: "user-b",
      parentId: root.id,
    });
    const otherWorkspaceFile = createItem({
      id: "other-workspace-file",
      name: "Other workspace.txt",
      ownerUserId: "user-b",
      parentId: root.id,
      workspaceId: "workspace-other",
    });
    const personalFile = createItem({
      id: "personal-file",
      name: "Personal.txt",
      ownerUserId: "user-a",
      parentId: root.id,
      spaceScope: "personal",
    });
    const missingWorkspaceFile = createItem({
      id: "missing-workspace-file",
      name: "Missing workspace.txt",
      ownerUserId: "user-a",
      parentId: root.id,
      workspaceId: undefined,
    });
    const missingSpaceFile = createItem({
      id: "missing-space-file",
      name: "Missing space.txt",
      ownerUserId: "user-a",
      parentId: root.id,
      spaceScope: undefined,
    });

    const scope = buildShareMemberScope({
      rootFolder: root,
      sourceItems: [
        root,
        collaboratorFile,
        otherWorkspaceFile,
        personalFile,
        missingWorkspaceFile,
        missingSpaceFile,
      ],
      mode: "entire-folder",
    });

    expect(scope.visibleMemberIds).toEqual([root.id, collaboratorFile.id]);
  });

  it("keeps personal folder members within the same owner", () => {
    const personalRoot = createFolder("personal-root", null, {
      ownerUserId: "user-a",
      spaceScope: "personal",
    });
    const ownerFile = createItem({
      id: "owner-file",
      name: "Owner.txt",
      ownerUserId: "user-a",
      parentId: personalRoot.id,
      spaceScope: "personal",
    });
    const otherOwnerFile = createItem({
      id: "other-owner-file",
      name: "Other owner.txt",
      ownerUserId: "user-b",
      parentId: personalRoot.id,
      spaceScope: "personal",
    });

    const scope = buildShareMemberScope({
      rootFolder: personalRoot,
      sourceItems: [personalRoot, ownerFile, otherOwnerFile],
      mode: "entire-folder",
    });

    expect(scope.visibleMemberIds).toEqual([personalRoot.id, ownerFile.id]);
  });

  it("adds only required navigation ancestors for a deeply selected file", () => {
    const scope = buildShareMemberScope({
      rootFolder: root,
      sourceItems,
      mode: "selected-items",
      selectedIds: [selectedFile.id],
    });

    expect(scope.normalizedSelectedIds).toEqual([selectedFile.id]);
    expect(scope.visibleMemberIds).toEqual([
      root.id,
      navigationFolder.id,
      selectedFile.id,
    ]);
    expect(scope.navigationAncestorIds).toEqual([navigationFolder.id]);
    expect(scope.selectedMemberIds).toEqual([selectedFile.id]);
    expect(scope.descendantMemberIds).toEqual([]);
    expect(scope.rolesById).toEqual({
      root: "root",
      navigation: "navigation",
      "selected-file": "selected",
    });
    expect(scope).toMatchObject({
      fileCount: 1,
      folderCount: 1,
      totalSizeBytes: 100,
    });
    expect(scope.previewMemberIds).not.toContain(privateFile.id);
    expect(scope.previewMemberIds).not.toContain(privateSibling.id);
  });

  it("covers the current descendants of an explicitly selected folder", () => {
    const scope = buildShareMemberScope({
      rootFolder: root,
      sourceItems,
      mode: "selected-items",
      selectedIds: [selectedFolder.id],
    });

    expect(scope.normalizedSelectedIds).toEqual([selectedFolder.id]);
    expect(scope.visibleMemberIds).toEqual([
      root.id,
      selectedFolder.id,
      nestedFolder.id,
      nestedFile.id,
    ]);
    expect(scope.selectedMemberIds).toEqual([selectedFolder.id]);
    expect(scope.descendantMemberIds).toEqual([
      nestedFolder.id,
      nestedFile.id,
    ]);
    expect(scope).toMatchObject({
      fileCount: 1,
      folderCount: 2,
      totalSizeBytes: 200,
    });
  });

  it("normalizes duplicates, roots, invalid IDs, and parent-child overlap", () => {
    expect(
      normalizeSelectedMemberIds(root, sourceItems, [
        nestedFile.id,
        selectedFolder.id,
        nestedFile.id,
        root.id,
        archivedFile.id,
        outsideFile.id,
        "missing",
      ]),
    ).toEqual([selectedFolder.id]);
  });

  it("keeps an empty selected-items scope anchored without exposing children", () => {
    const scope = buildShareMemberScope({
      rootFolder: root,
      sourceItems,
      mode: "selected-items",
      selectedIds: [],
    });

    expect(scope.normalizedSelectedIds).toEqual([]);
    expect(scope.visibleMemberIds).toEqual([root.id]);
    expect(scope.previewMemberIds).toEqual([root.id]);
    expect(scope.rolesById).toEqual({ root: "root" });
    expect(scope).toMatchObject({
      fileCount: 0,
      folderCount: 0,
      totalSizeBytes: 0,
    });
  });

  it("reports explicit, mixed, covered, and unchecked checkbox states", () => {
    const selectedFileScope = buildShareMemberScope({
      rootFolder: root,
      sourceItems,
      mode: "selected-items",
      selectedIds: [selectedFile.id],
    });
    const selectedFolderScope = buildShareMemberScope({
      rootFolder: root,
      sourceItems,
      mode: "selected-items",
      selectedIds: [selectedFolder.id],
    });

    expect(getMemberCheckboxState(selectedFile.id, selectedFileScope)).toEqual({
      checked: true,
      mixed: false,
      covered: false,
    });
    expect(
      getMemberCheckboxState(navigationFolder.id, selectedFileScope),
    ).toEqual({
      checked: false,
      mixed: true,
      covered: false,
    });
    expect(getMemberCheckboxState(nestedFile.id, selectedFolderScope)).toEqual({
      checked: true,
      mixed: false,
      covered: true,
    });
    expect(getMemberCheckboxState(privateFile.id, selectedFolderScope)).toEqual({
      checked: false,
      mixed: false,
      covered: false,
    });
  });

  it("selects a mixed folder as one explicit member and preserves covered children", () => {
    expect(
      toggleSelectedMemberId({
        rootFolder: root,
        sourceItems,
        selectedIds: [selectedFile.id],
        itemId: navigationFolder.id,
      }),
    ).toEqual([navigationFolder.id]);

    expect(
      toggleSelectedMemberId({
        rootFolder: root,
        sourceItems,
        selectedIds: [selectedFolder.id],
        itemId: nestedFile.id,
      }),
    ).toEqual([selectedFolder.id]);
  });

  it("removes only the explicitly deselected member", () => {
    expect(
      toggleSelectedMemberId({
        rootFolder: root,
        sourceItems,
        selectedIds: [privateFile.id, selectedFolder.id],
        itemId: privateFile.id,
      }),
    ).toEqual([selectedFolder.id]);
  });
});
