import { describe, expect, it } from "vitest";
import { DriveApiError } from "@/lib/drive-api-errors";
import { formatShareEmailCooldownMessage, resolveShareEmailAccessError } from "./email-access-errors";

const t = (key: string, values?: Record<string, string | number>) =>
  values?.seconds === undefined ? key : `${key}:${values.seconds}`;

describe("resolveShareEmailAccessError", () => {
  it("keeps the temporary lock duration and uses a dedicated message", () => {
    const result = resolveShareEmailAccessError(
      new DriveApiError(
        "Email access code verification is temporarily locked",
        429,
        "SHARE_EMAIL_VERIFICATION_LOCKED",
        42,
      ),
      "verify",
      t,
    );

    expect(result).toEqual({
      cooldown: { action: "verify", kind: "locked", remainingSeconds: 42 },
      message: "share.emailVerificationLocked:42",
      tone: "error",
    });
  });

  it("turns a send rate limit into a send cooldown", () => {
    const result = resolveShareEmailAccessError(
      new DriveApiError("Share access rate limit exceeded", 429, "SHARE_RATE_LIMITED", 15),
      "send",
      t,
    );

    expect(result).toEqual({
      cooldown: { action: "send", kind: "rate-limited", remainingSeconds: 15 },
      message: "share.emailCodeRateLimited:15",
      tone: "error",
    });
  });

  it("reports an email policy rejection instead of an SMTP failure", () => {
    const result = resolveShareEmailAccessError(
      new DriveApiError("Email domain is not allowed", 403),
      "send",
      t,
    );

    expect(result).toEqual({
      message: "share.emailNotAllowed",
      tone: "error",
    });
  });

  it("formats the current verification lock countdown", () => {
    expect(
      formatShareEmailCooldownMessage(
        { action: "verify", kind: "locked", remainingSeconds: 7 },
        t,
      ),
    ).toBe("share.emailVerificationLocked:7");
  });
});
