import type { ReactNode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { OAuthCallbackRoute } from "./oauth-callback-client";

const mocks = vi.hoisted(() => ({
  completeOAuthCallback: vi.fn(),
  replace: vi.fn(),
  setStoredAuthToken: vi.fn(),
}));

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/drive-api", () => ({
  completeOAuthCallback: mocks.completeOAuthCallback,
  setStoredAuthToken: mocks.setStoredAuthToken,
}));

vi.mock("./drive-shell", () => ({
  LocalizedDriveShell: ({
    children,
  }: {
    children: (value: { palette: typeof palettes.light }) => ReactNode;
  }) => children({ palette: palettes.light }),
}));

vi.mock("./auth-form-primitives", () => ({
  AuthPrimaryButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AuthStatusNotice: () => null,
}));

vi.mock("./drive-primitives", () => ({
  LocalIcon: () => null,
  Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("OAuthCallbackRoute", () => {
  beforeEach(() => {
    mocks.completeOAuthCallback.mockReset();
    mocks.replace.mockReset();
    mocks.setStoredAuthToken.mockReset();
    window.history.replaceState(null, "", "/callback?code=provider-code");
  });

  afterEach(() => cleanup());

  it("stores a login session before returning to the drive", async () => {
    mocks.completeOAuthCallback.mockResolvedValue({
      expiresAt: "2026-09-20T12:00:00.000Z",
      token: "session-token",
      user: { id: "user-1" },
    });

    render(<OAuthCallbackRoute />);

    await waitFor(() => {
      expect(mocks.setStoredAuthToken).toHaveBeenCalledWith("session-token");
      expect(mocks.replace).toHaveBeenCalledWith("/");
    });
    expect(mocks.completeOAuthCallback).toHaveBeenCalledWith({
      callbackUrl: window.location.href,
    });
  });

  it("routes step-up codes to security settings without replacing the session", async () => {
    mocks.completeOAuthCallback.mockResolvedValue({
      code: "step-up/code+value",
      flow: "step-up",
    });

    render(<OAuthCallbackRoute />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        "/settings?oauthStepUpCode=step-up%2Fcode%2Bvalue&tab=security",
      );
    });
    expect(mocks.setStoredAuthToken).not.toHaveBeenCalled();
  });
});
