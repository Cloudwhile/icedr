import { describe, expect, it } from "vitest";
import { calculateDriveVirtualRange } from "./use-drive-virtual-range";

describe("calculateDriveVirtualRange", () => {
  it("keeps a large list bounded to the viewport and overscan", () => {
    const range = calculateDriveVirtualRange({
      columnCount: 1,
      hostStart: 0,
      itemCount: 1000,
      overscanRows: 3,
      rowSize: 62,
      scrollTop: 0,
      viewportSize: 620,
    });

    expect(range).toMatchObject({ startIndex: 0, endIndex: 13 });
  });

  it("aligns grid windows to complete rows", () => {
    const range = calculateDriveVirtualRange({
      columnCount: 5,
      hostStart: 100,
      itemCount: 1000,
      overscanRows: 2,
      rowSize: 210,
      scrollTop: 2200,
      viewportSize: 840,
    });

    expect(range.startIndex % 5).toBe(0);
    expect(range.endIndex % 5).toBe(0);
    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(45);
  });
});
