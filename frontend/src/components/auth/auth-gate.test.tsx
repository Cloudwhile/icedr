import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootI18nProvider } from "@/components/i18n/root-i18n-provider";
import { palettes } from "@/features/file/model";
import * as driveApi from "@/lib/drive-api";
import { DriveApiError } from "@/lib/drive-api-errors";
import {
  clearStoredAuthToken,
  getStoredAuthToken,
  requestDriveApi,
  setStoredAuthToken,
} from "@/lib/drive-api-client";
import { AuthGate } from "./auth-gate";
import { AuthSessionCoordinator } from "./auth-session-coordinator";

const { replaceRoute, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replaceRoute: replace,
    router: { replace },
  };
});

vi.mock("@/compat/navigation", () => ({
  usePathname: () => "/admin/audit",
  useRouter: () => router,
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it.each([[true, "token-a"], [false, "token-a"], [false, null]] as const)("handles expiry with coordinator=%s and token=%s while preserving the return location", async (withCoordinator, token) => {
    if (token) setStoredAuthToken(token);
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
        {withCoordinator ? <AuthSessionCoordinator /> : null}
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
    expect(getStoredAuthToken()).toBeNull();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("clears a retained expired token before redirecting even when the API caller leaves it stored", async () => {
    setStoredAuthToken("retained-expired-token");
    vi.spyOn(driveApi, "fetchSetupStatus").mockResolvedValue({ needsSetup: false } as Awaited<ReturnType<typeof driveApi.fetchSetupStatus>>);
    vi.spyOn(driveApi, "fetchCurrentUser").mockRejectedValue(new DriveApiError("Session expired", 401, "AUTH_SESSION_EXPIRED"));
    replaceRoute.mockImplementation(() => expect(getStoredAuthToken()).toBeNull());

    render(<RootI18nProvider><AuthGate palette={palettes.light}><p>Protected content</p></AuthGate></RootI18nProvider>);

    await waitFor(() => expect(replaceRoute).toHaveBeenCalledWith("/login?next=%2Fadmin%2Faudit%3Fcursor%3Dnext%23events"));
    expect(getStoredAuthToken()).toBeNull();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("does not let an old expired request redirect a newly signed-in session", async () => {
    setStoredAuthToken("old-token");
    let expire!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ needsSetup: false }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { expire = resolve; }))
      .mockResolvedValueOnce(Response.json({ needsSetup: false }))
      .mockResolvedValueOnce(Response.json({ id: "new-user" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RootI18nProvider><AuthGate palette={palettes.light}><p>Protected content</p></AuthGate></RootI18nProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toBeInTheDocument();
    setStoredAuthToken("new-token");
    await act(async () => expire(Response.json({ code: "AUTH_SESSION_EXPIRED" }, { status: 401 })));
    expect(await screen.findByText("Protected content")).toBeInTheDocument();
    expect(getStoredAuthToken()).toBe("new-token");
    expect(replaceRoute).not.toHaveBeenCalled();
  });

  it("redirects an incomplete installation to setup before loading the user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        needsSetup: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RootI18nProvider>
        <AuthGate palette={palettes.light}>
          <p>Protected content</p>
        </AuthGate>
      </RootI18nProvider>,
    );

    await waitFor(() => {
      expect(replaceRoute).toHaveBeenCalledOnce();
    });
    expect(replaceRoute).toHaveBeenCalledWith(
      "/setup?next=%2Fadmin%2Faudit%3Fcursor%3Dnext%23events",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  });

  it("retries after setup status loading fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(Response.json({ needsSetup: false }))
      .mockResolvedValueOnce(
        Response.json({
          avatarUrl: null,
          createdAt: "2026-07-31T00:00:00.000Z",
          displayName: "Review Admin",
          email: "admin@example.com",
          id: "admin-user",
          locale: "en",
          role: "admin",
          theme: "light",
          timezone: "UTC",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RootI18nProvider>
        <AuthGate palette={palettes.light}>
          <p>Protected content</p>
        </AuthGate>
      </RootI18nProvider>,
    );

    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(await screen.findByText("Protected content")).toBeInTheDocument();
    expect(replaceRoute).not.toHaveBeenCalled();
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
