import { getItemKind, type DriveItem } from "@/features/file/model";

export type DriveDirectoryIndex = Map<string | null, DriveItem[]>;

export type DriveDirectoryRow = {
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  id: string | null;
  item: DriveItem | null;
  parentId: string | null;
  position: number;
  siblingCount: number;
};

export function buildDriveDirectoryIndex(items: DriveItem[]): DriveDirectoryIndex {
  const childrenByParent: DriveDirectoryIndex = new Map();
  const folders = items
    .filter((item) => getItemKind(item) === "folder" && !item.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  for (const item of folders) {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  }
  return childrenByParent;
}

export function flattenDriveDirectoryRows(
  index: DriveDirectoryIndex,
  expandedIds: Set<string>,
  rootExpanded: boolean,
): DriveDirectoryRow[] {
  const rootChildren = index.get(null) ?? [];
  const rows: DriveDirectoryRow[] = [{
    depth: 0, expanded: rootExpanded, hasChildren: rootChildren.length > 0,
    id: null, item: null, parentId: null, position: 1, siblingCount: 1,
  }];
  if (!rootExpanded) return rows;

  const pending: DriveDirectoryRow[] = [];
  const visited = new Set<string>();
  const pushChildren = (children: DriveItem[], depth: number) => {
    for (let position = children.length - 1; position >= 0; position -= 1) {
      const item = children[position];
      pending.push({
        depth, expanded: expandedIds.has(item.id), hasChildren: (index.get(item.id)?.length ?? 0) > 0,
        id: item.id, item, parentId: item.parentId, position: position + 1, siblingCount: children.length,
      });
    }
  };
  pushChildren(rootChildren, 1);
  while (pending.length > 0) {
    const row = pending.pop()!;
    if (row.id === null || visited.has(row.id)) continue;
    visited.add(row.id);
    rows.push(row);
    if (row.expanded) pushChildren(index.get(row.id) ?? [], row.depth + 1);
  }
  return rows;
}
