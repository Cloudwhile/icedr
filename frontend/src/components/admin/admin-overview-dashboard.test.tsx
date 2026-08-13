import type { ComponentProps, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type { AdminOverviewResponse } from "@/lib/drive-api";
import { AdminOverviewDashboard } from "./admin-overview-dashboard";

vi.mock("@/components/ui/e-chart", () => ({
  EChart: ({
    ariaLabel,
    option,
  }: {
    ariaLabel: string;
    option: { series?: Array<{ data?: number[]; name?: string }> };
  }) => (
    <div
      aria-label={ariaLabel}
      data-series={JSON.stringify(option.series ?? [])}
      role="img"
    />
  ),
}));

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

const overview: AdminOverviewResponse = {
  audit: {
    dailyTrend: [
      { date: "2026-08-11", failed: 1, total: 3 },
      { date: "2026-08-12", failed: 0, total: 5 },
    ],
    failed: 1,
    recentRiskEvents: [
      {
        action: "auth.login_failed",
        actor: "account",
        actorDisplayName: "Mina",
        actorEmail: "mina@example.com",
        actorUserId: "user-1",
        createdAt: "2026-08-12T03:00:00.000Z",
        id: "event-risk-1",
        ipAddress: "203.0.113.8",
        metadata: {},
        nodeId: null,
        resourceType: "system",
        result: "failed",
        shareToken: null,
        target: "login",
        workspaceId: "workspace-1",
      },
    ],
    resourceDistribution: [
      { resourceType: "file", total: 4 },
      { resourceType: "system", total: 4 },
    ],
    total: 8,
  },
  generatedAt: "2026-08-12T04:00:00.000Z",
  scope: { kind: "workspace", workspaceId: "workspace-1" },
  storage: {
    activeBytes: 1024,
    fileCount: 2,
    folderCount: 1,
    trashBytes: 512,
    trashFileCount: 1,
    usedBytes: 1792,
    versionBytes: 256,
    versionCount: 1,
  },
  window: {
    from: "2026-08-11T00:00:00.000Z",
    to: "2026-08-12T04:00:00.000Z",
  },
  workspaceCount: 1,
};

afterEach(cleanup);

function renderDashboard(
  overrides: Partial<ComponentProps<typeof AdminOverviewDashboard>> = {},
) {
  const props: ComponentProps<typeof AdminOverviewDashboard> = {
    data: overview,
    error: null,
    health: {
      checkedAt: "2026-08-12T04:00:00.000Z",
      checks: [],
      status: "ok",
    },
    healthError: null,
    healthRefreshing: false,
    healthStale: false,
    initialLoading: false,
    lastSuccessfulAt: "2030-01-01T00:00:00.000Z",
    locale: "en",
    onOpenAudit: vi.fn(),
    onOpenStatus: vi.fn(),
    onOpenStorage: vi.fn(),
    onRefresh: vi.fn(),
    palette: palettes.light,
    refreshing: false,
    scope: { kind: "all" },
    stale: false,
    timeZone: "UTC",
    workspaces: [{ id: "workspace-1", name: "North" }],
    ...overrides,
  };
  render(<AdminOverviewDashboard {...props} />);
  return props;
}

describe("AdminOverviewDashboard", () => {
  it("renders server scope metadata and fixed total/failed trend series", () => {
    renderDashboard();

    expect(
      screen.getAllByText(/admin\.scopeWorkspaceOption:name=North/).length,
    ).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("2030");

    const chart = screen.getByRole("img", { name: "admin.activityTrend" });
    const series = JSON.parse(chart.getAttribute("data-series") ?? "[]");
    expect(series.map((item: { data: number[] }) => item.data)).toEqual([
      [3, 5],
      [1, 0],
    ]);
  });

  it("keeps health failures visible inside the independent health module", () => {
    renderDashboard({ healthError: "health-down", healthStale: true });

    expect(screen.getByRole("alert")).toHaveTextContent("health-down");
    expect(screen.getByText("admin.healthStatus.ok")).toBeInTheDocument();
  });

  it("opens audit rows with server-driven filters and exposes storage navigation", () => {
    const onOpenAudit = vi.fn();
    const onOpenStorage = vi.fn();
    renderDashboard({ onOpenAudit, onOpenStorage });

    fireEvent.click(screen.getByRole("button", { name: /auth\.login_failed/ }));
    expect(onOpenAudit).toHaveBeenCalledWith({ query: "event-risk-1" });

    fireEvent.click(screen.getByRole("button", { name: /audit\.resourceFile/ }));
    expect(onOpenAudit).toHaveBeenCalledWith({
      createdFrom: overview.window.from,
      createdTo: overview.window.to,
      resourceType: "file",
    });

    fireEvent.click(screen.getByRole("button", { name: /settings\.storageSpace/ }));
    expect(onOpenStorage).toHaveBeenCalledOnce();
  });
});
