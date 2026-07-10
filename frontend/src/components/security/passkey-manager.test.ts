import { describe, expect, it } from "vitest";
import {
  getPasskeyBindingState,
  parsePendingSecurityAction,
  passkeyRemovalViolatesPolicy,
} from "./passkey-manager-state";

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
});
