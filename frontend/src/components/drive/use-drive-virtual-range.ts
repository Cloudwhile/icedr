import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
} from "react";

const VIRTUALIZATION_THRESHOLD = 80;
const DEFAULT_OVERSCAN_ROWS = 3;

type DriveVirtualRange = {
  columnCount: number;
  endIndex: number;
  endRow: number;
  rowSize: number;
  startIndex: number;
  startRow: number;
};

type UseDriveVirtualRangeOptions = {
  contentOffset?: number;
  estimateRowSize: number;
  getColumnCount?: (host: HTMLElement) => number;
  itemCount: number;
  leadingItemCount?: number;
  measureRowSize?: (host: HTMLElement) => number;
  overscanRows?: number;
  resetKey: string;
};

type CalculateDriveVirtualRangeOptions = {
  columnCount: number;
  hostStart: number;
  itemCount: number;
  overscanRows: number;
  rowSize: number;
  scrollTop: number;
  viewportSize: number;
};

export function calculateDriveVirtualRange({
  columnCount,
  hostStart,
  itemCount,
  overscanRows,
  rowSize,
  scrollTop,
  viewportSize,
}: CalculateDriveVirtualRangeOptions): DriveVirtualRange {
  const safeColumns = Math.max(1, Math.floor(columnCount));
  const safeRowSize = Math.max(1, rowSize);
  const rowCount = Math.ceil(itemCount / safeColumns);
  const visibleStart = Math.max(0, scrollTop - hostStart);
  const visibleEnd = Math.max(0, scrollTop + viewportSize - hostStart);
  const startRow = Math.max(0, Math.floor(visibleStart / safeRowSize) - overscanRows);
  const endRow = Math.min(
    rowCount,
    Math.max(startRow + 1, Math.ceil(visibleEnd / safeRowSize) + overscanRows),
  );

  return {
    columnCount: safeColumns,
    endIndex: Math.min(itemCount, endRow * safeColumns),
    endRow,
    rowSize: safeRowSize,
    startIndex: Math.min(itemCount, startRow * safeColumns),
    startRow,
  };
}

export function useDriveVirtualRange({
  contentOffset = 0,
  estimateRowSize,
  getColumnCount,
  itemCount,
  leadingItemCount = 0,
  measureRowSize,
  overscanRows = DEFAULT_OVERSCAN_ROWS,
  resetKey,
}: UseDriveVirtualRangeOptions) {
  const totalItemCount = itemCount + leadingItemCount;
  const virtualized = totalItemCount > VIRTUALIZATION_THRESHOLD;
  const initialEnd = virtualized ? Math.min(totalItemCount, 24) : totalItemCount;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [range, setRange] = useState<DriveVirtualRange>({
    columnCount: 1,
    endIndex: initialEnd,
    endRow: initialEnd,
    rowSize: estimateRowSize,
    startIndex: 0,
    startRow: 0,
  });
  const latestLayoutRef = useRef<{
    host: HTMLElement;
    hostStart: number;
    range: DriveVirtualRange;
    scrollElement: HTMLElement;
  } | null>(null);
  const previousResetKeyRef = useRef(resetKey);

  const hostRef = useCallback<RefCallback<HTMLElement>>((node) => {
    setHost(node);
  }, []);

  useLayoutEffect(() => {
    if (!host) return;

    let frame = 0;
    const scrollElement = findDriveScrollElement(host);
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const update = () => {
      if (!virtualized || !scrollElement) {
        setRange(createFullRange(totalItemCount, estimateRowSize));
        latestLayoutRef.current = null;
        return;
      }

      const columnCount = Math.max(1, getColumnCount?.(host) ?? 1);
      const measuredRowSize = measureRowSize?.(host);
      const rowSize = measuredRowSize && measuredRowSize > 0
        ? measuredRowSize
        : estimateRowSize;
      const scrollRect = scrollElement.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const hostStart = (
        host === scrollElement
          ? 0
          : hostRect.top - scrollRect.top + scrollElement.scrollTop
      ) + contentOffset;
      const nextRange = calculateDriveVirtualRange({
        columnCount,
        hostStart,
        itemCount: totalItemCount,
        overscanRows,
        rowSize,
        scrollTop: scrollElement.scrollTop,
        viewportSize: scrollElement.clientHeight,
      });
      setRange((current) => sameRange(current, nextRange) ? current : nextRange);
      latestLayoutRef.current = { host, hostStart, range: nextRange, scrollElement };
    };

    scheduleUpdate();
    scrollElement?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleUpdate);
    if (scrollElement) resizeObserver?.observe(scrollElement);
    resizeObserver?.observe(host);

    if (previousResetKeyRef.current !== resetKey) {
      previousResetKeyRef.current = resetKey;
      window.requestAnimationFrame(() => {
        if (!scrollElement) return;
        const scrollRect = scrollElement.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const hostStart = host === scrollElement
          ? 0
          : hostRect.top - scrollRect.top + scrollElement.scrollTop;
        scrollElement.scrollTo({ top: Math.max(0, hostStart), behavior: "auto" });
      });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      scrollElement?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [contentOffset, estimateRowSize, getColumnCount, host, measureRowSize, overscanRows, resetKey, totalItemCount, virtualized]);

  const scrollToIndex = useCallback((itemIndex: number) => {
    const layout = latestLayoutRef.current;
    if (!layout) return;
    const { columnCount, rowSize } = layout.range;
    const rowIndex = Math.floor((itemIndex + leadingItemCount) / columnCount);
    const rowTop = layout.hostStart + rowIndex * rowSize;
    const rowBottom = rowTop + rowSize;
    layout.scrollElement.scrollTo({
      top: Math.max(0, rowBottom - layout.scrollElement.clientHeight),
      behavior: "auto",
    });
  }, [leadingItemCount]);

  const totalRows = Math.ceil(totalItemCount / range.columnCount);
  return {
    bottomSpacerSize: Math.max(0, (totalRows - range.endRow) * range.rowSize),
    columnCount: range.columnCount,
    endIndex: range.endIndex,
    hostRef,
    scrollToIndex,
    startIndex: range.startIndex,
    topSpacerSize: Math.max(0, range.startRow * range.rowSize),
    virtualized,
  };
}

function createFullRange(itemCount: number, rowSize: number): DriveVirtualRange {
  return {
    columnCount: 1,
    endIndex: itemCount,
    endRow: itemCount,
    rowSize,
    startIndex: 0,
    startRow: 0,
  };
}

function findDriveScrollElement(host: HTMLElement) {
  if (host.classList.contains("drive-table-shell")) return host;
  return host.closest<HTMLElement>(".drive-workspace-scroll");
}

function sameRange(current: DriveVirtualRange, next: DriveVirtualRange) {
  return current.columnCount === next.columnCount
    && current.endIndex === next.endIndex
    && current.endRow === next.endRow
    && current.rowSize === next.rowSize
    && current.startIndex === next.startIndex
    && current.startRow === next.startRow;
}
