import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";
import { useRouter } from "@/compat/navigation";
import { palettes } from "@/features/file/model";
import type { OAuthSettings } from "@/lib/drive-api";
import { OAuthAdminSettingsPage } from "./drive-oauth-admin-settings";

const driveApi = vi.hoisted(() => ({
  activateOAuthProvider: vi.fn(),
  createOAuthProvider: vi.fn(),
  deleteOAuthProvider: vi.fn(),
  fetchAuthSettings: vi.fn(),
  fetchOAuthProviders: vi.fn(),
  getDriveApiErrorMessage: vi.fn(() => "api-error"),
  testOAuthProvider: vi.fn(),
  updateAuthSettings: vi.fn(),
  updateOAuthProvider: vi.fn(),
}));

vi.mock("@/lib/drive-api", () => driveApi);

vi.mock("@/components/common/ui/loading-state", () => ({
  LdrsLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/components/oauth/oauth-admin-parts", () => ({
  OAuthProviderGroup: ({
    onEdit,
    providers,
  }: {
    onEdit: (provider: OAuthSettings) => void;
    providers: OAuthSettings[];
  }) => providers[0] ? (
    <button onClick={() => onEdit(providers[0])}>edit-provider</button>
  ) : null,
  OAuthSummary: () => null,
}));

vi.mock("@/components/oauth/oauth-provider-dialog", () => ({
  OAuthProviderDialog: ({
    draft,
    onDraftChange,
    onSecretChange,
    secret,
  }: {
    draft: OAuthSettings;
    onDraftChange: (draft: OAuthSettings) => void;
    onSecretChange: (secret: string) => void;
    secret: string;
  }) => (
    <div aria-label="oauth-editor" role="dialog">
      <input
        aria-label="oauth-draft"
        onChange={(event) =>
          onDraftChange({ ...draft, displayName: event.target.value })
        }
        value={draft.displayName}
      />
      <input
        aria-label="oauth-secret"
        onChange={(event) => onSecretChange(event.target.value)}
        value={secret}
      />
    </div>
  ),
}));

vi.mock("@/components/ui/app-dialog-shell", () => ({
  AppDialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AppDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AppDialogShell: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  AppDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/app-icon", () => ({ LocalIcon: () => null }));
vi.mock("@/components/ui/tool-button", () => ({
  ToolButton: ({
    children,
    disabled,
    isPending,
    label,
    onClick,
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    isPending?: boolean;
    label: string;
  }) => (
    <button
      aria-label={label}
      disabled={disabled || isPending}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/app-input", () => ({
  AppInput: ({ palette: _palette, ...props }: InputHTMLAttributes<HTMLInputElement> & { palette: unknown }) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/app-select", () => ({
  AppSelect: ({
    options,
    palette: _palette,
    ...props
  }: SelectHTMLAttributes<HTMLSelectElement> & {
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

vi.mock("@/components/ui/confirmation-dialog", () => ({
  ConfirmationDialog: () => null,
}));

vi.mock("@/components/ui/app-toast-store", () => ({
  showAppToast: vi.fn(),
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./drive-primitives", () => ({
  LocalIcon: () => null,
  StatusPill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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

const labels = {
  cancel: "Cancel navigation",
  description: "Unsaved settings",
  discard: "Discard navigation",
  save: "Save navigation",
  saveFailed: "Save failed",
  title: "Unsaved changes",
};

const provider: OAuthSettings = {
  allowedEmailDomains: [],
  allowSignup: true,
  audience: "",
  authorizationUrl: "",
  clientId: "client-1",
  clientSecretConfigured: true,
  configured: true,
  createdAt: "2026-08-12T00:00:00.000Z",
  displayName: "Server Provider",
  enabled: false,
  id: "oauth-1",
  issuerUrl: "https://issuer.example",
  linkByVerifiedEmail: true,
  providerKey: "oidc",
  providerMode: "standard",
  providerProfile: "oidc",
  redirectUri: "https://app.example/callback",
  requireVerifiedEmail: true,
  scopes: "openid email",
  tokenUrl: "",
  updatedAt: "2026-08-12T00:00:00.000Z",
  userinfoUrl: "",
};

function NavigateButton() {
  const router = useRouter();
  return <button onClick={() => router.push("/admin/audit")}>navigate</button>;
}

function renderPage() {
  return render(
    <AdminUnsavedChangesProvider labels={labels} palette={palettes.light}>
      <OAuthAdminSettingsPage palette={palettes.light} />
      <NavigateButton />
    </AdminUnsavedChangesProvider>,
  );
}

async function openEditor() {
  fireEvent.click(await screen.findByText("edit-provider"));
  return {
    draft: screen.getByRole("textbox", { name: "oauth-draft" }),
    secret: screen.getByRole("textbox", { name: "oauth-secret" }),
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/system/oauth?scope=system");
  driveApi.fetchAuthSettings.mockResolvedValue({
    localEnabled: true,
    minimumAuthenticationMethods: 1,
    oauthConfigured: true,
    oauthEnabled: true,
    passkeyConfigured: false,
    passkeyEnabled: false,
    updatedAt: provider.updatedAt,
  });
  driveApi.fetchOAuthProviders.mockResolvedValue({
    activeProvider: null,
    configured: true,
    providers: [provider],
  });
  driveApi.updateOAuthProvider.mockImplementation(
    async (_id: string, input: Partial<OAuthSettings>) => ({
      ...provider,
      ...input,
      updatedAt: "2026-08-12T01:00:00.000Z",
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OAuthAdminSettingsPage unsaved editor", () => {
  it("registers secret-only changes and keeps them when navigation is cancelled", async () => {
    renderPage();
    const { secret } = await openEditor();
    fireEvent.change(secret, { target: { value: "draft-secret" } });
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByRole("button", { name: labels.cancel }));

    expect(window.location.pathname).toBe("/admin/system/oauth");
    expect(secret).toHaveValue("draft-secret");
    expect(driveApi.updateOAuthProvider).not.toHaveBeenCalled();
  });

  it("restores the latest server editor value when navigation discards", async () => {
    renderPage();
    const { draft, secret } = await openEditor();
    fireEvent.change(draft, { target: { value: "Draft Provider" } });
    fireEvent.change(secret, { target: { value: "draft-secret" } });
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByRole("button", { name: labels.discard }));

    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(draft).toHaveValue("Server Provider");
    expect(secret).toHaveValue("");
    expect(driveApi.updateOAuthProvider).not.toHaveBeenCalled();
  });

  it("persists draft and secret before navigation continues", async () => {
    renderPage();
    const { draft, secret } = await openEditor();
    fireEvent.change(draft, { target: { value: "Saved Provider" } });
    fireEvent.change(secret, { target: { value: "saved-secret" } });
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByRole("button", { name: labels.save }));

    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(driveApi.updateOAuthProvider).toHaveBeenCalledWith(
      "oauth-1",
      expect.objectContaining({
        clientSecret: "saved-secret",
        displayName: "Saved Provider",
      }),
    );
  });
});
