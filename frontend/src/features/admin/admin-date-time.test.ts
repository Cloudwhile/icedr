import { describe, expect, it } from "vitest";
import {
  formatZonedDateTimeLocal,
  parseZonedDateTimeLocal,
} from "./admin-date-time";

describe("admin date-time filters", () => {
  it("formats and parses values in the configured time zone", () => {
    expect(
      formatZonedDateTimeLocal(
        "2026-08-12T03:00:00.000Z",
        "Asia/Singapore",
      ),
    ).toBe("2026-08-12T11:00");
    expect(
      parseZonedDateTimeLocal("2026-08-12T11:30", "Asia/Singapore"),
    ).toBe("2026-08-12T03:30:00.000Z");
  });

  it("accounts for daylight-saving offsets at the selected date", () => {
    expect(
      parseZonedDateTimeLocal("2026-01-15T09:00", "America/New_York"),
    ).toBe("2026-01-15T14:00:00.000Z");
    expect(
      parseZonedDateTimeLocal("2026-07-15T09:00", "America/New_York"),
    ).toBe("2026-07-15T13:00:00.000Z");
  });

  it("rejects invalid and nonexistent local times", () => {
    expect(
      parseZonedDateTimeLocal("2026-02-30T09:00", "Asia/Singapore"),
    ).toBeUndefined();
    expect(
      parseZonedDateTimeLocal("2026-03-08T02:30", "America/New_York"),
    ).toBeUndefined();
    expect(
      formatZonedDateTimeLocal("not-a-date", "Asia/Singapore"),
    ).toBe("");
  });
});
