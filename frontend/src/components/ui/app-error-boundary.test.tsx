import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootI18nProvider } from "@/components/i18n/root-i18n-provider";
import { AppErrorBoundary } from "./app-error-boundary";
import {
  hardNavigateHome,
  hardReloadPage,
} from "./app-error-boundary-navigation";

const privateErrorDetail = "private storage path: /srv/icedr/object.bin";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error(privateErrorDetail);
  return <p>Recovered content</p>;
}

beforeEach(() => {
  window.localStorage.setItem("icedr.ui.locale", "en");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("renders a redacted alert and exposes icon-only recovery actions", () => {
    const reloadPage = vi.fn();
    const navigateHome = vi.fn();

    render(
      <RootI18nProvider>
        <AppErrorBoundary
          navigateHome={navigateHome}
          reloadPage={reloadPage}
        >
          <ThrowingChild shouldThrow />
        </AppErrorBoundary>
      </RootI18nProvider>,
    );

    expect(
      screen.getByRole("alert", { name: "This view could not be displayed" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(privateErrorDetail)).not.toBeInTheDocument();

    const reloadButton = screen.getByRole("button", { name: "Reload page" });
    const homeButton = screen.getByRole("button", { name: "Return home" });
    expect(reloadButton).not.toHaveTextContent("Reload page");
    expect(homeButton).not.toHaveTextContent("Return home");

    fireEvent.click(reloadButton);
    fireEvent.click(homeButton);
    expect(reloadPage).toHaveBeenCalledOnce();
    expect(navigateHome).toHaveBeenCalledOnce();
  });

  it("resets after a reset key changes", () => {
    const view = render(
      <RootI18nProvider>
        <AppErrorBoundary resetKeys={["failed"]}>
          <ThrowingChild shouldThrow />
        </AppErrorBoundary>
      </RootI18nProvider>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    view.rerender(
      <RootI18nProvider>
        <AppErrorBoundary resetKeys={["recovered"]}>
          <ThrowingChild shouldThrow={false} />
        </AppErrorBoundary>
      </RootI18nProvider>,
    );

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses browser reload and assignment for hard navigation", () => {
    const reload = vi.fn();
    const assign = vi.fn();

    hardReloadPage({ reload });
    hardNavigateHome({ assign });

    expect(reload).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith("/");
  });
});
