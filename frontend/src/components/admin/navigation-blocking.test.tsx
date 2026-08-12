import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerNavigationBlocker,
  useRouter,
  type BlockedNavigation,
} from "@/compat/navigation";

function RouterControls() {
  const router = useRouter();

  return (
    <div>
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
  it("keeps ordinary compat navigation unchanged when no blocker is registered", () => {
    render(<RouterControls />);

    fireEvent.click(screen.getByRole("button", { name: "push" }));

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/admin/audit?scope=all",
    );
    expect(window.history.state).toBeNull();
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
});
