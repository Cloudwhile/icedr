import { describe, expect, it } from "vitest";
import { DriveApiError } from "@/lib/drive-api-errors";
import {
  getPasskeyErrorNotice,
  getPasskeyRequestContextIssue,
  PasskeyClientError,
} from "./passkey-client-errors";

const translate = (key: string) => key;

describe("Passkey client diagnostics", () => {
  it("rejects a mismatched RP ID before opening the browser ceremony", () => {
    expect(
      getPasskeyRequestContextIssue({
        hostname: "localhost",
        origin: "http://localhost:13000",
        rpId: "127.0.0.1",
        secureContext: true,
      }),
    ).toBe("auth.passkeyContextMismatch");
  });

  it("accepts an exact local RP ID and origin", () => {
    expect(
      getPasskeyRequestContextIssue({
        expectedOrigin: "http://127.0.0.1:13000",
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:13000",
        rpId: "127.0.0.1",
        secureContext: true,
      }),
    ).toBeNull();
  });

  it("rejects an origin port mismatch", () => {
    expect(
      getPasskeyRequestContextIssue({
        expectedOrigin: "https://drive.example.com",
        hostname: "drive.example.com",
        origin: "https://drive.example.com:8443",
        rpId: "drive.example.com",
        secureContext: true,
      }),
    ).toBe("auth.passkeyContextMismatch");
  });

  it("turns cancellation into neutral feedback instead of a failure", () => {
    const error = new DOMException("cancelled", "NotAllowedError");
    expect(getPasskeyErrorNotice(error, translate)).toEqual({
      message: "auth.passkeyNotCompleted",
      tone: "info",
    });
  });

  it("keeps AbortError silent", () => {
    const error = new DOMException("aborted", "AbortError");
    expect(getPasskeyErrorNotice(error, translate)).toBeNull();
  });

  it("recognizes the wrapped browser errors returned by SimpleWebAuthn", () => {
    const error = new Error("The operation was not allowed");
    error.name = "NotAllowedError";
    expect(getPasskeyErrorNotice(error, translate)).toEqual({
      message: "auth.passkeyNotCompleted",
      tone: "info",
    });
  });

  it("uses the form API mapping for expired ceremonies", () => {
    const error = new DriveApiError(
      "expired",
      401,
      "PASSKEY_CEREMONY_UNAVAILABLE",
    );
    expect(getPasskeyErrorNotice(error, translate)?.message).toBe(
      "errors.passkeyCeremonyUnavailable",
    );
  });

  it("reports client context failures directly", () => {
    expect(
      getPasskeyErrorNotice(
        new PasskeyClientError("auth.passkeyInsecureContext"),
        translate,
      )?.message,
    ).toBe("auth.passkeyInsecureContext");
  });
});
