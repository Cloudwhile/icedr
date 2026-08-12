import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";
import { useRouter } from "@/compat/navigation";
import { palettes } from "@/features/file/model";
import type { WorkspaceShareSettings } from "@/lib/drive-api";
import { ExternalShareAdminSettingsPage } from "./external-share-admin-settings";

const driveApi = vi.hoisted(() => ({
  fetchAuthSettings: vi.fn(),
  fetchWorkspaceShareSettings: vi.fn(),
  updateWorkspaceShareSettings: vi.fn(),
}));

vi.mock("@/lib/drive-api", () => driveApi);

vi.mock("@heroui/react", () => ({
  TextArea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/components/ui/motion", () => ({
  MotionPresence: ({ children, show }: { children: ReactNode; show: boolean }) =>
    show ? children : null,
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

vi.mock("@/components/ui/app-toast-store", () => ({
  showAppToast: vi.fn(),
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./drive-shell", () => ({ ThemeActions: () => null }));
vi.mock("./drive-primitives", () => ({
  LocalIcon: () => null,
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

vi.mock("./external-share-admin-primitives", () => ({
  AdminSection: ({ children, title }: { children: ReactNode; title: string }) => (
    <section><h2>{title}</h2>{children}</section>
  ),
  IdentityPolicyRow: () => null,
  InlineConfigPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PolicyCheck: ({
    checked,
    label,
    onToggle,
  }: {
    checked: boolean;
    label: string;
    onToggle: () => void;
  }) => <button aria-pressed={checked} onClick={onToggle}>{label}</button>,
  PolicyInput: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  RadioRow: ({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) => (
    <button aria-pressed={active} onClick={onClick}>{label}</button>
  ),
  SettingActionBar: ({
    canReset,
    canSave,
    onReset,
    onSave,
    resetLabel,
    saveLabel,
  }: {
    canReset: boolean;
    canSave: boolean;
    onReset?: () => void;
    onSave: () => void;
    resetLabel: string;
    saveLabel: string;
  }) => (
    <div>
      <button disabled={!canReset} onClick={onReset}>{resetLabel}</button>
      <button disabled={!canSave} onClick={onSave}>{saveLabel}</button>
    </div>
  ),
  SettingItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingStatusLine: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const labels = {
  cancel: "Cancel navigation",
  description: "Unsaved settings",
  discard: "Discard navigation",
  save: "Save navigation",
  saveFailed: "Save failed",
  title: "Unsaved changes",
};

const serverSettings: WorkspaceShareSettings = {
  allowPermanent: false,
  allowedDomains: ["old.example"],
  anonymousAccess: "email-required",
  audit: {
    alerts: true,
    anomaly: true,
    downloads: true,
    ip: true,
    userAgent: true,
  },
  defaultExpiresDays: 7,
  emailRule: "domains",
  maxExpiresDays: 30,
  updatedAt: "2026-08-12T00:00:00.000Z",
  workspaceId: "workspace-1",
};

function NavigateButton() {
  const router = useRouter();
  return <button onClick={() => router.push("/admin/audit")}>navigate</button>;
}

function renderGuardedPage() {
  return render(
    <AdminUnsavedChangesProvider labels={labels} palette={palettes.light}>
      <ExternalShareAdminSettingsPage
        embedded
        setThemeMode={vi.fn()}
        themeMode="light"
        workspaceId="workspace-1"
      />
      <NavigateButton />
    </AdminUnsavedChangesProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/system/external-share?workspace=workspace-1");
  driveApi.fetchAuthSettings.mockResolvedValue({
    localEnabled: true,
    minimumAuthenticationMethods: 1,
    oauthConfigured: false,
    oauthEnabled: false,
    passkeyConfigured: false,
    passkeyEnabled: false,
    updatedAt: serverSettings.updatedAt,
  });
  driveApi.fetchWorkspaceShareSettings.mockResolvedValue(serverSettings);
  driveApi.updateWorkspaceShareSettings.mockImplementation(
    async (workspaceId: string, input: Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt">) => ({
      ...input,
      updatedAt: "2026-08-12T01:00:00.000Z",
      workspaceId,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExternalShareAdminSettingsPage", () => {
  it("does not request settings when no explicit workspace scope exists", async () => {
    render(
      <ExternalShareAdminSettingsPage
        embedded
        setThemeMode={vi.fn()}
        themeMode="light"
        workspaceId={null}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "admin.externalShareWorkspaceScopeRequired",
    );
    await Promise.resolve();
    expect(driveApi.fetchWorkspaceShareSettings).not.toHaveBeenCalled();
    expect(driveApi.fetchAuthSettings).not.toHaveBeenCalled();
  });

  it("keeps the draft when navigation is cancelled", async () => {
    renderGuardedPage();
    const domains = await screen.findByRole("textbox", { name: "admin.specifiedDomains" });
    fireEvent.change(domains, { target: { value: "draft.example" } });
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByRole("button", { name: labels.cancel }));

    expect(window.location.pathname).toBe("/admin/system/external-share");
    expect(domains).toHaveValue("draft.example");
    expect(driveApi.updateWorkspaceShareSettings).not.toHaveBeenCalled();
  });

  it("restores the latest server domains when navigation discards", async () => {
    renderGuardedPage();
    const domains = await screen.findByRole("textbox", { name: "admin.specifiedDomains" });
    fireEvent.change(domains, { target: { value: "draft.example" } });
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByRole("button", { name: labels.discard }));

    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(domains).toHaveValue("old.example");
    expect(driveApi.updateWorkspaceShareSettings).not.toHaveBeenCalled();
  });

  it("persists the domain draft before navigation continues", async () => {
    renderGuardedPage();
    const domains = await screen.findByRole("textbox", { name: "admin.specifiedDomains" });
    fireEvent.change(domains, { target: { value: "new.example" } });
    fireEvent.click(screen.getByText("navigate"));
    fireEvent.click(screen.getByRole("button", { name: labels.save }));

    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(driveApi.updateWorkspaceShareSettings).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        allowedDomains: ["new.example"],
        emailRule: "domains",
      }),
    );
  });
});
