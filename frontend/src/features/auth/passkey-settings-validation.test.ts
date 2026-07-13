import { describe, expect, it } from "vitest";
import { validatePasskeySettingsInput } from "./passkey-settings-validation";

describe("Passkey settings validation", () => {
  it("accepts an exact HTTPS RP ID and origin", () => {
    const result = validatePasskeySettingsInput({
      origin: "https://drive.example.com/",
      rpId: "DRIVE.EXAMPLE.COM",
      rpName: " ICEDR ",
    });

    expect(result.valid).toBe(true);
    expect(result.normalized).toEqual({
      origin: "https://drive.example.com",
      rpId: "drive.example.com",
      rpName: "ICEDR",
    });
  });

  it("rejects a host mismatch that would make browser verification fail", () => {
    const result = validatePasskeySettingsInput({
      origin: "http://localhost:13000",
      rpId: "127.0.0.1",
      rpName: "ICEDR",
    });

    expect(result.errors.rpId).toBe("admin.passkeyRpHostMismatch");
  });

  it("allows HTTP only for local loopback development", () => {
    expect(
      validatePasskeySettingsInput({
        origin: "http://127.0.0.1:13000",
        rpId: "127.0.0.1",
        rpName: "ICEDR",
      }).valid,
    ).toBe(true);
    expect(
      validatePasskeySettingsInput({
        origin: "http://drive.example.com",
        rpId: "drive.example.com",
        rpName: "ICEDR",
      }).errors.origin,
    ).toBe("admin.passkeyOriginSecureRequired");
  });

  it("rejects paths, queries, and fragments in an origin", () => {
    const result = validatePasskeySettingsInput({
      origin: "https://drive.example.com/login?next=/",
      rpId: "drive.example.com",
      rpName: "ICEDR",
    });

    expect(result.errors.origin).toBe("admin.passkeyOriginInvalid");
  });
});
