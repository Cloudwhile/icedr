import type { MouseEvent as ReactMouseEvent } from "react";

const editableSelector =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], button';

export function preventDriveEntryTextSelection(
  event: ReactMouseEvent<HTMLElement>,
) {
  if (
    shouldPreventDriveEntryTextSelection(
      event.detail,
      event.target,
      event.currentTarget,
    )
  ) {
    event.preventDefault();
  }
}

export function shouldPreventDriveEntryTextSelection(
  detail: number,
  target: EventTarget | null,
  currentTarget: EventTarget | null,
) {
  if (detail < 2) return false;
  if (typeof Element === "undefined") return true;
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return true;
  }
  const interactiveTarget = target.closest(editableSelector);
  return !interactiveTarget || interactiveTarget === currentTarget;
}
