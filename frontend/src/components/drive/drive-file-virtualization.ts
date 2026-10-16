import type { DriveItem } from "@/features/file/model";

export const DRIVE_TABLE_HEADER_SIZE = 46;
export const DRIVE_TABLE_ROW_SIZE = 62;
export const DRIVE_GRID_ESTIMATED_ROW_SIZE = 208;
export const DRIVE_GRID_GAP = 12;

export function getRenderedDriveGridColumnCount(itemElement: HTMLElement) {
  return getDriveGridColumnCount(
    itemElement.closest<HTMLElement>(".drive-grid"),
  );
}

export function getDriveGridColumnCount(grid: HTMLElement | null) {
  const template = grid ? getComputedStyle(grid).gridTemplateColumns.trim() : "";
  if (!template || template === "none") return 1;
  const repeatedColumns = /^repeat\(\s*(\d+)\s*,/.exec(template);
  return repeatedColumns
    ? Number(repeatedColumns[1])
    : template.split(/\s+/).length;
}

export function measureDriveGridRowSize(grid: HTMLElement) {
  const card = grid.querySelector<HTMLElement>(".drive-file-card");
  return card
    ? card.getBoundingClientRect().height + DRIVE_GRID_GAP
    : DRIVE_GRID_ESTIMATED_ROW_SIZE;
}

export function focusVirtualDriveItem({
  itemId,
  items,
  scope,
  scrollToIndex,
}: {
  itemId: string;
  items: DriveItem[];
  scope: HTMLElement | null;
  scrollToIndex: (itemIndex: number) => void;
}) {
  const renderedItem = Array.from(
    scope?.querySelectorAll<HTMLElement>("[data-drive-item-id]") ?? [],
  ).find((candidate) => candidate.dataset.driveItemId === itemId);
  if (renderedItem) {
    renderedItem.focus();
    return;
  }
  const itemIndex = items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) return;
  scrollToIndex(itemIndex);
  focusDriveItemWhenRendered(scope, itemId);
}

function focusDriveItemWhenRendered(
  scope: HTMLElement | null,
  itemId: string,
  attempts = 6,
) {
  if (!scope || attempts <= 0) return;
  window.requestAnimationFrame(() => {
    const item = Array.from(
      scope.querySelectorAll<HTMLElement>("[data-drive-item-id]"),
    ).find((candidate) => candidate.dataset.driveItemId === itemId);
    if (item) {
      item.focus();
      return;
    }
    focusDriveItemWhenRendered(scope, itemId, attempts - 1);
  });
}
