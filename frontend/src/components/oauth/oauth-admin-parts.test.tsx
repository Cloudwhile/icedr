import type { ComponentProps, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthProviderTemplate } from "@/extensions/oauth/provider-catalog";
import { palettes } from "@/features/file/model";
import { OAuthProviderGroup } from "./oauth-admin-parts";

vi.mock("@/components/ui/oauth-provider-mark", () => ({ OAuthProviderMark: () => null }));
vi.mock("@/i18n/react", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/views/drive/drive-primitives", () => ({
  LocalIcon: () => null,
  StatusPill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ToolButton: ({ children, disabled, label, onClick }: { children: ReactNode; disabled?: boolean; label: string; onClick?: () => void }) => (
    <button aria-label={label} disabled={disabled} onClick={onClick} type="button">{children}</button>
  ),
}));

afterEach(cleanup);

function renderGroup(overrides: Partial<ComponentProps<typeof OAuthProviderGroup>> = {}) {
  const props: ComponentProps<typeof OAuthProviderGroup> = {
    collapsed: false,
    onActivate: vi.fn(),
    onCopy: vi.fn(),
    onCreate: vi.fn(),
    onDeactivate: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onEdit: vi.fn(),
    onToggle: vi.fn(),
    palette: palettes.light,
    providers: [],
    savingKey: null,
    template: getOAuthProviderTemplate("google"),
    ...overrides,
  };
  render(<OAuthProviderGroup {...props} />);
  return props;
}

describe("OAuthProviderGroup empty actions", () => {
  it("offers creation inside the empty table cell", () => {
    const props = renderGroup();
    const cell = screen.getByRole("cell");

    fireEvent.click(within(cell).getByRole("button", { name: "admin.oauthAddProvider" }));

    expect(props.onCreate).toHaveBeenCalledOnce();
  });

  it("clears filters for an unmatched group and never creates a provider", () => {
    const onResetFilters = vi.fn();
    const props = renderGroup({ onResetFilters });

    fireEvent.click(screen.getByRole("button", { name: "audit.resetFilters" }));

    expect(onResetFilters).toHaveBeenCalledOnce();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("does not allow creation while another provider operation is pending", () => {
    const props = renderGroup({ savingKey: "refresh" });
    const button = screen.getByRole("button", { name: "admin.oauthAddProvider" });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});
