import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { FilesModule, type FilesModuleProps } from "./drive-files";

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en_US",
  useTimeZone: () => "UTC",
  useTranslations: () => (key: string) => key,
}));

afterEach(() => {
  cleanup();
});

const noop = () => undefined;
const items: DriveItem[] = ["report.txt", "notes.txt", "brief.txt"].map((name, index) => ({
  colorKey: "primary",
  hasContent: true,
  id: `file-${index + 1}`,
  kind: "doc",
  mimeType: "text/plain",
  modifiedAt: new Date(index).toISOString(),
  name,
  owner: "Mina",
  parentId: null,
  shared: false,
  sizeBytes: 128,
  starred: false,
}));
const gridItems = [...items, ...items.map((item, index) => ({ ...item, id: `file-${index + 4}`, name: `copy-${item.name}` }))];

describe("FilesModule", () => {
  it.each(["list", "grid"] as const)("keeps the %s Tab entry stable when row controls receive focus", (viewMode) => {
    const { container } = render(<KeyboardFilesHarness viewMode={viewMode} />);
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-drive-item-id]"));

    fireEvent.focus(rows[0]);
    const control = rows[1].querySelector("button")!;
    fireEvent.focus(control);

    expect(rows.map(row => row.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.focus(rows[1]);
    expect(rows.map(row => row.tabIndex)).toEqual([-1, 0, -1]);
  });

  it.each([
    [null, "files.emptyRootTitle"],
    ["folder-empty", "files.emptyFolderTitle"],
  ] as const)("renders a folder empty state at %s without unavailable action buttons", (currentFolderId, title) => {
    const { container } = render(
      <KeyboardFilesHarness currentFolderId={currentFolderId} fileItems={[]} viewMode="grid" />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(title);
    expect(container.querySelector(".drive-empty-state-actions")).not.toBeInTheDocument();
    expect(container.querySelector(".drive-empty-state-icon svg")).toHaveAttribute("width", "44");
  });

  it("leaves multi-selection actions to the workspace toolbar", () => {
    const { container } = render(
      <FilesModule
        activeNav="drive"
        canPaste={false}
        createMenuItems={[]}
        currentFolderId={null}
        error={null}
        goUp={noop}
        hasQuery={false}
        items={items}
        onArchiveItem={noop}
        onBlankGoRoot={noop}
        onBlankGoUp={noop}
        onBlankPaste={noop}
        onBlankRefresh={noop}
        onBlankSelect={noop}
        onCancelRenameItem={noop}
        onCommitRenameItem={() => true}
        onCopyItem={noop}
        onCopyNodeItem={noop}
        onDeletePermanentlyItem={noop}
        onDownloadItem={noop}
        onEditItem={noop}
        onMoveItem={noop}
        onRenameItem={noop}
        onRestoreItem={noop}
        onSecurityItem={noop}
        onSetViewMode={noop}
        onShareItem={noop}
        onShowDetailsItem={noop}
        onSortChange={noop}
        openFolder={noop}
        openPreview={noop}
        palette={palettes.light}
        renamingItemId={null}
        selected={items.map((item) => item.id)}
        sortBy="name"
        sortDirection="asc"
        sourceItems={items}
        toggleSelected={noop}
        toggleStar={noop}
        viewMode="grid"
      />,
    );

    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(container.querySelector(".drive-batch-toolbar")).not.toBeInTheDocument();
  });

  it("extends a contiguous selection with repeated Shift+Arrow presses", () => {
    const { container } = render(<KeyboardFilesHarness viewMode="list" />);
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-drive-item-id]"));

    fireEvent.click(rows[0]);
    rows[0]?.focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(rows[1], { key: "ArrowDown", shiftKey: true });

    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual(["true", "true", "true"]);
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(rows[2], { key: "ArrowUp", shiftKey: true });

    expect(rows.map((row) => row.getAttribute("aria-selected"))).toEqual(["true", "true", "false"]);
    expect(document.activeElement).toBe(rows[1]);
  });

  it("uses the rendered grid column count for vertical range selection", () => {
    render(<KeyboardFilesHarness fileItems={gridItems} viewMode="grid" />);
    const grid = screen.getByRole("listbox", { name: "app.refreshTarget.files" });
    grid.style.gridTemplateColumns = "repeat(3, 188px)";
    const options = screen.getAllByRole("option");

    expect(grid).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(options[0]);
    options[0]?.focus();
    fireEvent.keyDown(options[0], { key: "ArrowDown", shiftKey: true });

    expect(document.activeElement).toBe(options[3]);
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "true", "true", "true", "false", "false"]);

    fireEvent.keyDown(options[3], { key: "ArrowUp", shiftKey: true });

    expect(document.activeElement).toBe(options[0]);
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false", "false"]);
  });

  it.each([
    ["ContextMenu", false],
    ["F10", true],
  ])("opens the focused row menu with %s and preserves Esc hierarchy", (key, shiftKey) => {
    const { container } = render(<KeyboardFilesHarness viewMode="list" />);
    const row = container.querySelector<HTMLElement>('[data-drive-item-id="file-1"]');
    expect(row).not.toBeNull();
    row?.focus();

    fireEvent.keyDown(row!, { key, shiftKey });

    expect(screen.getByRole("menu", { name: "actions.more" })).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "actions.more" })).not.toBeInTheDocument();
    expect(row).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(row!, { key: "Escape" });

    expect(row).toHaveAttribute("aria-selected", "false");
  });
});

describe("FilesModule operation shortcuts", () => {
  it.each(["ctrlKey", "metaKey"] as const)("supports select all, copy, cut and paste with %s", (modifier) => {
    const action = vi.fn();
    const paste = vi.fn();
    const { container } = render(<KeyboardFilesHarness viewMode="list" overrides={{ canPaste: true, onKeyboardAction: action, onBlankPaste: paste }} />);
    const row = container.querySelector<HTMLElement>("[data-drive-item-id]")!;
    row.focus();
    fireEvent.keyDown(row, { key: "a", [modifier]: true });
    expect(container.querySelectorAll('[data-drive-item-id][aria-selected="true"]')).toHaveLength(items.length);
    fireEvent.keyDown(row, { key: "c", [modifier]: true });
    expect(action).toHaveBeenLastCalledWith("copy", items);
    fireEvent.keyDown(row, { key: "x", [modifier]: true });
    expect(action).toHaveBeenLastCalledWith("cut", items);
    fireEvent.keyDown(row, { key: "v", [modifier]: true });
    expect(paste).toHaveBeenCalledOnce();
  });

  it("selects all loaded items even when most virtual rows are not mounted", () => {
    const loadedItems = Array.from({ length: 1000 }, (_, index) => ({ ...items[0], id: `loaded-${index}`, name: `File ${index}` }));
    const action = vi.fn();
    const { container } = render(<KeyboardFilesHarness viewMode="list" fileItems={loadedItems} overrides={{ onKeyboardAction: action }} />);
    expect(container.querySelectorAll("[data-drive-item-id]").length).toBeLessThan(1000);
    const row = container.querySelector<HTMLElement>("[data-drive-item-id]")!;
    fireEvent.keyDown(row, { key: "a", ctrlKey: true });
    fireEvent.keyDown(row, { key: "c", ctrlKey: true });
    expect(action).toHaveBeenCalledWith("copy", loadedItems);
  });

  it.each(["drive", "trash"])("routes Delete through the existing action handler in %s", (activeNav) => {
    const action = vi.fn();
    const { container } = render(<KeyboardFilesHarness viewMode="list" overrides={{ activeNav, onKeyboardAction: action }} />);
    const row = container.querySelector<HTMLElement>("[data-drive-item-id]")!;
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "Delete" });
    expect(action).toHaveBeenCalledWith("delete", [items[0]]);
  });

  it("renames the focused file rather than a different selected file", () => {
    const rename = vi.fn();
    const { container } = render(<KeyboardFilesHarness viewMode="list" overrides={{ onRenameItem: rename }} />);
    const rows = container.querySelectorAll<HTMLElement>("[data-drive-item-id]");
    fireEvent.keyDown(rows[0], { key: " " });
    rows[1].focus();
    fireEvent.keyDown(rows[1], { key: "F2" });
    expect(rename).toHaveBeenCalledWith(items[1]);
  });

  it("does not paste when the clipboard is unavailable or duplicate a pending deletion", () => {
    const action = vi.fn();
    const paste = vi.fn();
    const { container } = render(<KeyboardFilesHarness viewMode="list" overrides={{ canPaste: false, onBlankPaste: paste, onKeyboardAction: action, destructivePending: { archive: false, delete: true, restore: false } }} />);
    const row = container.querySelector<HTMLElement>("[data-drive-item-id]")!;
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "Delete" });
    fireEvent.keyDown(row, { key: "v", ctrlKey: true });
    expect(action).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });

  it("leaves shortcuts inside a rename input and IME composition to the editor", () => {
    const action = vi.fn();
    const paste = vi.fn();
    const rename = vi.fn();
    const { container, rerender } = render(<KeyboardFilesHarness viewMode="list" overrides={{ canPaste: true, onBlankPaste: paste, onKeyboardAction: action, onRenameItem: rename }} />);
    const row = container.querySelector<HTMLElement>("[data-drive-item-id]")!;
    fireEvent.keyDown(row, { key: " ", isComposing: true });
    fireEvent.keyDown(row, { key: "a", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(row, { key: "Delete", isComposing: true });
    fireEvent.keyDown(row, { key: "F2", isComposing: true });
    expect(container.querySelectorAll('[data-drive-item-id][aria-selected="true"]')).toHaveLength(0);
    rerender(<KeyboardFilesHarness viewMode="list" overrides={{ renamingItemId: items[0].id, canPaste: true, onBlankPaste: paste, onKeyboardAction: action, onRenameItem: rename }} />);
    const input = screen.getByRole("textbox");
    for (const key of ["a", "c", "x", "v"]) fireEvent.keyDown(input, { key, ctrlKey: true });
    for (const key of ["Delete", "F2"]) fireEvent.keyDown(input, { key });
    expect(action).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });
});

function KeyboardFilesHarness({
  currentFolderId = null,
  fileItems = items,
  overrides,
  viewMode,
}: {
  currentFolderId?: string | null;
  fileItems?: DriveItem[];
  overrides?: Partial<FilesModuleProps>;
  viewMode: "grid" | "list";
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <FilesModule
      activeNav="drive"
      canPaste={false}
      createMenuItems={[]}
      currentFolderId={currentFolderId}
      error={null}
      goUp={noop}
      hasQuery={false}
      items={fileItems}
      onArchiveItem={noop}
      onBlankGoRoot={noop}
      onBlankGoUp={noop}
      onBlankPaste={noop}
      onBlankRefresh={noop}
      onBlankSelect={() => setSelected([])}
      onCancelRenameItem={noop}
      onCommitRenameItem={() => true}
      onCopyItem={noop}
      onCopyNodeItem={noop}
      onDeletePermanentlyItem={noop}
      onDownloadItem={noop}
      onEditItem={noop}
      onMoveItem={noop}
      onRenameItem={noop}
      onRestoreItem={noop}
      onSecurityItem={noop}
      onSetViewMode={noop}
      onShareItem={noop}
      onShowDetailsItem={noop}
      onSortChange={noop}
      openFolder={noop}
      openPreview={noop}
      palette={palettes.light}
      renamingItemId={null}
      selected={selected}
      sortBy="name"
      sortDirection="asc"
      sourceItems={fileItems}
      toggleSelected={(id, checked) => {
        setSelected((current) => checked
          ? current.includes(id) ? current : [...current, id]
          : current.filter((selectedId) => selectedId !== id));
      }}
      toggleStar={noop}
      viewMode={viewMode}
      {...overrides}
    />
  );
}
