import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOAuthBrowserFlow,
  completeOAuthRequestOnce,
  createOAuthFlowToken,
  getOAuthLoginReturnTo,
  requireOAuthBrowserFlow,
  storeOAuthBrowserFlow,
} from "./oauth-browser-flow";

describe("OAuth browser binding", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("rejects unsolicited and mismatched callbacks", () => {
    expect(() => requireOAuthBrowserFlow()).toThrow();
    storeOAuthBrowserFlow(
      "login",
      "https://provider.example/authorize?state=expected",
      createOAuthFlowToken(),
    );
    expect(() =>
      requireOAuthBrowserFlow(
        "login",
        "https://drive.example/callback?state=attacker",
      ),
    ).toThrow();
    expect(() => requireOAuthBrowserFlow("step-up")).toThrow();
    expect(
      requireOAuthBrowserFlow(
        "login",
        "https://drive.example/callback?state=expected",
      ).state,
    ).toBe("expected");
  });

  it("preserves only safe local return destinations", () => {
    storeOAuthBrowserFlow(
      "login",
      "https://provider.example/?state=one",
      createOAuthFlowToken(),
      "/files?folder=work",
    );
    expect(getOAuthLoginReturnTo()).toBe("/files?folder=work");
    storeOAuthBrowserFlow(
      "login",
      "https://provider.example/?state=two",
      createOAuthFlowToken(),
      "//attacker.example",
    );
    expect(getOAuthLoginReturnTo()).toBe("/");
  });

  it("expires continuations and rejects a changed login session", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("icedr.auth.token", "session-a");
    storeOAuthBrowserFlow(
      "step-up",
      "https://provider.example/?state=one",
      createOAuthFlowToken(),
    );
    expect(requireOAuthBrowserFlow("step-up").kind).toBe("step-up");
    window.localStorage.setItem("icedr.auth.token", "session-b");
    expect(() => requireOAuthBrowserFlow("step-up")).toThrow();
    window.localStorage.setItem("icedr.auth.token", "session-a");
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(() => requireOAuthBrowserFlow("step-up")).toThrow();
    vi.useRealTimers();
  });

  it("shares a one-time exchange across repeated effects", async () => {
    storeOAuthBrowserFlow(
      "login",
      "https://provider.example/?state=one",
      createOAuthFlowToken(),
    );
    const exchange = vi.fn(async () => ({ token: "session" }));
    const results = await Promise.all([
      completeOAuthRequestOnce("same-code", exchange),
      completeOAuthRequestOnce("same-code", exchange),
    ]);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
    clearOAuthBrowserFlow();
    expect(() => requireOAuthBrowserFlow()).toThrow();
  });
});
