import { useState, type FocusEvent } from "react";
import type { DriveItem } from "@/features/file/model";

export function useDriveRovingFocus(visibleItems: DriveItem[]) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const entryId = visibleItems.some((item) => item.id === focusedId) ? focusedId : visibleItems[0]?.id;
  return (itemId: string) => ({
    tabIndex: itemId === entryId ? 0 : -1,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) setFocusedId(itemId);
    },
  });
}
