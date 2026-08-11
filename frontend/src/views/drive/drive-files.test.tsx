import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { FilesModule } from "./drive-files";

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

function KeyboardFilesHarness({ fileItems = items, viewMode }: { fileItems?: DriveItem[]; viewMode: "grid" | "list" }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <FilesModule
      activeNav="drive"
      canPaste={false}
      createMenuItems={[]}
      currentFolderId={null}
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
    />
  );
}
