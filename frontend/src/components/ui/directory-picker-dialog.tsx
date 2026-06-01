"use client";

import { useMemo, useState } from "react";
import { AppDialogBody, AppDialogHeader, AppDialogShell, AppDialogTitle } from "./app-dialog-shell";
import { LocalIcon } from "./local-icon";
import { ToolButton } from "./tool-button";
import { getItemKind, type DriveItem, type Palette } from "@/features/file/model";

const buttonTypeAttr: { type?: "button" } = {
  type: "button",
};

type DirectoryNode = {
  children: DirectoryNode[];
  item: DriveItem;
};

export type DirectoryPickerDialogProps = {
  actionLabel: string;
  closeLabel: string;
  currentFolderId: string | null;
  disabledFolderIds?: string[];
  items: DriveItem[];
  onClose: () => void;
  onConfirm: (folderId: string | null) => void;
  open: boolean;
  palette: Palette;
  rootLabel: string;
  title: string;
};

export function DirectoryPickerDialog({
  actionLabel,
  closeLabel,
  currentFolderId,
  disabledFolderIds = [],
  items,
  onClose,
  onConfirm,
  open,
  palette,
  rootLabel,
  title,
}: DirectoryPickerDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentFolderId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const nodes = useMemo(() => buildDirectoryTree(items), [items]);
  const disabledFolderIdSet = useMemo(() => new Set(disabledFolderIds), [disabledFolderIds]);
  const selectedLabel = selectedFolderId ? items.find((item) => item.id === selectedFolderId)?.name ?? rootLabel : rootLabel;

  const toggleFolder = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;

  return (
    <AppDialogShell open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} palette={palette} size="md">
      <AppDialogHeader className="directory-picker-header">
        <div className="directory-picker-title-wrap">
          <AppDialogTitle className="directory-picker-title">{title}</AppDialogTitle>
          <span className="directory-picker-current icedr-truncate">{selectedLabel}</span>
        </div>
        <ToolButton label={closeLabel} palette={palette} onClick={onClose}>
          <LocalIcon name="cross" size={17} />
        </ToolButton>
      </AppDialogHeader>
      <AppDialogBody className="directory-picker-body">
        <div className="directory-picker-tree" role="tree">
          <DirectoryPickerRootRow
            active={selectedFolderId === null}
            expanded
            label={rootLabel}
            onSelect={() => setSelectedFolderId(null)}
            palette={palette}
          />
          <div className="directory-picker-group" role="group">
            {nodes.map((node) => (
              <DirectoryPickerItem
                key={node.item.id}
                depth={1}
                disabledFolderIds={disabledFolderIdSet}
                expandedIds={expandedIds}
                node={node}
                onSelect={setSelectedFolderId}
                onToggle={toggleFolder}
                palette={palette}
                selectedFolderId={selectedFolderId}
              />
            ))}
          </div>
        </div>
        <div className="directory-picker-actions">
          <button {...buttonTypeAttr} className="directory-picker-confirm" onClick={() => onConfirm(selectedFolderId)}>
            <LocalIcon name="tick" size={16} />
            <span className="icedr-truncate">{actionLabel}</span>
          </button>
        </div>
      </AppDialogBody>
    </AppDialogShell>
  );
}

function DirectoryPickerRootRow({
  active,
  expanded,
  label,
  onSelect,
  palette,
}: {
  active: boolean;
  expanded: boolean;
  label: string;
  onSelect: () => void;
  palette: Palette;
}) {
  return (
    <div className="directory-picker-row" data-active={active ? "true" : undefined} role="treeitem" aria-expanded={expanded}>
      <span className="directory-picker-toggle">
        <LocalIcon name="arrow_down" size={13} color={palette.subtle} />
      </span>
      <button {...buttonTypeAttr} className="directory-picker-button" onClick={onSelect}>
        <LocalIcon name="house" size={16} />
        <span className="icedr-truncate">{label}</span>
      </button>
    </div>
  );
}

function DirectoryPickerItem({
  depth,
  disabledFolderIds,
  expandedIds,
  node,
  onSelect,
  onToggle,
  palette,
  selectedFolderId,
}: {
  depth: number;
  disabledFolderIds: Set<string>;
  expandedIds: Set<string>;
  node: DirectoryNode;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  palette: Palette;
  selectedFolderId: string | null;
}) {
  const expanded = expandedIds.has(node.item.id);
  const hasChildren = node.children.length > 0;
  const disabled = disabledFolderIds.has(node.item.id);

  return (
    <>
      <div
        className="directory-picker-row"
        data-active={selectedFolderId === node.item.id ? "true" : undefined}
        data-disabled={disabled ? "true" : undefined}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        style={{ "--directory-picker-depth": depth } as React.CSSProperties}
      >
        {hasChildren ? (
          <button {...buttonTypeAttr} className="directory-picker-toggle" onClick={() => onToggle(node.item.id)}>
            <LocalIcon name={expanded ? "arrow_down" : "arrow_right"} size={13} color={palette.subtle} />
          </button>
        ) : (
          <span className="directory-picker-toggle" />
        )}
        <button {...buttonTypeAttr} className="directory-picker-button" disabled={disabled} onClick={() => onSelect(node.item.id)}>
          <LocalIcon name="folder" size={16} />
          <span className="icedr-truncate">{node.item.name}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <div className="directory-picker-group" role="group">
          {node.children.map((child) => (
            <DirectoryPickerItem
              key={child.item.id}
              depth={depth + 1}
              disabledFolderIds={disabledFolderIds}
              expandedIds={expandedIds}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              palette={palette}
              selectedFolderId={selectedFolderId}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function buildDirectoryTree(items: DriveItem[]) {
  const folders = items
    .filter((item) => getItemKind(item) === "folder" && !item.archivedAt)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  const childrenByParent = new Map<string | null, DriveItem[]>();

  folders.forEach((item) => {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  });

  const buildChildren = (parentId: string | null, ancestors: Set<string>): DirectoryNode[] => {
    return (childrenByParent.get(parentId) ?? [])
      .filter((item) => !ancestors.has(item.id))
      .map((item) => {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(item.id);
        return {
          item,
          children: buildChildren(item.id, nextAncestors),
        };
      });
  };

  return buildChildren(null, new Set());
}
