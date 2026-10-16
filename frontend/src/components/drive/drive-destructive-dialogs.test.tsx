import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { DriveDestructiveDialogs } from "./drive-destructive-dialogs";

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (
    key: string,
    values?: Record<string, string | number>,
  ) => values?.count === undefined ? key : `${key}:${values.count}`,
}));

vi.mock("@/components/ui/confirmation-dialog", () => ({
  ConfirmationDialog: ({
    open,
    supportingContent,
    title,
  }: {
    open: boolean;
    supportingContent?: ReactNode;
    title: string;
  }) => open ? <section aria-label={title}>{supportingContent}</section> : null,
}));

vi.mock("@/components/ui/app-icon", () => ({
  ItemIcon: ({ item }: { item: DriveItem }) => (
    <span data-item-icon={item.id} />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DriveDestructiveDialogs", () => {
  it("lists all five permanent-delete targets with their file icons", () => {
    const items = createItems(5);
    renderDialogs(items);

    items.forEach((item) => {
      expect(screen.getByText(item.name)).toHaveAttribute("title", item.name);
      expect(document.querySelector(`[data-item-icon="${item.id}"]`)).toBeInTheDocument();
    });
  });

  it("shows five targets and exposes the remaining twenty in a disclosure", () => {
    renderDialogs(createItems(25));

    const summary = screen.getByText("files.deleteConfirmMore:20");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(document.querySelectorAll(".drive-delete-confirmation-preview > .drive-delete-confirmation-list > li")).toHaveLength(5);

    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("item-25.txt")).toHaveAttribute("title", "item-25.txt");
  });
});

function renderDialogs(deleteItems: DriveItem[]) {
  render(
    <DriveDestructiveDialogs
      deleteItems={deleteItems}
      deleteOpen
      deletePending={false}
      extensionPending={false}
      extensionPrompt={null}
      onCancelDelete={vi.fn()}
      onCancelExtension={vi.fn()}
      onConfirmDelete={vi.fn()}
      onConfirmExtension={vi.fn()}
      palette={palettes.light}
    />,
  );
}

function createItems(count: number): DriveItem[] {
  return Array.from({ length: count }, (_, index) => ({
    colorKey: "primary",
    id: `item-${index + 1}`,
    modifiedAt: null,
    name: `item-${index + 1}.txt`,
    owner: "owner",
    parentId: null,
    shared: false,
    sizeBytes: 1,
    starred: false,
  }));
}
