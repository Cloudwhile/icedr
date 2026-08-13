import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerNavigationBlocker,
  usePathname,
  useRouter,
  type BlockedNavigation,
} from "@/compat/navigation";

function RouterControls() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div>
      <output aria-label="location">{pathname}</output>
      <button onClick={() => router.push("/admin/audit?scope=all")} type="button">
        push
      </button>
      <button onClick={() => router.push("/admin/status")} type="button">
        push status
      </button>
      <button onClick={() => router.replace("/admin/settings")} type="button">
        replace
      </button>
    </div>
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/overview");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("compat navigation blocking", () => {
  it("tracks ordinary compat navigation before a blocker is registered", () => {
    render(<RouterControls />);

    fireEvent.click(screen.getByRole("button", { name: "push" }));

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/admin/audit?scope=all",
    );
    expect(window.history.state).toEqual(
      expect.objectContaining({ __icedrNavigationIndex: 1 }),
    );
  });

  it("keeps history indexes across blocker registration cycles", async () => {
    render(<RouterControls />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));

    const firstUnregister = registerNavigationBlocker(() => false);
    firstUnregister();
    fireEvent.click(screen.getByRole("button", { name: "push status" }));

    const transitions: BlockedNavigation[] = [];
    const unregister = registerNavigationBlocker((transition) => {
      transitions.push(transition);
      return true;
    });

    act(() => window.history.back());

    await waitFor(() => {
      expect(transitions).toHaveLength(1);
      expect(window.location.pathname).toBe("/admin/status");
    });
    expect(transitions[0].nextUrl.pathname).toBe("/admin/audit");

    unregister();
  });

  it("restores an untracked external history entry when its pop is cancelled", async () => {
    window.history.replaceState(
      { source: "external" },
      "",
      "/external-before-admin",
    );
    window.history.pushState(null, "", "/admin/overview");
    render(<RouterControls />);

    const transitions: BlockedNavigation[] = [];
    const unregister = registerNavigationBlocker((transition) => {
      transitions.push(transition);
      return true;
    });

    act(() => window.history.back());

    await waitFor(() => {
      expect(transitions).toHaveLength(1);
      expect(window.location.pathname).toBe("/admin/overview");
    });
    expect(transitions[0].action).toBe("pop");
    expect(transitions[0].nextUrl.pathname).toBe("/external-before-admin");

    unregister();
  });

  it("retries an untracked external pop and keeps later push and pop navigation coherent", async () => {
    window.history.replaceState(
      { source: "external" },
      "",
      "/external-before-admin",
    );
    window.history.pushState(null, "", "/admin/overview");
    render(<RouterControls />);

    let shouldBlock = true;
    const transitions: BlockedNavigation[] = [];
    const unregister = registerNavigationBlocker((transition) => {
      if (!shouldBlock) return false;
      transitions.push(transition);
      return true;
    });

    act(() => window.history.back());
    await waitFor(() => {
      expect(transitions).toHaveLength(1);
      expect(window.location.pathname).toBe("/admin/overview");
    });

    act(() => transitions[0].retry());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/external-before-admin"),
    );

    shouldBlock = false;
    fireEvent.click(screen.getByRole("button", { name: "push status" }));
    expect(window.location.pathname).toBe("/admin/status");

    shouldBlock = true;
    act(() => window.history.back());
    await waitFor(() => {
      expect(transitions).toHaveLength(2);
      expect(window.location.pathname).toBe("/admin/status");
    });
    expect(transitions[1].nextUrl.pathname).toBe("/external-before-admin");

    act(() => transitions[1].retry());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/external-before-admin"),
    );

    unregister();
  });

  it("blocks push and replace until the captured navigation is retried", () => {
    render(<RouterControls />);
    const transitions: BlockedNavigation[] = [];
    const unregister = registerNavigationBlocker((transition) => {
      transitions.push(transition);
      return true;
    });

    fireEvent.click(screen.getByRole("button", { name: "push" }));

    expect(window.location.pathname).toBe("/admin/overview");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].action).toBe("push");
    expect(transitions[0].currentUrl.pathname).toBe("/admin/overview");
    expect(transitions[0].nextUrl.pathname).toBe("/admin/audit");

    act(() => transitions[0].retry());
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/admin/audit?scope=all",
    );

    fireEvent.click(screen.getByRole("button", { name: "replace" }));

    expect(window.location.pathname).toBe("/admin/audit");
    expect(transitions).toHaveLength(2);
    expect(transitions[1].action).toBe("replace");

    act(() => transitions[1].retry());
    expect(window.location.pathname).toBe("/admin/settings");

    unregister();
  });

  it("restores blocked browser back and forward entries without a popstate loop", async () => {
    render(<RouterControls />);
    let shouldBlock = false;
    const transitions: BlockedNavigation[] = [];
    const unregister = registerNavigationBlocker((transition) => {
      if (!shouldBlock) return false;
      transitions.push(transition);
      return true;
    });

    fireEvent.click(screen.getByRole("button", { name: "push" }));
    fireEvent.click(screen.getByRole("button", { name: "push status" }));
    expect(window.location.pathname).toBe("/admin/status");

    shouldBlock = true;

    act(() => window.history.back());

    await waitFor(() => {
      expect(transitions).toHaveLength(1);
      expect(window.location.pathname).toBe("/admin/status");
    });
    expect(transitions[0].action).toBe("pop");
    expect(transitions[0].nextUrl.pathname).toBe("/admin/audit");

    act(() => transitions[0].retry());
    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(transitions).toHaveLength(1);

    act(() => window.history.forward());

    await waitFor(() => {
      expect(transitions).toHaveLength(2);
      expect(window.location.pathname).toBe("/admin/audit");
    });
    expect(transitions[1].nextUrl.pathname).toBe("/admin/status");

    act(() => transitions[1].retry());
    await waitFor(() => expect(window.location.pathname).toBe("/admin/status"));
    expect(transitions).toHaveLength(2);

    unregister();
  });

  it("recovers when a blocked pop restoration lands on an unexpected entry", () => {
    render(<RouterControls />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    fireEvent.click(screen.getByRole("button", { name: "push status" }));
    const navigationSequence = window.history.state
      .__icedrNavigationSequence as string;

    const transitions: BlockedNavigation[] = [];
    const unregister = registerNavigationBlocker((transition) => {
      transitions.push(transition);
      return true;
    });
    vi.spyOn(window.history, "go").mockImplementation(() => undefined);

    act(() => {
      window.history.replaceState(
        {
          __icedrNavigationIndex: 1,
          __icedrNavigationSequence: navigationSequence,
        },
        "",
        "/admin/audit",
      );
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    });
    expect(transitions).toHaveLength(1);

    act(() => {
      window.history.replaceState(
        {
          __icedrNavigationIndex: 0,
          __icedrNavigationSequence: navigationSequence,
        },
        "",
        "/admin/unexpected",
      );
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    });
    expect(screen.getByRole("status", { name: "location" })).toHaveTextContent(
      "/admin/unexpected",
    );

    act(() => {
      window.history.replaceState(
        {
          __icedrNavigationIndex: 1,
          __icedrNavigationSequence: navigationSequence,
        },
        "",
        "/admin/audit",
      );
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    });
    expect(transitions).toHaveLength(2);

    act(() => {
      window.history.replaceState(
        {
          __icedrNavigationIndex: 0,
          __icedrNavigationSequence: navigationSequence,
        },
        "",
        "/admin/unexpected",
      );
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    });
    unregister();
  });
});
