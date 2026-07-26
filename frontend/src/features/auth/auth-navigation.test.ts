import { describe, expect, it } from "vitest";
import { resolveAuthNextTarget } from "./auth-navigation";

describe("resolveAuthNextTarget", () => {
  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "javascript:alert(1)",
    "relative/path",
  ])("rejects a non-local next target: %s", (next) => {
    expect(resolveAuthNextTarget(next)).toBe("/");
  });

  it.each([
    "/login",
    "/login?next=%2Fdrive",
    "/register/",
    "/forgot-password#form",
    "/reset-password?token=test",
  ])("rejects an authentication route: %s", (next) => {
    expect(resolveAuthNextTarget(next)).toBe("/");
  });

  it("preserves a local application path with query and hash", () => {
    expect(resolveAuthNextTarget("/drive?scope=personal#recent")).toBe(
      "/drive?scope=personal#recent",
    );
  });
});
