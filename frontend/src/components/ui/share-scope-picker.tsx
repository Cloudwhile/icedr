"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "@/i18n/react";
import { ItemIcon, LocalIcon } from "@/components/ui/app-icon";
import {
  formatFileSize,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import {
  buildShareMemberScope,
  buildShareMemberTree,
  getMemberCheckboxState,
  toggleSelectedMemberId,
  type FolderShareVisibility,
  type ShareMemberScope,
  type ShareMemberTreeNode,
} from "@/features/share/member-scope";
import "@/styles/share-scope-picker.css";

type ScopeSummary = Pick<
  ShareMemberScope,
  "fileCount" | "folderCount" | "totalSizeBytes"
> & {
  formattedSize: string;
};

export type ShareScopePickerLabels = {
  modeLabel: string;
  entireFolder: string;
  selectedItems: string;
  treeLabel: string;
  emptyFolder: string;
  expandFolder: (name: string) => string;
  collapseFolder: (name: string) => string;
  selectItem: (name: string) => string;
  deselectItem: (name: string) => string;
  coveredItem: (name: string) => string;
  summary: (value: ScopeSummary) => string;
};

export type ShareScopePickerProps = {
  rootFolder: DriveItem;
  sourceItems: DriveItem[];
  mode: FolderShareVisibility;
  selectedIds: string[];
  onModeChange: (mode: FolderShareVisibility) => void;
  onSelectedIdsChange: (ids: string[]) => void;
  palette: Palette;
  labels?: Partial<ShareScopePickerLabels>;
  treeAriaDescribedBy?: string;
  treeAriaInvalid?: boolean;
};

const folderVisibilityModes: FolderShareVisibility[] = [
  "entire-folder",
  "selected-items",
];

export function ShareScopePicker({
  rootFolder,
  sourceItems,
  mode,
  selectedIds,
  onModeChange,
  onSelectedIdsChange,
  palette,
  labels,
  treeAriaDescribedBy,
  treeAriaInvalid = false,
}: ShareScopePickerProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const copy = {
    ...getDefaultLabels(t),
    ...labels,
  };
  const modeButtonRefs = useRef<
    Record<FolderShareVisibility, HTMLButtonElement | null>
  >({
    "entire-folder": null,
    "selected-items": null,
  });
  const scope = useMemo(
    () =>
      buildShareMemberScope({
        rootFolder,
        sourceItems,
        mode,
        selectedIds,
      }),
    [mode, rootFolder, selectedIds, sourceItems],
  );
  const nodes = useMemo(
    () => buildShareMemberTree(rootFolder, sourceItems),
    [rootFolder, sourceItems],
  );
  const autoExpandedIds = useMemo(
    () =>
      new Set([
        ...scope.navigationAncestorIds,
        ...scope.selectedMemberIds,
      ]),
    [scope.navigationAncestorIds, scope.selectedMemberIds],
  );
  const [expansionOverrides, setExpansionOverrides] = useState<
    Map<string, boolean>
  >(() => new Map());
  const formattedSize = formatFileSize(scope.totalSizeBytes, locale);
  const pickerStyle = {
    "--share-scope-canvas": palette.canvas,
    "--share-scope-focus": palette.focusRing,
    "--share-scope-hairline": palette.hairline,
    "--share-scope-hairline-strong": palette.hairlineStrong,
    "--share-scope-ink": palette.ink,
    "--share-scope-muted": palette.muted,
    "--share-scope-primary": palette.primary,
    "--share-scope-primary-hover": palette.primaryHover,
    "--share-scope-selected": palette.selected,
    "--share-scope-subtle": palette.subtle,
    "--share-scope-surface-1": palette.surface1,
    "--share-scope-surface-2": palette.surface2,
    "--share-scope-surface-3": palette.surface3,
  } as CSSProperties;

  const setMode = (nextMode: FolderShareVisibility) => {
    if (nextMode !== mode) onModeChange(nextMode);
  };

  const handleModeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentMode: FolderShareVisibility,
  ) => {
    const currentIndex = folderVisibilityModes.indexOf(currentMode);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % folderVisibilityModes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + folderVisibilityModes.length) %
        folderVisibilityModes.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = folderVisibilityModes.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextMode = folderVisibilityModes[nextIndex];
    setMode(nextMode);
    modeButtonRefs.current[nextMode]?.focus();
  };

  const setExpanded = (itemId: string, expanded: boolean) => {
    setExpansionOverrides((current) => {
      const next = new Map(current);
      next.set(itemId, expanded);
      return next;
    });
  };

  const toggleSelection = (itemId: string) => {
    const nextIds = toggleSelectedMemberId({
      rootFolder,
      sourceItems,
      selectedIds,
      itemId,
    });
    onSelectedIdsChange(nextIds);
  };

  return (
    <section className="share-scope-picker" style={pickerStyle}>
      <div
        aria-label={copy.modeLabel}
        aria-orientation="horizontal"
        className="share-scope-picker-modes"
        role="radiogroup"
      >
        <button
          aria-checked={mode === "entire-folder"}
          className="share-scope-picker-mode-button"
          data-active={mode === "entire-folder" ? "true" : undefined}
          onClick={() => setMode("entire-folder")}
          onKeyDown={(event) => handleModeKeyDown(event, "entire-folder")}
          ref={(element) => {
            modeButtonRefs.current["entire-folder"] = element;
          }}
          role="radio"
          tabIndex={mode === "entire-folder" ? 0 : -1}
          type="button"
        >
          <LocalIcon name="folder" size={15} />
          <span>{copy.entireFolder}</span>
        </button>
        <button
          aria-checked={mode === "selected-items"}
          className="share-scope-picker-mode-button"
          data-active={mode === "selected-items" ? "true" : undefined}
          onClick={() => setMode("selected-items")}
          onKeyDown={(event) => handleModeKeyDown(event, "selected-items")}
          ref={(element) => {
            modeButtonRefs.current["selected-items"] = element;
          }}
          role="radio"
          tabIndex={mode === "selected-items" ? 0 : -1}
          type="button"
        >
          <LocalIcon name="tick" size={15} />
          <span>{copy.selectedItems}</span>
        </button>
      </div>

      {mode === "selected-items" ? (
        <div
          aria-describedby={treeAriaDescribedBy}
          aria-invalid={treeAriaInvalid ? true : undefined}
          aria-label={copy.treeLabel}
          className="share-scope-picker-tree"
          role="tree"
        >
          <div
            aria-expanded={nodes.length > 0 ? true : undefined}
            aria-level={1}
            className="share-scope-picker-root-row"
            role="treeitem"
          >
            <span className="share-scope-picker-toggle-placeholder">
              {nodes.length > 0 ? (
                <LocalIcon
                  color={palette.subtle}
                  name="arrow_down"
                  size={13}
                />
              ) : null}
            </span>
            <span className="share-scope-picker-checkbox-placeholder" />
            <ItemIcon item={rootFolder} palette={palette} size={17} />
            <strong className="icedr-truncate" title={rootFolder.name}>
              {rootFolder.name}
            </strong>
          </div>

          {nodes.length > 0 ? (
            <div role="group">
              {nodes.map((node) => (
                <ShareScopeTreeItem
                  key={node.item.id}
                  autoExpandedIds={autoExpandedIds}
                  copy={copy}
                  depth={0}
                  expansionOverrides={expansionOverrides}
                  node={node}
                  onExpansionChange={setExpanded}
                  onToggleSelection={toggleSelection}
                  palette={palette}
                  scope={scope}
                />
              ))}
            </div>
          ) : (
            <p className="share-scope-picker-empty">{copy.emptyFolder}</p>
          )}
        </div>
      ) : (
        <div className="share-scope-picker-root-context">
          <ItemIcon item={rootFolder} palette={palette} size={17} />
          <strong className="icedr-truncate" title={rootFolder.name}>
            {rootFolder.name}
          </strong>
        </div>
      )}

      <p aria-live="polite" className="share-scope-picker-summary">
        {copy.summary({
          fileCount: scope.fileCount,
          folderCount: scope.folderCount,
          totalSizeBytes: scope.totalSizeBytes,
          formattedSize,
        })}
      </p>
    </section>
  );
}

function ShareScopeTreeItem({
  autoExpandedIds,
  copy,
  depth,
  expansionOverrides,
  node,
  onExpansionChange,
  onToggleSelection,
  palette,
  scope,
}: {
  autoExpandedIds: Set<string>;
  copy: ShareScopePickerLabels;
  depth: number;
  expansionOverrides: Map<string, boolean>;
  node: ShareMemberTreeNode;
  onExpansionChange: (itemId: string, expanded: boolean) => void;
  onToggleSelection: (itemId: string) => void;
  palette: Palette;
  scope: ShareMemberScope;
}) {
  const hasChildren = node.children.length > 0;
  const expanded =
    expansionOverrides.get(node.item.id) ??
    autoExpandedIds.has(node.item.id);
  const checkbox = getMemberCheckboxState(node.item.id, scope);
  const ariaChecked = checkbox.mixed ? "mixed" : checkbox.checked;
  const checkboxLabel = checkbox.covered
    ? copy.coveredItem(node.item.name)
    : checkbox.checked
      ? copy.deselectItem(node.item.name)
      : copy.selectItem(node.item.name);

  return (
    <>
      <div
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 2}
        className="share-scope-picker-row"
        data-covered={checkbox.covered ? "true" : undefined}
        role="treeitem"
        style={{ "--share-scope-depth": depth } as CSSProperties}
      >
        {hasChildren ? (
          <button
            aria-label={
              expanded
                ? copy.collapseFolder(node.item.name)
                : copy.expandFolder(node.item.name)
            }
            className="share-scope-picker-toggle"
            onClick={() => onExpansionChange(node.item.id, !expanded)}
            type="button"
          >
            <LocalIcon
              color={palette.subtle}
              name={expanded ? "arrow_down" : "arrow_right"}
              size={13}
            />
          </button>
        ) : (
          <span className="share-scope-picker-toggle-placeholder" />
        )}

        <button
          aria-checked={ariaChecked}
          aria-disabled={checkbox.covered || undefined}
          aria-label={checkboxLabel}
          className="share-scope-picker-checkbox"
          data-checked={checkbox.checked ? "true" : undefined}
          data-covered={checkbox.covered ? "true" : undefined}
          data-mixed={checkbox.mixed ? "true" : undefined}
          onClick={() => {
            if (!checkbox.covered) onToggleSelection(node.item.id);
          }}
          role="checkbox"
          type="button"
        >
          {checkbox.checked ? (
            <LocalIcon name="tick" size={13} />
          ) : checkbox.mixed ? (
            <LocalIcon name="minus" size={13} />
          ) : null}
        </button>

        <ItemIcon item={node.item} palette={palette} size={17} />
        <span className="share-scope-picker-name icedr-truncate" title={node.item.name}>
          {node.item.name}
        </span>
      </div>

      {hasChildren && expanded ? (
        <div role="group">
          {node.children.map((child) => (
            <ShareScopeTreeItem
              key={child.item.id}
              autoExpandedIds={autoExpandedIds}
              copy={copy}
              depth={depth + 1}
              expansionOverrides={expansionOverrides}
              node={child}
              onExpansionChange={onExpansionChange}
              onToggleSelection={onToggleSelection}
              palette={palette}
              scope={scope}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function getDefaultLabels(
  t: ReturnType<typeof useTranslations>,
): ShareScopePickerLabels {
  return {
    modeLabel: t("share.scopePicker.modeLabel"),
    entireFolder: t("share.scopePicker.entireFolder"),
    selectedItems: t("share.scopePicker.selectedItems"),
    treeLabel: t("share.scopePicker.treeLabel"),
    emptyFolder: t("share.scopePicker.emptyFolder"),
    expandFolder: (name) => t("share.scopePicker.expandFolder", { name }),
    collapseFolder: (name) =>
      t("share.scopePicker.collapseFolder", { name }),
    selectItem: (name) => t("share.scopePicker.selectItem", { name }),
    deselectItem: (name) => t("share.scopePicker.deselectItem", { name }),
    coveredItem: (name) => t("share.scopePicker.coveredItem", { name }),
    summary: ({ fileCount, folderCount, formattedSize }) => {
      const files = t(
        fileCount === 1
          ? "share.scopePicker.fileCountOne"
          : "share.scopePicker.fileCountMany",
        { count: fileCount },
      );
      const folders = t(
        folderCount === 1
          ? "share.scopePicker.folderCountOne"
          : "share.scopePicker.folderCountMany",
        { count: folderCount },
      );
      return t("share.scopePicker.summary", {
        files,
        folders,
        size: formattedSize,
      });
    },
  };
}
