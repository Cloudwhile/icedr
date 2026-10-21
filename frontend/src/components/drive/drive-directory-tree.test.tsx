import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { DriveDirectoryTree } from "./drive-directory-tree";

vi.mock("@/i18n/react", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/app-icon", () => ({ LocalIcon: () => <span aria-hidden="true" /> }));

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(0), 16));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => window.clearTimeout(handle));
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("drive-directory-tree") ? 260 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this.classList.contains("drive-directory-tree-list")
      ? 9 - (this.parentElement?.scrollTop ?? 0)
      : 0;
    return { top, bottom: top + 260, left: 0, right: 240, width: 240, height: 260, x: 0, y: top, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.dispatchEvent(new Event("scroll"));
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function folder(id: string, parentId: string | null = null, name = id): DriveItem {
  return { id, parentId, name, kind: "folder", owner: "Owner", modifiedAt: null, sizeBytes: null, shared: false, starred: false, colorKey: "primary" };
}

function treeProps(items: DriveItem[]) {
  return {
    activeNav: "drive" as const, currentFolderId: null as string | null, folderPath: [] as DriveItem[], items,
    onNavigateFolder: vi.fn(), onNavigateRoot: vi.fn(), palette: palettes.light, rootLabel: "Workspace", spaceLabel: "Personal",
  };
}

async function flushVirtualLayout() {
  await act(async () => { await vi.advanceTimersByTimeAsync(32); });
  await act(async () => { await vi.advanceTimersByTimeAsync(32); });
}

describe("DriveDirectoryTree", () => {
  it.each([null, "Folder 0500"])("honors End before the first viewport measurement with active folder %s", async (activeId) => {
    const items = Array.from({ length: 1000 }, (_, index) => folder(`Folder ${String(index).padStart(4, "0")}`));
    const active = items.find((item) => item.id === activeId);
    const { container } = render(<DriveDirectoryTree {...treeProps(items)} currentFolderId={activeId} folderPath={active ? [active] : []} />);
    const root = screen.getByRole("treeitem", { name: "Workspace" });
    act(() => root.focus());
    fireEvent.keyDown(root, { key: "End" });
    await flushVirtualLayout();

    expect(screen.getByRole("treeitem", { name: "Folder 0999" })).toHaveFocus();
    expect(container.querySelector(".drive-directory-tree")!.scrollTop).toBeGreaterThan(30000);
    await flushVirtualLayout();
    expect(screen.getByRole("treeitem", { name: "Folder 0999" })).toHaveFocus();
  });

  it("bounds 1000 root folders to the sidebar viewport and exposes their full sibling positions", async () => {
    const items = Array.from({ length: 1000 }, (_, index) => folder(`Folder ${String(index).padStart(4, "0")}`));
    const { container } = render(<DriveDirectoryTree {...treeProps(items)} />);
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(24);
    await flushVirtualLayout();
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(12);
    expect(screen.queryByRole("treeitem", { name: "Folder 0999" })).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "Folder 0000" })).toHaveAttribute("aria-level", "2");
    expect(screen.getByRole("treeitem", { name: "Folder 0000" })).toHaveAttribute("aria-posinset", "1");
    expect(screen.getByRole("treeitem", { name: "Folder 0000" })).toHaveAttribute("aria-setsize", "1000");
    act(() => container.querySelector<HTMLElement>(".drive-directory-tree")!.scrollTo({ top: 20000 }));
    await flushVirtualLayout();
    expect(screen.queryByRole("treeitem", { name: "Workspace" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  it("retains an initially rendered keyboard target beyond the first measured viewport", async () => {
    const items = Array.from({ length: 1000 }, (_, index) => folder(`Folder ${String(index).padStart(4, "0")}`));
    const { container } = render(<DriveDirectoryTree {...treeProps(items)} />);
    act(() => screen.getByRole("treeitem", { name: "Folder 0016" }).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    await flushVirtualLayout();

    expect(screen.getByRole("treeitem", { name: "Folder 0017" })).toHaveFocus();
    expect(container.querySelector(".drive-directory-tree")!.scrollTop).toBeGreaterThan(0);
  });

  it("moves focus and scrolls in both directions across virtual boundaries", async () => {
    const items = Array.from({ length: 1000 }, (_, index) => folder(`Folder ${String(index).padStart(4, "0")}`));
    const { container } = render(<DriveDirectoryTree {...treeProps(items)} />);
    await flushVirtualLayout();
    const root = screen.getByRole("treeitem", { name: "Workspace" });
    act(() => root.focus());
    for (let index = 0; index < 18; index += 1) {
      fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
      await flushVirtualLayout();
    }
    expect(screen.getByRole("treeitem", { name: "Folder 0017" })).toHaveFocus();
    expect(container.querySelector(".drive-directory-tree")!.scrollTop).toBeGreaterThan(0);

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    await flushVirtualLayout();
    expect(screen.getByRole("treeitem", { name: "Folder 0999" })).toHaveFocus();
    expect(screen.getByRole("treeitem", { name: "Folder 0999" })).toHaveAttribute("aria-posinset", "1000");
    expect(screen.getAllByRole("treeitem").length).toBeLessThanOrEqual(15);

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    await flushVirtualLayout();
    expect(screen.getByRole("treeitem", { name: "Workspace" })).toHaveFocus();
    expect(container.querySelector(".drive-directory-tree")!.scrollTop).toBeLessThanOrEqual(9);
    expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  it("reveals a distant active folder after the virtual viewport is measured", async () => {
    const items = Array.from({ length: 1000 }, (_, index) => folder(`Folder ${String(index).padStart(4, "0")}`));
    const active = items[999];
    const props = { ...treeProps(items), currentFolderId: active.id, folderPath: [active] };
    const { container } = render(<DriveDirectoryTree {...props} />);
    await flushVirtualLayout();
    expect(screen.getByRole("treeitem", { name: active.name })).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector(".drive-directory-tree")!.scrollTop).toBeGreaterThan(30000);
    expect(document.activeElement).toBe(document.body);
  });

  it("expands a changed active path and retains hierarchy, drop targets and navigation", async () => {
    const parent = folder("parent", null, "Parent");
    const child = folder("child", parent.id, "Child");
    const sibling = folder("sibling", parent.id, "Sibling");
    const props = treeProps([parent, child, sibling, { ...folder("archived"), archivedAt: "2026-10-20" }, { ...folder("file"), kind: "doc" }]);
    const { rerender } = render(<DriveDirectoryTree {...props} currentFolderId={parent.id} folderPath={[parent]} />);
    await flushVirtualLayout();
    const parentRow = screen.getByRole("treeitem", { name: "Parent" });
    const childRow = screen.getByRole("treeitem", { name: "Child" });
    expect(childRow).toHaveAttribute("aria-level", "3");
    expect(childRow).toHaveAttribute("aria-posinset", "1");
    expect(childRow).toHaveAttribute("aria-setsize", "2");
    expect(childRow).toHaveStyle({ "--directory-tree-depth": "24px" });
    expect(within(childRow).getByRole("button", { name: "Child" })).toHaveAttribute("data-drive-drop-folder", "child");
    expect(screen.queryByRole("treeitem", { name: "archived" })).not.toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "file" })).not.toBeInTheDocument();

    fireEvent.click(within(parentRow).getByRole("button", { name: "app.close" }));
    expect(screen.queryByRole("treeitem", { name: "Child" })).not.toBeInTheDocument();
    rerender(<DriveDirectoryTree {...props} currentFolderId={child.id} folderPath={[parent, child]} />);
    expect(screen.getByRole("treeitem", { name: "Parent" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "Child" }), { key: "Enter" });
    expect(props.onNavigateFolder).toHaveBeenCalledWith("child");
    fireEvent.keyDown(screen.getByRole("treeitem", { name: "Child" }), { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: "Parent" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: "Parent" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("treeitem", { name: "Parent" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(props.onNavigateRoot).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("data-drive-drop-folder", "");
  });
});
