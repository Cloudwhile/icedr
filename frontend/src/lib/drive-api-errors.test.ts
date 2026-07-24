import { describe, expect, it } from "vitest";
import {
  createDriveApiResponseError,
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

  it("preserves a finite non-negative retry delay from structured API errors", async () => {
    const response = new Response(
      JSON.stringify({
        code: "SHARE_RATE_LIMITED",
        message: "Share access rate limit exceeded",
        retryAfter: 42,
      }),
      { headers: { "content-type": "application/json" }, status: 429 },
    );

    const apiError = await readDriveApiError(response);
    const error = createDriveApiResponseError(response, apiError);

    expect(apiError).toEqual({
      code: "SHARE_RATE_LIMITED",
      message: "Share access rate limit exceeded",
      retryAfter: 42,
    });
    expect(error).toMatchObject({
      code: "SHARE_RATE_LIMITED",
      message: "Share access rate limit exceeded",
      retryAfter: 42,
      status: 429,
    });
  });

  it("preserves the current transfer status from a state conflict", async () => {
    const response = new Response(
      JSON.stringify({
        code: "TRANSFER_STATE_CONFLICT",
        currentStatus: "paused",
        message: "Transfer status changed before the update was applied",
      }),
      { headers: { "content-type": "application/json" }, status: 409 },
    );

    const apiError = await readDriveApiError(response);
    const error = createDriveApiResponseError(response, apiError);

    expect(apiError.currentStatus).toBe("paused");
    expect(error).toMatchObject({
      code: "TRANSFER_STATE_CONFLICT",
      currentStatus: "paused",
      status: 409,
    });
  });

  it.each([
    ["negative", "-1"],
    ["non-finite", "1e400"],
    ["non-number", '"42"'],
  ])("ignores a %s retry delay", async (_label, retryAfter) => {
    const response = new Response(
      `{"message":"Too many requests","retryAfter":${retryAfter}}`,
      { headers: { "content-type": "application/json" }, status: 429 },
    );

    const apiError = await readDriveApiError(response);
    const error = createDriveApiResponseError(response, apiError);

    expect(apiError).not.toHaveProperty("retryAfter");
    expect(error.retryAfter).toBeUndefined();
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

  it("prefers structured transfer failure messages in workspace and share scopes", () => {
    const error = new DriveApiError(
      "Download preparation failed",
      409,
      "DOWNLOAD_FAILED",
    );

    expect(getDriveApiErrorMessage(error, t)).toBe(
      "transfers.failureReason.DOWNLOAD_FAILED",
    );
    expect(getDriveApiErrorMessage(error, t, { scope: "share" })).toBe(
      "transfers.failureReason.DOWNLOAD_FAILED",
    );
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
