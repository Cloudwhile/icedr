import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPasskeyBindingState,
  parsePendingSecurityAction,
  passkeyRemovalViolatesPolicy,
  readPendingSecurityAction,
  storePendingSecurityAction,
} from "./passkey-manager-state";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("getPasskeyBindingState", () => {
  it("does not infer a binding from an authenticated user or service config", () => {
    expect(getPasskeyBindingState([], false, false)).toBe("unbound");
  });

  it("reports bound only when the credential list contains a Passkey", () => {
    expect(
      getPasskeyBindingState(
        [
          {
            aaguid: null,
            backedUp: false,
            id: "passkey-1",
            name: "Laptop",
            deviceName: "Windows · Chrome",
            deviceType: "singleDevice",
            transports: [],
            createdAt: new Date(0).toISOString(),
            lastUsedAt: null,
          },
        ],
        false,
        false,
      ),
    ).toBe("bound");
  });

  it("blocks removal when the last Passkey method is required by policy", () => {
    expect(
      passkeyRemovalViolatesPolicy(1, {
        compliant: true,
        methodCount: 2,
        minimumAuthenticationMethods: 2,
        methods: {
          oauth: false,
          passkey: true,
          password: true,
          recoveryCodes: 0,
        },
      }),
    ).toBe(true);
  });

  it("allows removal when another Passkey keeps the method available", () => {
    expect(
      passkeyRemovalViolatesPolicy(2, {
        compliant: true,
        methodCount: 2,
        minimumAuthenticationMethods: 2,
        methods: {
          oauth: false,
          passkey: true,
          password: true,
          recoveryCodes: 0,
        },
      }),
    ).toBe(false);
  });

  it("validates OAuth continuation actions before resuming them", () => {
    expect(
      parsePendingSecurityAction({
        kind: "add-passkey",
        name: "  Work laptop  ",
      }),
    ).toEqual({ kind: "add-passkey", name: "Work laptop" });
    expect(
      parsePendingSecurityAction({ kind: "delete-passkey", passkeyId: "" }),
    ).toBeNull();
    expect(parsePendingSecurityAction({ kind: "unknown" })).toBeNull();
  });

  it("resumes only an unexpired action from the same authenticated session", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000000);
    localStorage.setItem("icedr.auth.token", "session-a");
    storePendingSecurityAction({ kind: "generate-recovery-codes" });
    expect(readPendingSecurityAction()).toEqual({
      kind: "generate-recovery-codes",
    });
    localStorage.setItem("icedr.auth.token", "session-b");
    expect(readPendingSecurityAction()).toBeNull();
    localStorage.setItem("icedr.auth.token", "session-a");
    vi.spyOn(Date, "now").mockReturnValue(1600000);
    expect(readPendingSecurityAction()).toBeNull();
  });

  it("rejects legacy or malformed continuation records", () => {
    localStorage.setItem("icedr.auth.token", "session-a");
    sessionStorage.setItem(
      "icedr.security.pending-action",
      JSON.stringify({ kind: "generate-recovery-codes" }),
    );
    expect(readPendingSecurityAction()).toBeNull();
    sessionStorage.setItem(
      "icedr.security.pending-action",
      JSON.stringify({
        action: { kind: "generate-recovery-codes" },
        createdAt: "invalid",
        sessionToken: "session-a",
      }),
    );
    expect(readPendingSecurityAction()).toBeNull();
  });
});
