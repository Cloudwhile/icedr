import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import {
  fetchStorageIntegrityTargetVersions,
  searchStorageIntegrityTargets,
  type StorageIntegrityTargetCandidate,
} from "@/lib/drive-api";
import { AdminStorageIntegrityTarget } from "./admin-storage-integrity-target";

vi.mock("@/lib/drive-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-api")>()),
  fetchStorageIntegrityTargetVersions: vi.fn(),
  searchStorageIntegrityTargets: vi.fn(),
}));

vi.mock("@/components/ui/app-icon", () => ({
  LocalIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@/components/ui/tool-button", () => ({
  ToolButton: ({
    children,
    label,
    onClick,
    type,
  }: {
    children: ReactNode;
    label: string;
    onClick?: () => void;
    type?: "button" | "submit";
  }) => (
    <button aria-label={label} onClick={onClick} type={type ?? "button"}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/app-input", () => ({
  AppInput: ({ palette: _palette, ...props }: Record<string, unknown>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/app-select", () => ({
  AppSelect: ({
    options,
    palette: _palette,
    ...props
  }: {
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

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchStorageIntegrityTargets).mockResolvedValue({
    items: [
      createNode({ id: "node-1", name: "archive.bin" }),
    ],
    limit: 20,
    offset: 0,
    total: 1,
  });
  vi.mocked(fetchStorageIntegrityTargetVersions).mockResolvedValue([
    {
      createdAt: "2026-08-13T12:00:00.000Z",
      id: "version-2",
      integrityStatus: "unknown",
      lastVerifiedAt: null,
      mimeType: "application/octet-stream",
      nodeId: "node-1",
      remark: "release",
      sizeBytes: 2_048,
      uploadedBy: "operator",
      versionNumber: 2,
    },
  ]);
});

afterEach(cleanup);

describe("AdminStorageIntegrityTarget", () => {
  it("searches when Enter is pressed without nesting another form", async () => {
    render(
      <AdminStorageIntegrityTarget
        locale="en"
        onChange={vi.fn()}
        palette={palettes.light}
        scope={{ kind: "workspace", workspaceId: "workspace-1" }}
        value={{}}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: "storageIntegrity.targetSearch",
    });
    fireEvent.change(input, { target: { value: "archive" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(searchStorageIntegrityTargets).toHaveBeenCalledWith(
        "workspace-1",
        "archive",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("searches within workspace, selects a file, then selects a version", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState({});
      return (
        <AdminStorageIntegrityTarget
          locale="en"
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          palette={palettes.light}
          scope={{ kind: "workspace", workspaceId: "workspace-1" }}
          value={value}
        />
      );
    }
    render(<Harness />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "storageIntegrity.targetSearch" }),
      { target: { value: "archive" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "storageIntegrity.searchFiles" }),
    );

    await waitFor(() =>
      expect(searchStorageIntegrityTargets).toHaveBeenCalledWith(
        "workspace-1",
        "archive",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "archive.bin" }));
    expect(onChange).toHaveBeenLastCalledWith({ nodeId: "node-1" });
    await waitFor(() =>
      expect(fetchStorageIntegrityTargetVersions).toHaveBeenCalledWith(
        "workspace-1",
        "node-1",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    fireEvent.change(
      await screen.findByRole("combobox", {
        name: "storageIntegrity.targetVersion",
      }),
      { target: { value: "version-2" } },
    );
    expect(onChange).toHaveBeenLastCalledWith({
      nodeId: "node-1",
      versionId: "version-2",
    });
  });
});

function createNode(
  overrides: Partial<StorageIntegrityTargetCandidate> = {},
): StorageIntegrityTargetCandidate {
  return {
    id: "node-1",
    integrityStatus: "unknown",
    kind: "other",
    lastVerifiedAt: null,
    mimeType: "application/octet-stream",
    name: "archive.bin",
    path: "/archive.bin",
    sizeBytes: 2_048,
    updatedAt: "2026-08-13T12:00:00.000Z",
    workspaceId: "workspace-1",
    ...overrides,
  };
}
