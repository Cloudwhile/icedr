import { getItemKind, type DriveItem } from "@/features/file/model";

export type FolderShareVisibility = "entire-folder" | "selected-items";

export type ShareMemberRole = "root" | "navigation" | "selected" | "descendant";

export type MemberCheckboxState = {
  checked: boolean;
  mixed: boolean;
  covered: boolean;
};

export type ShareMemberTreeNode = {
  item: DriveItem;
  children: ShareMemberTreeNode[];
};

export type ShareMemberScope = {
  mode: FolderShareVisibility;
  rootMemberId: string;
  normalizedSelectedIds: string[];
  visibleMemberIds: string[];
  previewMemberIds: string[];
  navigationAncestorIds: string[];
  selectedMemberIds: string[];
  descendantMemberIds: string[];
  rolesById: Record<string, ShareMemberRole>;
  fileCount: number;
  folderCount: number;
  totalSizeBytes: number;
};

export type BuildShareMemberScopeInput = {
  rootFolder: DriveItem;
  sourceItems: DriveItem[];
  mode: FolderShareVisibility;
  selectedIds?: string[];
};

export type ToggleSelectedMemberIdInput = {
  rootFolder: DriveItem;
  sourceItems: DriveItem[];
  selectedIds: string[];
  itemId: string;
};

type ScopeTreeIndex = {
  byId: Map<string, DriveItem>;
  childrenByParent: Map<string, DriveItem[]>;
  orderedItems: DriveItem[];
  parentById: Map<string, string>;
  rootFolder: DriveItem;
};

const rolePriority: Record<ShareMemberRole, number> = {
  descendant: 0,
  navigation: 1,
  selected: 2,
  root: 3,
};

/**
 * Builds the active tree rooted at `rootFolder`. Source items outside that tree,
 * archived nodes, duplicate IDs, and malformed cycles are deliberately ignored.
 * Sibling order follows `sourceItems`, so selection output stays stable with the UI.
 */
export function buildShareMemberTree(
  rootFolder: DriveItem,
  sourceItems: DriveItem[],
): ShareMemberTreeNode[] {
  const tree = createScopeTreeIndex(rootFolder, sourceItems);

  const buildChildren = (parentId: string): ShareMemberTreeNode[] => {
    return (tree.childrenByParent.get(parentId) ?? []).map((item) => ({
      item,
      children:
        getItemKind(item) === "folder" ? buildChildren(item.id) : [],
    }));
  };

  return buildChildren(rootFolder.id);
}

/**
 * Keeps only active descendants of the shared root and removes an explicit child
 * whenever one of its ancestors is already selected. The root is an anchor and
 * is never submitted as an explicit member selection.
 */
export function normalizeSelectedMemberIds(
  rootFolder: DriveItem,
  sourceItems: DriveItem[],
  selectedIds: string[],
): string[] {
  const tree = createScopeTreeIndex(rootFolder, sourceItems);
  return normalizeSelectedIdsInTree(tree, selectedIds);
}

/**
 * Computes the same virtual member closure the server will persist: root,
 * navigation ancestors, explicit selections, and descendants of selected folders.
 */
export function buildShareMemberScope({
  rootFolder,
  sourceItems,
  mode,
  selectedIds = [],
}: BuildShareMemberScopeInput): ShareMemberScope {
  const tree = createScopeTreeIndex(rootFolder, sourceItems);
  const normalizedSelectedIds =
    mode === "selected-items"
      ? normalizeSelectedIdsInTree(tree, selectedIds)
      : [];
  const roles = new Map<string, ShareMemberRole>([
    [rootFolder.id, "root"],
  ]);

  if (mode === "entire-folder") {
    tree.orderedItems.slice(1).forEach((item) => {
      setMemberRole(roles, item.id, "descendant");
    });
  } else {
    normalizedSelectedIds.forEach((selectedId) => {
      const selectedItem = tree.byId.get(selectedId);
      if (!selectedItem) return;

      getNavigationAncestorIds(selectedId, tree).forEach((ancestorId) => {
        setMemberRole(roles, ancestorId, "navigation");
      });
      setMemberRole(roles, selectedId, "selected");

      if (getItemKind(selectedItem) === "folder") {
        collectDescendantIds(selectedId, tree).forEach((descendantId) => {
          setMemberRole(roles, descendantId, "descendant");
        });
      }
    });
  }

  const visibleItems = tree.orderedItems.filter((item) => roles.has(item.id));
  const visibleMemberIds = visibleItems.map((item) => item.id);
  const navigationAncestorIds = visibleMemberIds.filter(
    (id) => roles.get(id) === "navigation",
  );
  const selectedMemberIds = visibleMemberIds.filter(
    (id) => roles.get(id) === "selected",
  );
  const descendantMemberIds = visibleMemberIds.filter(
    (id) => roles.get(id) === "descendant",
  );
  const rolesById = Object.fromEntries(
    visibleMemberIds.map((id) => [id, roles.get(id)!]),
  ) as Record<string, ShareMemberRole>;
  const summary = summarizeVisibleMembers(visibleItems, rootFolder.id);

  return {
    mode,
    rootMemberId: rootFolder.id,
    normalizedSelectedIds,
    visibleMemberIds,
    previewMemberIds: [...visibleMemberIds],
    navigationAncestorIds,
    selectedMemberIds,
    descendantMemberIds,
    rolesById,
    ...summary,
  };
}

export function getMemberCheckboxState(
  itemId: string,
  scope: ShareMemberScope,
): MemberCheckboxState {
  const role = scope.rolesById[itemId];

  if (role === "root") {
    if (scope.mode === "entire-folder") {
      return { checked: true, mixed: false, covered: false };
    }
    return {
      checked: false,
      mixed: scope.normalizedSelectedIds.length > 0,
      covered: false,
    };
  }

  if (role === "selected") {
    return { checked: true, mixed: false, covered: false };
  }

  if (role === "navigation") {
    return { checked: false, mixed: true, covered: false };
  }

  if (role === "descendant") {
    return {
      checked: true,
      mixed: false,
      covered: scope.mode === "selected-items",
    };
  }

  return { checked: false, mixed: false, covered: false };
}

/**
 * Applies one tree-checkbox action and returns normalized explicit IDs. A member
 * covered by a selected folder is intentionally immutable until that ancestor is
 * cleared, avoiding a misleading exclusion that the server contract cannot express.
 */
export function toggleSelectedMemberId({
  rootFolder,
  sourceItems,
  selectedIds,
  itemId,
}: ToggleSelectedMemberIdInput): string[] {
  const scope = buildShareMemberScope({
    rootFolder,
    sourceItems,
    mode: "selected-items",
    selectedIds,
  });
  const state = getMemberCheckboxState(itemId, scope);

  if (state.covered || itemId === rootFolder.id) {
    return scope.normalizedSelectedIds;
  }

  if (scope.selectedMemberIds.includes(itemId)) {
    return normalizeSelectedMemberIds(
      rootFolder,
      sourceItems,
      scope.normalizedSelectedIds.filter((id) => id !== itemId),
    );
  }

  return normalizeSelectedMemberIds(rootFolder, sourceItems, [
    ...scope.normalizedSelectedIds,
    itemId,
  ]);
}

function createScopeTreeIndex(
  rootFolder: DriveItem,
  sourceItems: DriveItem[],
): ScopeTreeIndex {
  const candidateById = new Map<string, DriveItem>();
  const personalRoot = rootFolder.spaceScope === "personal";

  sourceItems.forEach((item) => {
    if (
      item.id === rootFolder.id ||
      item.archivedAt ||
      candidateById.has(item.id) ||
      (rootFolder.workspaceId !== undefined &&
        item.workspaceId !== rootFolder.workspaceId) ||
      (rootFolder.spaceScope !== undefined &&
        item.spaceScope !== rootFolder.spaceScope) ||
      (personalRoot && item.ownerUserId !== rootFolder.ownerUserId)
    ) {
      return;
    }
    candidateById.set(item.id, item);
  });

  const candidateChildren = new Map<string, DriveItem[]>();
  candidateById.forEach((item) => {
    if (!item.parentId) return;
    const siblings = candidateChildren.get(item.parentId) ?? [];
    siblings.push(item);
    candidateChildren.set(item.parentId, siblings);
  });

  const byId = new Map<string, DriveItem>([[rootFolder.id, rootFolder]]);
  const childrenByParent = new Map<string, DriveItem[]>();
  const orderedItems: DriveItem[] = [rootFolder];
  const parentById = new Map<string, string>();
  const visited = new Set<string>([rootFolder.id]);

  const visitChildren = (parentId: string) => {
    const activeChildren: DriveItem[] = [];

    (candidateChildren.get(parentId) ?? []).forEach((item) => {
      if (visited.has(item.id)) return;
      visited.add(item.id);
      byId.set(item.id, item);
      parentById.set(item.id, parentId);
      orderedItems.push(item);
      activeChildren.push(item);

      if (getItemKind(item) === "folder") {
        visitChildren(item.id);
      }
    });

    childrenByParent.set(parentId, activeChildren);
  };

  visitChildren(rootFolder.id);

  return {
    byId,
    childrenByParent,
    orderedItems,
    parentById,
    rootFolder,
  };
}

function normalizeSelectedIdsInTree(
  tree: ScopeTreeIndex,
  selectedIds: string[],
) {
  const requestedIds = new Set(
    selectedIds.filter(
      (id) => id !== tree.rootFolder.id && tree.byId.has(id),
    ),
  );

  return tree.orderedItems
    .slice(1)
    .filter((item) => requestedIds.has(item.id))
    .filter((item) => {
      let parentId = tree.parentById.get(item.id);

      while (parentId && parentId !== tree.rootFolder.id) {
        if (requestedIds.has(parentId)) return false;
        parentId = tree.parentById.get(parentId);
      }

      return true;
    })
    .map((item) => item.id);
}

function getNavigationAncestorIds(itemId: string, tree: ScopeTreeIndex) {
  const ancestors: string[] = [];
  let parentId = tree.parentById.get(itemId);

  while (parentId && parentId !== tree.rootFolder.id) {
    ancestors.unshift(parentId);
    parentId = tree.parentById.get(parentId);
  }

  return ancestors;
}

function collectDescendantIds(parentId: string, tree: ScopeTreeIndex) {
  const descendantIds: string[] = [];

  const walk = (currentParentId: string) => {
    (tree.childrenByParent.get(currentParentId) ?? []).forEach((item) => {
      descendantIds.push(item.id);
      if (getItemKind(item) === "folder") walk(item.id);
    });
  };

  walk(parentId);
  return descendantIds;
}

function setMemberRole(
  roles: Map<string, ShareMemberRole>,
  itemId: string,
  role: ShareMemberRole,
) {
  const currentRole = roles.get(itemId);
  if (!currentRole || rolePriority[role] > rolePriority[currentRole]) {
    roles.set(itemId, role);
  }
}

function summarizeVisibleMembers(
  visibleItems: DriveItem[],
  rootFolderId: string,
) {
  return visibleItems.reduce(
    (summary, item) => {
      if (item.id === rootFolderId) return summary;

      if (getItemKind(item) === "folder") {
        summary.folderCount += 1;
      } else {
        summary.fileCount += 1;
        summary.totalSizeBytes += Math.max(0, item.sizeBytes ?? 0);
      }
      return summary;
    },
    {
      fileCount: 0,
      folderCount: 0,
      totalSizeBytes: 0,
    },
  );
}
