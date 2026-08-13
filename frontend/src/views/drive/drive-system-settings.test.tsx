import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnsavedChangesContext,
  createUnsavedChangesStore,
} from "@/components/admin/unsaved-changes-context";
import { palettes } from "@/features/file/model";
import type {
  FilePolicySettings,
  StorageSettings,
  StorageUsage,
} from "@/lib/drive-api";
import type { QuotaDraftState } from "./drive-system-settings-helpers";
import { DriveSystemSettings } from "./drive-system-settings";

const api = vi.hoisted(() => ({
  fetchFilePolicySettings: vi.fn(),
  fetchStorageSettings: vi.fn(),
  fetchStorageUsage: vi.fn(),
  fetchStorageUsageBreakdown: vi.fn(),
  updateAdminStoragePolicy: vi.fn(),
  updateFilePolicySettings: vi.fn(),
  updateUserStorageQuota: vi.fn(),
}));

const toast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/drive-api", () => api);
vi.mock("@/components/ui/app-toast-store", () => ({ showAppToast: toast }));
vi.mock("@/i18n/react", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate };
});
vi.mock("./drive-system-platform-settings", () => ({
  DriveSystemPlatformSettings: () => null,
}));
vi.mock("./drive-system-settings-sections", () => ({
  StoragePolicySection: ({
    onQuotaValueChange,
    onSaveQuota,
    quotaDraft,
  }: {
    onQuotaValueChange: (value: string) => void;
    onSaveQuota: () => void;
    quotaDraft: QuotaDraftState;
  }) => (
    <div>
      <span data-testid="quota-draft">{quotaDraft.value}</span>
      <button onClick={() => onQuotaValueChange("2")} type="button">
        edit quota
      </button>
      <button onClick={onSaveQuota} type="button">
        save quota
      </button>
    </div>
  ),
  LifecyclePolicySection: ({
    onPolicyChange,
    onSavePolicy,
    policy,
  }: {
    onPolicyChange: (policy: FilePolicySettings) => void;
    onSavePolicy: () => void;
    policy: FilePolicySettings;
  }) => (
    <div>
      <span data-testid="retention-days">{policy.trashRetentionDays}</span>
      <button
        onClick={() => onPolicyChange({ ...policy, trashRetentionDays: 90 })}
        type="button"
      >
        edit lifecycle
      </button>
      <button onClick={onSavePolicy} type="button">
        save lifecycle
      </button>
    </div>
  ),
}));

const gibibyte = 1024 ** 3;
const storageSettings: StorageSettings = {
  accessKeyId: "",
  bucket: "",
  distributedStorageEnabled: true,
  endpoint: "",
  forcePathStyle: true,
  localRoot: "",
  objectStorageConfigured: false,
  physicalAvailableBytes: null,
  physicalCapacityBytes: null,
  physicalCapacityCheckedAt: "2026-08-12T00:00:00.000Z",
  physicalCapacityKnown: false,
  physicalCapacityReason: null,
  physicalQuotaLimitBytes: null,
  quotaBytes: gibibyte,
  region: "us-east-1",
  secretAccessKeyConfigured: false,
  storageProvider: "object",
  updatedAt: "2026-08-12T00:00:00.000Z",
};
const storageUsage: StorageUsage = {
  activeBytes: 0,
  defaultUserQuotaBytes: gibibyte / 2,
  fileCount: 0,
  folderCount: 0,
  quotaBytes: gibibyte / 2,
  quotaSource: "defaultUser",
  spaceScope: "workspace",
  storagePolicyQuotaBytes: gibibyte,
  trashBytes: 0,
  trashFileCount: 0,
  updatedAt: "2026-08-12T00:00:00.000Z",
  usagePercent: 0,
  usedBytes: 0,
  versionBytes: 0,
  versionCount: 0,
  workspaceId: "workspace-1",
};
const filePolicy: FilePolicySettings = {
  trashRetentionDays: 30,
  updatedAt: "2026-08-12T00:00:00.000Z",
  versionRetentionCount: 20,
  versionRetentionDays: 180,
};

beforeEach(() => {
  api.fetchFilePolicySettings.mockResolvedValue(filePolicy);
  api.fetchStorageSettings.mockResolvedValue(storageSettings);
  api.fetchStorageUsage.mockResolvedValue(storageUsage);
  api.fetchStorageUsageBreakdown.mockResolvedValue(null);
  api.updateAdminStoragePolicy.mockResolvedValue({
    settings: storageSettings,
    usage: storageUsage,
  });
  api.updateFilePolicySettings.mockResolvedValue(filePolicy);
  api.updateUserStorageQuota.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSettings({
  section = "storage",
  usage = storageUsage,
  workspaceId = "workspace-1",
}: {
  section?: "storage" | "lifecycle";
  usage?: StorageUsage | null;
  workspaceId?: string | null;
} = {}) {
  const store = createUnsavedChangesStore();
  const onStorageUsageUpdated = vi.fn();
  render(
    <UnsavedChangesContext.Provider value={store}>
      <DriveSystemSettings
        locale="en"
        onStorageUsageUpdated={onStorageUsageUpdated}
        palette={palettes.light}
        section={section}
        storageUsage={usage}
        workspaceId={workspaceId}
      />
    </UnsavedChangesContext.Provider>,
  );
  return { onStorageUsageUpdated, store };
}

describe("DriveSystemSettings atomic saves and dirty state", () => {
  it("saves both quota fields through the single atomic admin endpoint", async () => {
    const nextSettings = { ...storageSettings, quotaBytes: gibibyte * 2 };
    api.updateAdminStoragePolicy.mockResolvedValue({
      settings: nextSettings,
      usage: storageUsage,
    });
    const { onStorageUsageUpdated, store } = renderSettings();

    await waitFor(() => expect(api.fetchStorageSettings).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "edit quota" }));
    await waitFor(() => expect(store.readDirtySections()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "save quota" }));

    await waitFor(() =>
      expect(api.updateAdminStoragePolicy).toHaveBeenCalledWith({
        defaultUserQuotaBytes: gibibyte / 2,
        quotaBytes: gibibyte * 2,
        workspaceId: "workspace-1",
      }),
    );
    expect(onStorageUsageUpdated).toHaveBeenCalledWith(storageUsage);
    await waitFor(() => expect(store.readDirtySections()).toHaveLength(0));
  });

  it("re-fetches authoritative quota state and rejects after an atomic save failure", async () => {
    const saveError = new Error("atomic write failed");
    const authoritativeSettings = {
      ...storageSettings,
      quotaBytes: gibibyte * 3,
    };
    const authoritativeUsage = {
      ...storageUsage,
      storagePolicyQuotaBytes: gibibyte * 3,
    };
    api.updateAdminStoragePolicy.mockRejectedValue(saveError);
    api.fetchStorageSettings
      .mockResolvedValueOnce(storageSettings)
      .mockResolvedValueOnce(authoritativeSettings);
    api.fetchStorageUsage.mockResolvedValue(authoritativeUsage);
    const { onStorageUsageUpdated, store } = renderSettings();

    await waitFor(() => expect(api.fetchStorageSettings).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "edit quota" }));
    await waitFor(() => expect(store.readDirtySections()).toHaveLength(1));
    const save = store.readDirtySections()[0]?.onSave;
    expect(save).toBeDefined();
    let rejected: unknown;
    await act(async () => {
      try {
        await save?.();
      } catch (error) {
        rejected = error;
      }
    });

    expect(rejected).toBe(saveError);
    expect(api.fetchStorageSettings).toHaveBeenCalledTimes(2);
    expect(api.fetchStorageUsage).toHaveBeenCalledWith("workspace-1");
    expect(onStorageUsageUpdated).toHaveBeenCalledWith(authoritativeUsage);
    await waitFor(() =>
      expect(screen.getByTestId("quota-draft")).toHaveTextContent("3"),
    );
    await waitFor(() => expect(store.readDirtySections()).toHaveLength(0));
  });

  it("restores the last server lifecycle policy when changes are discarded", async () => {
    const { store } = renderSettings({ section: "lifecycle" });

    await waitFor(() => expect(api.fetchFilePolicySettings).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "edit lifecycle" }));
    expect(screen.getByTestId("retention-days")).toHaveTextContent("90");
    await waitFor(() => expect(store.readDirtySections()).toHaveLength(1));

    await act(async () => {
      await store.readDirtySections()[0]?.onDiscard();
    });

    expect(screen.getByTestId("retention-days")).toHaveTextContent("30");
    expect(api.updateFilePolicySettings).not.toHaveBeenCalled();
    await waitFor(() => expect(store.readDirtySections()).toHaveLength(0));
  });

  it("does not mark or save workspace quota without a workspace id", async () => {
    const { store } = renderSettings({ usage: null, workspaceId: null });

    await waitFor(() => expect(api.fetchStorageSettings).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "edit quota" }));
    fireEvent.click(screen.getByRole("button", { name: "save quota" }));

    expect(store.readDirtySections()).toHaveLength(0);
    expect(api.updateAdminStoragePolicy).not.toHaveBeenCalled();
    expect(api.fetchStorageUsage).not.toHaveBeenCalled();
  });
});
