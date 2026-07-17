import { describe, expect, it } from "vitest";
import type { AuditEventResponse } from "@/lib/drive-api";
import { getAuditResult } from "./drive-modules";

function auditEvent(action: string): AuditEventResponse {
  return {
    id: "audit-test",
    action,
    actor: "visitor",
    target: "share:test",
    workspaceId: null,
    shareToken: null,
    nodeId: null,
    metadata: {},
    createdAt: new Date(0).toISOString(),
  };
}

describe("getAuditResult", () => {
  it.each([
    "share.access_code_failed",
    "share.access_code_locked",
    "share.access_denied",
    "share.rate_limited",
  ])("classifies %s as failed", (action) => {
    expect(getAuditResult(auditEvent(action))).toBe("failed");
  });

  it("keeps successful share activity successful", () => {
    expect(getAuditResult(auditEvent("share.viewed"))).toBe("success");
  });
});
