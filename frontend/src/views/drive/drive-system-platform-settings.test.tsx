import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type {
  AuthSettings,
  MailSettings,
  PasskeySettings,
  StorageSettings,
} from "@/lib/drive-api";
import { DriveSystemPlatformSettings } from "./drive-system-platform-settings";

const apiMocks = vi.hoisted(() => ({
  fetchAuthSettings: vi.fn(),
  fetchMailSettings: vi.fn(),
  fetchSiteSettings: vi.fn(),
  fetchTranslationSettings: vi.fn(),
  testMailSettings: vi.fn(),
  testStorageSettings: vi.fn(),
  updateAdminAuthPolicy: vi.fn(),
  updateMailSettings: vi.fn(),
  updateSiteSettings: vi.fn(),
  updateStorageSettings: vi.fn(),
  upsertTranslationBundle: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({ showAppToast: vi.fn() }));
const translationMocks = vi.hoisted(() => ({
  t: (key: string) => key,
}));

type UnsavedRegistration = {
  id: string;
  isDirty: boolean;
  onDiscard: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
};

const unsavedMocks = vi.hoisted(() => ({
  registrations: new Map<string, UnsavedRegistration>(),
}));

vi.mock("@/lib/drive-api", () => ({
  defaultPublicSiteSettings: { authLogoDataUrl: null, siteName: "ICEDR" },
  fetchAuthSettings: apiMocks.fetchAuthSettings,
  fetchMailSettings: apiMocks.fetchMailSettings,
  fetchSiteSettings: apiMocks.fetchSiteSettings,
  fetchTranslationSettings: apiMocks.fetchTranslationSettings,
  getDriveApiErrorMessage: () => "admin.saveFailed",
  testMailSettings: apiMocks.testMailSettings,
  testStorageSettings: apiMocks.testStorageSettings,
  updateAdminAuthPolicy: apiMocks.updateAdminAuthPolicy,
  updateMailSettings: apiMocks.updateMailSettings,
  updateSiteSettings: apiMocks.updateSiteSettings,
  updateStorageSettings: apiMocks.updateStorageSettings,
  upsertTranslationBundle: apiMocks.upsertTranslationBundle,
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => translationMocks.t,
}));

vi.mock("@/components/ui/app-toast-store", () => ({
  showAppToast: toastMocks.showAppToast,
}));

vi.mock("@/components/admin/use-unsaved-changes-section", () => ({
  useUnsavedChangesSection: (registration: UnsavedRegistration) => {
    unsavedMocks.registrations.set(registration.id, registration);
  },
}));

vi.mock("@/components/ui/app-image", () => ({
  AppImage: () => null,
}));

vi.mock("@/components/admin/system-config-block", () => ({
  SettingsFact: () => null,
  SettingsField: ({ children, label }: { children: ReactNode; label: string }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  SystemBlockActions: ({ children }: { children: ReactNode }) => <>{children}</>,
  SystemConfigBlock: ({
    actions,
    children,
    title,
  }: {
    actions?: ReactNode;
    children: ReactNode;
    title: string;
  }) => (
    <section aria-label={title}>
      {actions}
      {children}
    </section>
  ),
}));

vi.mock("@/components/ui/app-input", () => ({
  AppInput: ({ palette: _palette, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { palette: unknown }) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/app-select", () => ({
  AppSelect: ({
    options,
    palette: _palette,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & {
    options: Array<{ label: string; value: string }>;
    palette: unknown;
  }) => (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("./auth-form-primitives", () => ({
  AuthField: ({ children, label }: { children: ReactNode; label: string }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  AuthInput: ({
    invalid: _invalid,
    palette: _palette,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    invalid?: boolean;
    palette: unknown;
  }) => <input {...props} />,
}));

vi.mock("./drive-primitives", () => ({
  LocalIcon: () => null,
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

vi.mock("./external-share-admin-primitives", () => ({
  PolicyCheck: ({
    checked,
    label,
    onToggle,
  }: {
    checked: boolean;
    label: string;
    onToggle: () => void;
  }) => (
    <button aria-pressed={checked} onClick={onToggle} type="button">
      {label}
    </button>
  ),
  SettingStatusLine: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./drive-system-platform-sections", () => ({
  PlatformDeliverySection: ({
    mail,
    onMailChange,
    onSave,
    onTest,
  }: {
    mail: MailSettings;
    onMailChange: (patch: Partial<MailSettings>) => void;
    onSave: () => void;
    onTest: () => void;
  }) => (
    <section>
      <output data-testid="mail-host">{mail.host}</output>
      <button onClick={() => onMailChange({ host: "smtp.draft.test" })} type="button">
        edit-mail
      </button>
      <button onClick={onSave} type="button">
        save-mail
      </button>
      <button onClick={onTest} type="button">
        test-mail
      </button>
    </section>
  ),
  PlatformStorageSection: () => null,
}));

const initialAuth: AuthSettings = {
  localEnabled: true,
  minimumAuthenticationMethods: 1,
  oauthConfigured: false,
  oauthEnabled: false,
  passkeyConfigured: true,
  passkeyEnabled: true,
  updatedAt: "2026-08-12T00:00:00.000Z",
};

const initialPasskey: PasskeySettings = {
  origin: "https://files.example.com",
  rpId: "files.example.com",
  rpName: "ICEDR",
};

const initialMail: MailSettings = {
  configured: true,
  enabled: true,
  fromEmail: "noreply@example.com",
  fromName: "ICEDR",
  host: "smtp.example.com",
  passwordConfigured: true,
  port: 587,
  replyTo: "",
  secure: false,
  username: "mailer",
  verifiedAt: null,
};

const storageSettings: StorageSettings = {
  accessKeyId: "",
  bucket: "",
  distributedStorageEnabled: false,
  endpoint: "",
  forcePathStyle: true,
  localRoot: "data/local-files",
  objectStorageConfigured: false,
  physicalAvailableBytes: 1_000,
  physicalCapacityBytes: 2_000,
  physicalCapacityCheckedAt: "2026-08-12T00:00:00.000Z",
  physicalCapacityKnown: true,
  physicalCapacityReason: null,
  physicalQuotaLimitBytes: 1_000,
  quotaBytes: null,
  region: "",
  secretAccessKeyConfigured: false,
  storageProvider: "local",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

function renderSettings() {
  return render(
    <DriveSystemPlatformSettings
      onStorageSettingsUpdated={vi.fn()}
      palette={palettes.light}
      storageSettings={storageSettings}
    />,
  );
}

async function waitForInitialSettings() {
  await waitFor(() => expect(apiMocks.fetchAuthSettings).toHaveBeenCalledOnce());
  await waitFor(() => expect(apiMocks.fetchSiteSettings).toHaveBeenCalledOnce());
}

beforeEach(() => {
  vi.clearAllMocks();
  unsavedMocks.registrations.clear();
  apiMocks.fetchAuthSettings.mockResolvedValue(initialAuth);
  apiMocks.fetchSiteSettings.mockResolvedValue({
    passkey: initialPasskey,
    site: { authLogoDataUrl: null, siteName: "ICEDR" },
  });
  apiMocks.fetchMailSettings.mockResolvedValue(initialMail);
  apiMocks.fetchTranslationSettings.mockResolvedValue({ bundles: [] });
});

afterEach(cleanup);

describe("DriveSystemPlatformSettings", () => {
  it("saves auth and a changed Passkey through one atomic policy request", async () => {
    const nextPasskey = { ...initialPasskey, rpName: "ICEDR Cloud" };
    apiMocks.updateAdminAuthPolicy.mockResolvedValue({
      auth: { ...initialAuth, updatedAt: "2026-08-12T00:01:00.000Z" },
      passkey: nextPasskey,
    });
    renderSettings();
    await waitForInitialSettings();

    fireEvent.click(screen.getByRole("button", { name: "admin.platformAccess" }));
    fireEvent.change(screen.getByLabelText("admin.rpName"), {
      target: { value: nextPasskey.rpName },
    });
    const saveButton = screen
      .getAllByRole("button", { name: "admin.save" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);

    await waitFor(() =>
      expect(apiMocks.updateAdminAuthPolicy).toHaveBeenCalledWith({
        auth: {
          localEnabled: true,
          minimumAuthenticationMethods: 1,
          oauthEnabled: false,
          passkeyEnabled: true,
        },
        passkey: nextPasskey,
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("admin.rpName")).toHaveValue("ICEDR Cloud"),
    );
  });

  it("reloads authoritative auth and Passkey values after an atomic save failure", async () => {
    const authoritativeAuth = {
      ...initialAuth,
      passkeyEnabled: false,
      updatedAt: "2026-08-12T00:02:00.000Z",
    };
    const authoritativePasskey = { ...initialPasskey, rpName: "Server value" };
    apiMocks.fetchAuthSettings
      .mockResolvedValueOnce(initialAuth)
      .mockResolvedValueOnce(authoritativeAuth);
    apiMocks.fetchSiteSettings
      .mockResolvedValueOnce({
        passkey: initialPasskey,
        site: { authLogoDataUrl: null, siteName: "ICEDR" },
      })
      .mockResolvedValueOnce({
        passkey: authoritativePasskey,
        site: { authLogoDataUrl: null, siteName: "ICEDR" },
      });
    apiMocks.updateAdminAuthPolicy.mockRejectedValue(new Error("conflict"));
    renderSettings();
    await waitForInitialSettings();

    fireEvent.click(screen.getByRole("button", { name: "admin.platformAccess" }));
    fireEvent.change(screen.getByLabelText("admin.rpName"), {
      target: { value: "Unsaved value" },
    });
    const saveButton = screen
      .getAllByRole("button", { name: "admin.save" })
      .find((button) => !button.hasAttribute("disabled"));
    fireEvent.click(saveButton!);

    await waitFor(() =>
      expect(screen.getByLabelText("admin.rpName")).toHaveValue("Server value"),
    );
    expect(apiMocks.fetchAuthSettings).toHaveBeenCalledTimes(2);
    expect(apiMocks.fetchSiteSettings).toHaveBeenCalledTimes(2);
  });

  it("does not submit an unconfigured disabled Passkey draft with unrelated auth changes", async () => {
    const authWithoutPasskey: AuthSettings = {
      ...initialAuth,
      oauthConfigured: true,
      oauthEnabled: true,
      passkeyConfigured: false,
      passkeyEnabled: false,
    };
    const emptyPasskey: PasskeySettings = { origin: "", rpId: "", rpName: "" };
    apiMocks.fetchAuthSettings.mockResolvedValue(authWithoutPasskey);
    apiMocks.fetchSiteSettings.mockResolvedValue({
      passkey: emptyPasskey,
      site: { authLogoDataUrl: null, siteName: "ICEDR" },
    });
    apiMocks.updateAdminAuthPolicy.mockResolvedValue({
      auth: { ...authWithoutPasskey, localEnabled: false },
      passkey: emptyPasskey,
    });
    renderSettings();
    await waitForInitialSettings();

    fireEvent.click(screen.getByRole("button", { name: "admin.platformAccess" }));
    fireEvent.click(screen.getByRole("button", { name: "admin.localAuth" }));
    const saveButton = screen
      .getAllByRole("button", { name: "admin.save" })
      .find((button) => !button.hasAttribute("disabled"));
    fireEvent.click(saveButton!);

    await waitFor(() => expect(apiMocks.updateAdminAuthPolicy).toHaveBeenCalledOnce());
    expect(apiMocks.updateAdminAuthPolicy).toHaveBeenCalledWith({
      auth: {
        localEnabled: false,
        minimumAuthenticationMethods: 1,
        oauthEnabled: true,
        passkeyEnabled: false,
      },
    });
  });

  it("blocks a mail test while the mail draft is dirty without saving it", async () => {
    renderSettings();
    await waitForInitialSettings();
    fireEvent.click(screen.getByRole("button", { name: "admin.platformDelivery" }));
    fireEvent.click(screen.getByRole("button", { name: "edit-mail" }));
    fireEvent.click(screen.getByRole("button", { name: "test-mail" }));

    expect(apiMocks.updateMailSettings).not.toHaveBeenCalled();
    expect(apiMocks.testMailSettings).not.toHaveBeenCalled();
    expect(toastMocks.showAppToast).toHaveBeenCalledWith({
      title: "admin.mailTestRequiresSavedSettings",
      tone: "error",
    });
  });

  it("registers all platform drafts with a rejecting save and server-value discard", async () => {
    apiMocks.updateMailSettings.mockRejectedValue(new Error("mail unavailable"));
    renderSettings();
    await waitForInitialSettings();
    fireEvent.click(screen.getByRole("button", { name: "admin.platformDelivery" }));
    fireEvent.click(screen.getByRole("button", { name: "edit-mail" }));

    await waitFor(() =>
      expect(unsavedMocks.registrations.get("system-platform")?.isDirty).toBe(true),
    );
    const registration = unsavedMocks.registrations.get("system-platform");
    expect(registration).toBeDefined();
    await expect(registration!.onSave()).rejects.toThrow(
      "mail unavailable",
    );
    expect(apiMocks.updateMailSettings).toHaveBeenCalledOnce();

    act(() => registration!.onDiscard());
    expect(screen.getByTestId("mail-host")).toHaveTextContent("smtp.example.com");
  });
});
