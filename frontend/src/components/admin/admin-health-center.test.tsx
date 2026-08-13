import type { ComponentProps, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type { AdminHealthResponse } from "@/lib/drive-api";
import { AdminHealthCenter } from "./admin-health-center";

vi.mock("@/components/ui/app-icon", () => ({
  LocalIcon: () => null,
}));

vi.mock("@/components/ui/tool-button", () => ({
  ToolButton: ({
    children,
    label,
    onClick,
  }: {
    children: ReactNode;
    label: string;
    onClick?: () => void;
  }) => (
    <button aria-label={label} onClick={onClick} type="button">
      {children}
    </button>
  ),
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (
    key: string,
    values?: Record<string, string | number>,
  ) =>
    Object.entries(values ?? {}).reduce(
      (message, [name, value]) => `${message}:${name}=${value}`,
      key,
    ),
}));

const health: AdminHealthResponse = {
  checkedAt: "2026-08-12T04:00:00.000Z",
  checks: [
    {
      checkedAt: "2026-08-12T04:00:00.000Z",
      durationMs: 18,
      id: "storage",
      reason: "capacity unavailable",
      settingsPath: "/admin/system/storage",
      status: "warning",
    },
  ],
  status: "warning",
};

afterEach(cleanup);

function renderHealth(
  overrides: Partial<ComponentProps<typeof AdminHealthCenter>> = {},
) {
  const props: ComponentProps<typeof AdminHealthCenter> = {
    data: health,
    error: null,
    initialLoading: false,
    lastSuccessfulAt: "2030-01-01T00:00:00.000Z",
    locale: "en",
    onOpenSettings: vi.fn(),
    onRetry: vi.fn(),
    palette: palettes.light,
    refreshing: false,
    stale: false,
    timeZone: "UTC",
    ...overrides,
  };
  const { container } = render(<AdminHealthCenter {...props} />);
  return { container, props };
}

describe("AdminHealthCenter", () => {
  it("renders placeholders without pretending an unchecked module took zero ms", () => {
    const { container } = renderHealth({
      data: null,
      initialLoading: true,
      lastSuccessfulAt: null,
    });

    expect(container.querySelector("section")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByText("admin.healthCheckedAt:time=app.loading"),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("duration=0");
  });

  it("uses the server check timestamp and exposes retry and related settings", () => {
    const { props } = renderHealth({ error: "health-offline", stale: true });

    expect(screen.getByRole("alert")).toHaveTextContent("health-offline");
    expect(document.body).not.toHaveTextContent("2030");
    expect(screen.getByText("capacity unavailable")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "admin.openRelatedSettings" }),
    );
    expect(props.onOpenSettings).toHaveBeenCalledWith(
      "/admin/system/storage",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "admin.retryHealthCheck:check=admin.healthCheck.storage",
      }),
    );
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
});
