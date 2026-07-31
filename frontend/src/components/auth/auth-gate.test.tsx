import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootI18nProvider } from "@/components/i18n/root-i18n-provider";
import { palettes } from "@/features/file/model";
import {
  clearStoredAuthToken,
  requestDriveApi,
  setStoredAuthToken,
} from "@/lib/drive-api-client";
import { AuthGate } from "./auth-gate";
import { AuthSessionCoordinator } from "./auth-session-coordinator";

const { replaceRoute } = vi.hoisted(() => ({
  replaceRoute: vi.fn(),
}));

vi.mock("@/compat/navigation", () => ({
  usePathname: () => "/admin/audit",
  useRouter: () => ({
    replace: replaceRoute,
  }),
}));

describe("AuthGate session expiry coordination", () => {
  beforeEach(() => {
    replaceRoute.mockReset();
    window.history.replaceState(
      null,
      "",
      "/admin/audit?cursor=next#events",
    );
    window.localStorage.clear();
    clearStoredAuthToken();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("lets the coordinator preserve the complete return location", async () => {
    setStoredAuthToken("token-a");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ needsSetup: false }))
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "AUTH_SESSION_EXPIRED",
            message: "Session has expired",
            statusCode: 401,
          },
          { status: 401 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RootI18nProvider>
        <AuthSessionCoordinator />
        <AuthGate palette={palettes.light}>
          <p>Protected content</p>
        </AuthGate>
      </RootI18nProvider>,
    );

    await waitFor(() => {
      expect(replaceRoute).toHaveBeenCalledOnce();
    });
    expect(replaceRoute).toHaveBeenCalledWith(
      "/login?next=%2Fadmin%2Faudit%3Fcursor%3Dnext%23events",
    );
  });

  it("rearms session expiry after an authentication entry route ignores it", async () => {
    window.history.replaceState(null, "", "/login");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          Response.json(
            {
              code: "AUTH_SESSION_REQUIRED",
              message: "Authentication is required",
              statusCode: 401,
            },
            { status: 401 },
          ),
        ),
      ),
    );

    render(
      <RootI18nProvider>
        <AuthSessionCoordinator />
      </RootI18nProvider>,
    );

    await act(async () => {
      await expect(requestDriveApi("/workspaces")).rejects.toMatchObject({
        status: 401,
      });
    });
    expect(replaceRoute).not.toHaveBeenCalled();

    window.history.replaceState(
      null,
      "",
      "/admin/audit?cursor=next#events",
    );
    await act(async () => {
      await expect(requestDriveApi("/workspaces")).rejects.toMatchObject({
        status: 401,
      });
    });

    expect(replaceRoute).toHaveBeenCalledOnce();
    expect(replaceRoute).toHaveBeenCalledWith(
      "/login?next=%2Fadmin%2Faudit%3Fcursor%3Dnext%23events",
    );
  });
});
