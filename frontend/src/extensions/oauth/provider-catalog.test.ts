import { describe, expect, it } from "vitest";
import {
  createOAuthDraft,
  oauthProviderTemplates,
  validateOAuthDraft,
} from "./provider-catalog";

describe("OAuth provider draft validation", () => {
  const template = oauthProviderTemplates.find(
    (item) => item.profile === "oidc",
  )!;

  it("rejects malformed issuer and redirect URLs before testing", () => {
    const draft = {
      ...createOAuthDraft(template, "https://drive.example.com/api/identity/oauth"),
      clientId: "client-id",
      issuerUrl: "issuer.example.com",
    };

    expect(validateOAuthDraft(draft, "").errorKey).toBe(
      "admin.oauthIssuerInvalid",
    );
  });

  it("accepts a complete OIDC draft without requiring a secret", () => {
    const draft = {
      ...createOAuthDraft(template, "https://drive.example.com/api/identity/oauth"),
      clientId: "client-id",
      issuerUrl: "https://accounts.example.com",
    };

    expect(validateOAuthDraft(draft, "").valid).toBe(true);
  });

  it("rejects malformed allowed email domains", () => {
    const draft = {
      ...createOAuthDraft(template, "https://drive.example.com/api/identity/oauth"),
      allowedEmailDomains: ["https://example.com"],
      clientId: "client-id",
      issuerUrl: "https://accounts.example.com",
    };

    expect(validateOAuthDraft(draft, "").errorKey).toBe(
      "admin.oauthDomainInvalid",
    );
  });
});
