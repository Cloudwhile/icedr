import { describe, expect, it } from "vitest";
import { createLoginRedirect } from "./auth-session-navigation";

describe("auth session coordinator", () => {
  it("preserves the complete internal return location", () => {
    expect(createLoginRedirect("/admin/audit?cursor=next#events")).toBe(
      "/login?next=%2Fadmin%2Faudit%3Fcursor%3Dnext%23events",
    );
  });

  it("rejects non-internal return locations", () => {
    expect(createLoginRedirect("https://example.test/steal")).toBe(
      "/login?next=%2F",
    );
    expect(createLoginRedirect("//example.test/steal")).toBe(
      "/login?next=%2F",
    );
  });
});
