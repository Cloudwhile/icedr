import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredSetupToken,
  completeSetup,
  fetchSetupStatus,
  getStoredSetupToken,
  setStoredSetupToken,
  testSetupMailSettings,
  updateSetupMailSettings,
  verifySetupDatabase,
  type CompleteSetupInput,
} from "./drive-api";

const setupToken = "fixed-test-setup-token-000000000001";

describe("setup api", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the setup token only in session storage", () => {
    setStoredSetupToken(`  ${setupToken}  `);

    expect(getStoredSetupToken()).toBe(setupToken);
    expect(window.localStorage.getItem("icedr.setup.token")).toBeNull();

    clearStoredSetupToken();
    expect(getStoredSetupToken()).toBeNull();
  });

  it("does not send a stored token unless the caller passes it explicitly", async () => {
    setStoredSetupToken(setupToken);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(completedSetupStatus()),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchSetupStatus();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/setup/status");
    expect(new Headers(init.headers).get("x-setup-token")).toBeNull();
  });

  it("sends the explicit token only in the setup header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(authorizedSetupStatus()),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchSetupStatus(setupToken);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/setup/status");
    expect(new Headers(init.headers).get("x-setup-token")).toBe(setupToken);
    expect(url).not.toContain(setupToken);
    expect(init.body).toBeUndefined();
  });

  it("adds the setup header to every protected setup request", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/verify-database")) {
        return Promise.resolve(Response.json(databaseProfile()));
      }
      if (url.endsWith("/complete")) {
        return Promise.resolve(
          Response.json({ bootstrapCompleted: true, session: { token: "auth" } }),
        );
      }
      return Promise.resolve(Response.json(mailSettings()));
    });
    vi.stubGlobal("fetch", fetchMock);

    await verifySetupDatabase(setupToken);
    await completeSetup(setupToken, completeSetupInput());
    await updateSetupMailSettings(setupToken, { enabled: false });
    await testSetupMailSettings(setupToken, "admin@example.com");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-setup-token")).toBe(setupToken);
      expect(url).not.toContain(setupToken);
      expect(String(init.body)).not.toContain(setupToken);
    }
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ confirm: true }),
    );
  });

  it("forces remote database confirmation after spreading the input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(databaseProfile()),
    );
    vi.stubGlobal("fetch", fetchMock);

    await verifySetupDatabase(
      setupToken,
      { provider: "postgresql", host: "db.example.com" },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      provider: "postgresql",
      host: "db.example.com",
      confirm: true,
    });
  });

  it.each([
    [401, "SETUP_BOOTSTRAP_REQUIRED"],
    [403, "SETUP_BOOTSTRAP_INVALID"],
    [503, "SETUP_BOOTSTRAP_UNAVAILABLE"],
  ])("clears the stored token for status %s and code %s", async (status, code) => {
    setStoredSetupToken(setupToken);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ code, message: "Setup credential failed" }, { status }),
      ),
    );

    await expect(fetchSetupStatus(setupToken)).rejects.toMatchObject({
      code,
      status,
    });
    expect(getStoredSetupToken()).toBeNull();
  });

  it("keeps the stored token for an unrelated service unavailable response", async () => {
    setStoredSetupToken(setupToken);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { code: "DATABASE_UNAVAILABLE", message: "Database is unavailable" },
          { status: 503 },
        ),
      ),
    );

    await expect(verifySetupDatabase(setupToken)).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
      status: 503,
    });
    expect(getStoredSetupToken()).toBe(setupToken);
  });

  it("clears the stored token when setup is already complete", async () => {
    setStoredSetupToken(setupToken);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(completedSetupStatus())),
    );

    await expect(fetchSetupStatus(setupToken)).resolves.toMatchObject({
      needsSetup: false,
    });
    expect(getStoredSetupToken()).toBeNull();
  });
});

function completedSetupStatus() {
  return {
    bootstrapCompleted: true,
    databaseAvailable: true,
    needsSetup: false,
  } as const;
}

function authorizedSetupStatus() {
  return {
    bootstrapCompleted: false,
    databaseAvailable: true,
    needsSetup: true,
    setupAccess: { authorized: true, configured: true },
    databaseProfile: databaseProfile(),
    site: { authLogoDataUrl: null, siteName: "ICEDR" },
    oauth: {
      id: "default",
      enabled: false,
      providerKey: "oidc",
      displayName: "Custom OIDC",
      providerProfile: "oidc",
      providerMode: "standard",
      issuerUrl: "",
      authorizationUrl: "",
      tokenUrl: "",
      userinfoUrl: "",
      clientId: "",
      audience: "",
      scopes: "openid email profile",
      redirectUri: "",
      allowSignup: true,
      linkByVerifiedEmail: true,
      requireVerifiedEmail: true,
      allowedEmailDomains: [],
      clientSecretConfigured: false,
      configured: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    passkey: { origin: "", rpId: "", rpName: "ICEDR" },
    mail: mailSettings(),
    storage: {
      distributedStorageEnabled: false,
      quotaBytes: null,
      endpoint: "",
      region: "us-east-1",
      bucket: "icedr-drive",
      accessKeyId: "",
      forcePathStyle: true,
      physicalAvailableBytes: null,
      physicalCapacityBytes: null,
      physicalCapacityCheckedAt: "2026-01-01T00:00:00.000Z",
      physicalCapacityKnown: false,
      physicalCapacityReason: null,
      physicalQuotaLimitBytes: null,
      storageProvider: "local",
      objectStorageConfigured: false,
      secretAccessKeyConfigured: false,
      localRoot: "data",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  } as const;
}

function databaseProfile() {
  return {
    provider: "sqlite",
    host: "",
    port: 5432,
    dbName: "icedr.sqlite",
    user: "",
    passwordProvided: false,
    passwordSource: "local",
    verified: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
  } as const;
}

function mailSettings() {
  return {
    enabled: false,
    host: "",
    port: 587,
    secure: false,
    username: "",
    fromName: "ICEDR",
    fromEmail: "",
    replyTo: "",
    configured: false,
    passwordConfigured: false,
    verifiedAt: null,
  };
}

function completeSetupInput(): CompleteSetupInput {
  return {
    admin: {
      displayName: "Admin",
      email: "admin@example.com",
      password: "test-password",
    },
    site: { siteName: "ICEDR" },
    localEnabled: true,
    oauthEnabled: false,
    passkeyEnabled: false,
    distributedStorageEnabled: false,
    sharePolicy: {
      anonymousAccess: "blocked",
      emailRule: "any",
      allowedDomains: [],
      defaultExpiresDays: 7,
      maxExpiresDays: 30,
      allowPermanent: false,
      audit: {
        ip: true,
        userAgent: true,
        downloads: true,
        anomaly: false,
        alerts: false,
      },
    },
  };
}
