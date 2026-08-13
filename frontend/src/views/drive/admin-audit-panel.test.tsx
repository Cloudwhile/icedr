import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ADMIN_AUDIT_FILTERS } from "@/features/admin/admin-scope";
import { palettes } from "@/features/file/model";
import type {
  AdminAuditEventsResponse,
  AdminAuditFilters,
} from "@/lib/drive-api";
import { AdminAuditPanel } from "./admin-audit-panel";

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en",
  useTimeZone: () => "UTC",
  useTranslations: () => (
    key: string,
    values?: Record<string, string | number>,
  ) =>
    Object.entries(values ?? {}).reduce(
      (message, [name, value]) => `${message}:${name}=${value}`,
      key,
    ),
}));

vi.mock("@/components/common/ui/loading-state", () => ({
  LdrsLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/components/ui/app-input", () => ({
  AppInput: ({ palette: _palette, ...props }: InputHTMLAttributes<HTMLInputElement> & { palette: unknown }) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/app-select", () => ({
  AppSelect: ({ options, palette: _palette, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
    options: Array<{ label: string; value: string }>;
    palette: unknown;
  }) => (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/ui/app-icon", () => ({
  LocalIcon: () => null,
}));

vi.mock("@/components/ui/status-pill", () => ({
  StatusPill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/tool-button", () => ({
  ToolButton: ({
    children,
    disabled,
    label,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    label: string;
    onClick?: () => void;
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/app-pagination", () => ({
  AppPagination: () => null,
}));

const data: AdminAuditEventsResponse = {
  facets: {
    actions: ["file.moved", "share.viewed"],
    actors: ["account", "system"],
  },
  generatedAt: "2026-08-12T04:00:00.000Z",
  items: [
    {
      action: "file.moved",
      actor: "account",
      actorDisplayName: "Mina",
      actorEmail: "mina@example.com",
      actorUserId: "user-1",
      createdAt: "2026-08-12T03:00:00.000Z",
      id: "event-1",
      ipAddress: "203.0.113.8",
      metadata: {},
      nodeId: "node-1",
      resourceType: "file",
      result: "success",
      shareToken: null,
      target: "Quarterly report.pdf",
      workspaceId: "workspace-1",
    },
  ],
  limit: 50,
  offset: 0,
  scope: { kind: "all" },
  summary: { failed: 0, success: 1 },
  total: 1,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPanel(
  filters: AdminAuditFilters = DEFAULT_ADMIN_AUDIT_FILTERS,
  onFiltersChange = vi.fn(),
  panelData: AdminAuditEventsResponse = data,
) {
  render(
    <AdminAuditPanel
      data={panelData}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onRefresh={vi.fn()}
      palette={palettes.light}
      scope={{ kind: "all" }}
    />,
  );
  return onFiltersChange;
}

describe("AdminAuditPanel server-driven filtering", () => {
  it("uses server facets and resets offset when a select filter changes", () => {
    const onFiltersChange = renderPanel(
      { ...DEFAULT_ADMIN_AUDIT_FILTERS, offset: 150 },
      vi.fn(),
    );
    const actorSelect = screen.getByRole("combobox", { name: "audit.actor" });

    expect(actorSelect).toHaveTextContent("audit.actors.system");
    fireEvent.change(actorSelect, { target: { value: "system" } });

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...DEFAULT_ADMIN_AUDIT_FILTERS,
      actor: "system",
      offset: 0,
    });
  });

  it("debounces keyword and IP changes together for 300ms", () => {
    vi.useFakeTimers();
    const onFiltersChange = renderPanel(
      { ...DEFAULT_ADMIN_AUDIT_FILTERS, offset: 100 },
      vi.fn(),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "audit.keyword" }), {
      target: { value: "quarterly" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "audit.ipAddress" }), {
      target: { value: "203.0.113" },
    });
    act(() => vi.advanceTimersByTime(299));
    expect(onFiltersChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onFiltersChange).toHaveBeenCalledOnce();
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...DEFAULT_ADMIN_AUDIT_FILTERS,
      ipAddress: "203.0.113",
      offset: 0,
      query: "quarterly",
    });
  });

  it("renders server items even when the controlled query does not match locally", () => {
    renderPanel({
      ...DEFAULT_ADMIN_AUDIT_FILTERS,
      query: "does-not-match-mina",
    });

    expect(screen.getByText("Mina")).toBeInTheDocument();
    expect(screen.getAllByText("Quarterly report.pdf").length).toBeGreaterThan(0);
  });

  it("does not render share tokens or node identifiers in audit rows", () => {
    const secret = "share-secret-token";
    renderPanel(DEFAULT_ADMIN_AUDIT_FILTERS, vi.fn(), {
      ...data,
      facets: {
        actions: ["future.legitimate_historical_event"],
        actors: ["account"],
      },
      items: [
        {
          ...data.items[0],
          action: "future.legitimate_historical_event",
          actorDisplayName: "Smoke Admin",
          actorEmail: "admin@example.com",
          metadata: { filename: secret, identityType: "ica" },
          nodeId: "node-secret-id",
          resourceType: "file",
          shareToken: secret,
          target: secret,
        },
      ],
    });

    expect(
      screen.getAllByText("future.legitimate_historical_event").length,
    ).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain("node-secret-id");
  });
});
