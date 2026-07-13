import { describe, expect, it } from "vitest";
import {
  DriveApiError,
  getDriveApiErrorMessage,
  readDriveApiError,
} from "./drive-api-errors";

const t = (key: string, values?: Record<string, string | number>) => {
  if (!values) return key;
  return `${key}:${JSON.stringify(values)}`;
};

describe("drive api errors", () => {
  it("classifies common HTTP statuses", () => {
    expect(new DriveApiError("Unauthorized", 401).kind).toBe("auth-expired");
    expect(new DriveApiError("Forbidden", 403).kind).toBe("forbidden");
    expect(new DriveApiError("Missing", 404).kind).toBe("not-found");
    expect(new DriveApiError("Too many requests", 429).kind).toBe("rate-limited");
    expect(new DriveApiError("Broken", 500).kind).toBe("server");
  });

  it("parses structured API errors", async () => {
    const response = new Response(
      JSON.stringify({ code: "TEST_CODE", message: ["first", "second"] }),
      { headers: { "content-type": "application/json" }, status: 400 },
    );

    await expect(readDriveApiError(response)).resolves.toEqual({
      code: "TEST_CODE",
      message: "first; second",
    });
  });

  it("detects HTML responses", async () => {
    const response = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    });

    await expect(readDriveApiError(response)).resolves.toEqual({
      code: "DRIVE_API_HTML_RESPONSE",
      message: "Drive API returned an HTML response",
    });
  });

  it("uses share-specific messages for anonymous share access", () => {
    expect(
      getDriveApiErrorMessage(
        new DriveApiError("Share link is expired", 410),
        t,
        { scope: "share" },
      ),
    ).toBe("errors.shareExpired");
    expect(
      getDriveApiErrorMessage(
        new DriveApiError("Share access rate limit exceeded", 429),
        t,
        { scope: "share" },
      ),
    ).toBe("errors.shareRateLimited");
  });

  it("keeps backend reasons when no mapped message exists", () => {
    expect(
      getDriveApiErrorMessage(
        new DriveApiError("Custom backend reason", 418),
        t,
        { fallbackKey: "fallback" },
      ),
    ).toBe("errors.withReason:{\"reason\":\"Custom backend reason\"}");
  });
});
