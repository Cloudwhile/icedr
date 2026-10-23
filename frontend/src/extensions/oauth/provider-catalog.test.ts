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
      ...createOAuthDraft(
        template,
        "https://drive.example.com/api/identity/oauth",
      ),
      clientId: "client-id",
      issuerUrl: "issuer.example.com",
    };

    expect(validateOAuthDraft(draft, "").errorKey).toBe(
      "admin.oauthIssuerInvalid",
    );
  });

  it("accepts a complete OIDC draft without requiring a secret", () => {
    const draft = {
      ...createOAuthDraft(
        template,
        "https://drive.example.com/api/identity/oauth",
      ),
      clientId: "client-id",
      issuerUrl: "https://accounts.example.com",
    };

    expect(validateOAuthDraft(draft, "").valid).toBe(true);
  });

  it("rejects malformed allowed email domains", () => {
    const draft = {
      ...createOAuthDraft(
        template,
        "https://drive.example.com/api/identity/oauth",
      ),
      allowedEmailDomains: ["https://example.com"],
      clientId: "client-id",
      issuerUrl: "https://accounts.example.com",
    };

    expect(validateOAuthDraft(draft, "").errorKey).toBe(
      "admin.oauthDomainInvalid",
    );
  });

  it("rejects URL fragments before sending configuration checks", () => {
    const draft = {
      ...createOAuthDraft(template, "https://drive.example.com"),
      clientId: "client",
      issuerUrl: "https://issuer.example",
    };
    expect(
      validateOAuthDraft(
        {
          ...draft,
          redirectUri: "https://drive.example.com/callback#fragment",
        },
        "",
      ).errorKey,
    ).toBe("admin.oauthRedirectInvalid");
    expect(
      validateOAuthDraft(
        { ...draft, issuerUrl: "https://issuer.example#fragment" },
        "",
      ).errorKey,
    ).toBe("admin.oauthIssuerInvalid");
  });

  it("rejects excess allowed domains instead of silently dropping restrictions", () => {
    const draft = {
      ...createOAuthDraft(template, "https://drive.example.com"),
      clientId: "client",
      issuerUrl: "https://issuer.example",
      allowedEmailDomains: Array.from(
        { length: 33 },
        (_, index) => `domain${index}.example`,
      ),
    };
    expect(validateOAuthDraft(draft, "").errorKey).toBe(
      "admin.oauthDomainInvalid",
    );
  });

  it("allows incomplete drafts while validating fields that are provided", () => {
    const draft = createOAuthDraft(template, "https://drive.example.com");
    expect(validateOAuthDraft(draft, "", { allowIncomplete: true }).valid).toBe(
      true,
    );
    expect(
      validateOAuthDraft({ ...draft, issuerUrl: "invalid" }, "", {
        allowIncomplete: true,
      }).errorKey,
    ).toBe("admin.oauthIssuerInvalid");
    expect(
      validateOAuthDraft({ ...draft, allowedEmailDomains: ["bad"] }, "", {
        allowIncomplete: true,
      }).errorKey,
    ).toBe("admin.oauthDomainInvalid");
  });
});
