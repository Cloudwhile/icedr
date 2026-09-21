import type { ComponentProps, ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import {
  acknowledgeStorageIntegrityResult,
  createStorageIntegrityTask,
  fetchStorageIntegrityResults,
  fetchStorageIntegritySummary,
  fetchStorageIntegrityTask,
  fetchStorageIntegrityTasks,
  retryStorageIntegrityTask,
  type StorageIntegrityResult,
  type StorageIntegrityTask,
} from "@/lib/drive-api";
import { AdminStorageIntegrityPanel } from "./admin-storage-integrity-panel";

vi.mock("@/lib/drive-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-api")>()),
  acknowledgeStorageIntegrityResult: vi.fn(),
  createStorageIntegrityTask: vi.fn(),
  fetchStorageIntegrityResults: vi.fn(),
  fetchStorageIntegritySummary: vi.fn(),
  fetchStorageIntegrityTask: vi.fn(),
  fetchStorageIntegrityTasks: vi.fn(),
  retryStorageIntegrityTask: vi.fn(),
}));

vi.mock("@/components/ui/app-icon", () => ({
  LocalIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@/components/ui/tool-button", () => ({
  ToolButton: ({
    children,
    disabled,
    isPending,
    label,
    onClick,
    type,
  }: {
    children: ReactNode;
    disabled?: boolean;
    isPending?: boolean;
    label: string;
    onClick?: () => void;
    type?: "button" | "submit";
  }) => (
    <button
      aria-label={label}
      disabled={disabled || isPending}
      onClick={onClick}
      type={type ?? "button"}
    >
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

vi.mock("@/components/ui/progress-meter", () => ({
  ProgressMeter: ({
    ariaLabel,
    max,
    value,
  }: {
    ariaLabel: string;
    max: number;
    value: number;
  }) => (
    <progress aria-label={ariaLabel} max={max} value={value} />
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

const summary = {
  counts: { failed: 2, mismatch: 3, pending: 4, unknown: 5, verified: 6 },
  generatedAt: "2026-08-13T12:00:00.000Z",
  lastVerifiedAt: "2026-08-13T11:00:00.000Z",
  scope: { kind: "all" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchStorageIntegrityTasks).mockResolvedValue({
    items: [],
    limit: 20,
    offset: 0,
    total: 0,
  });
  vi.mocked(fetchStorageIntegritySummary).mockResolvedValue(summary);
  vi.mocked(fetchStorageIntegrityResults).mockResolvedValue({
    items: [],
    limit: 25,
    offset: 0,
    total: 0,
  });
});

afterEach(cleanup);

describe("AdminStorageIntegrityPanel", () => {
  it("allows retrying a failed task before any result was saved", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(createTask({
      status: "failed",
      progress: { bytesRead: 0, failed: 0, matched: 0, mismatches: 0, processed: 0, total: 0 },
    }));
    vi.mocked(retryStorageIntegrityTask).mockResolvedValue(
      createTask({ id: "task-retried", status: "queued" }),
    );
    const { props } = renderPanel({ requestedTaskId: "task-1" });
    fireEvent.click(await screen.findByRole("button", { name: "storageIntegrity.retryAll" }));
    await waitFor(() => expect(retryStorageIntegrityTask).toHaveBeenCalledWith("task-1", {}));
    expect(props.onTaskIdChange).toHaveBeenCalledWith("task-retried");
  });

  it("shows a warning for completed history containing failed reads", async () => {
    vi.mocked(fetchStorageIntegrityTasks).mockResolvedValue({
      items: [createTask({
        progress: { bytesRead: 0, failed: 1, matched: 0, mismatches: 0, processed: 1, total: 1 },
      })],
      limit: 20, offset: 0, total: 1,
    });
    renderPanel();
    const task = await screen.findByRole("button", { name: "storageIntegrity.openTask:task=task-1" });
    expect(
      task.querySelector(".admin-integrity-history-icon"),
    ).toHaveAttribute("data-status", "failed");
    expect(task.querySelector('[data-icon="exclamation"]')).not.toBeNull();
    expect(task.querySelector('[data-icon="tick"]')).toBeNull();
    expect(task).toHaveAccessibleDescription(
      "storageIntegrity.status.completed 1 / 1",
    );
  });

  it("provides the page-level storage integrity heading", () => {
    renderPanel();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "storageIntegrity.title",
      }),
    ).toBeVisible();
  });

  it("uses the server summary and requires confirmation for an all-scope run", async () => {
    const task = createTask({ id: "task-created", status: "queued" });
    vi.mocked(createStorageIntegrityTask).mockResolvedValue(task);
    const { props } = renderPanel();

    await waitFor(() =>
      expect(fetchStorageIntegritySummary).toHaveBeenCalledWith(
        { kind: "all" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(screen.getByTestId("integrity-count-unknown")).toHaveTextContent(
      "5",
    );
    expect(
      screen.getByText("storageIntegrity.targetWorkspaceOnly"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", {
        name: "storageIntegrity.targetSearch",
      }),
    ).not.toBeInTheDocument();
    const start = screen.getByRole("button", {
      name: "storageIntegrity.start",
    });
    expect(start).toBeDisabled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "storageIntegrity.confirmAll",
      }),
    );
    fireEvent.click(start);

    await waitFor(() => expect(createStorageIntegrityTask).toHaveBeenCalled());
    expect(createStorageIntegrityTask).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "verify", scope: "all" }),
    );
    expect(props.onTaskIdChange).toHaveBeenCalledWith("task-created");
  });

  it("explains a size and hash mismatch without exposing a delete action", async () => {
    const task = createTask();
    const finding = createFinding();
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(task);
    vi.mocked(fetchStorageIntegrityResults).mockResolvedValue({
      items: [finding],
      limit: 25,
      offset: 0,
      total: 1,
    });
    vi.mocked(retryStorageIntegrityTask).mockResolvedValue(
      createTask({ id: "task-retried", status: "queued" }),
    );
    const { props } = renderPanel({ requestedTaskId: "task-1" });

    const objectKey = await screen.findByText("objects/archive.bin");
    expect(objectKey).toHaveAttribute("title", "objects/archive.bin");
    const resultRow = objectKey.closest("tr");
    expect(resultRow).not.toBeNull();
    expect(within(resultRow!).getByText("storageIntegrity.nodeId")).toBeVisible();
    expect(within(resultRow!).getByText("node-1")).toBeVisible();
    expect(within(resultRow!).getByText("storageIntegrity.versionId")).toBeVisible();
    expect(within(resultRow!).getByText("version-1")).toBeVisible();
    expect(screen.getByText("sha256:expected")).toBeInTheDocument();
    expect(screen.getByText("sha256:actual")).toBeInTheDocument();
    expect(screen.getByTestId("integrity-expected-size")).toHaveTextContent(
      "1 KB",
    );
    expect(screen.getByTestId("integrity-actual-size")).toHaveTextContent(
      "2 KB",
    );
    expect(
      screen.queryByRole("button", { name: /delete|storageIntegrity\.delete/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "storageIntegrity.retryAll" }),
    );
    await waitFor(() =>
      expect(retryStorageIntegrityTask).toHaveBeenCalledWith("task-1", {}),
    );
    expect(props.onTaskIdChange).toHaveBeenCalledWith("task-retried");
  });

  it("uses readable foregrounds for light-theme result statuses", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(createTask());
    vi.mocked(fetchStorageIntegrityResults).mockResolvedValue({
      items: [
        createFinding({ id: "matched", status: "matched" }),
        createFinding({ id: "mismatch", status: "mismatch" }),
        createFinding({ id: "failed", status: "failed" }),
      ],
      limit: 25,
      offset: 0,
      total: 3,
    });
    renderPanel({ requestedTaskId: "task-1" });

    const cases = [
      ["matched", palettes.light.success],
      ["mismatch", palettes.light.warning],
      ["failed", palettes.light.danger],
    ] as const;
    for (const [status, semanticColor] of cases) {
      const label = await screen.findByText(`storageIntegrity.result.${status}`, {
        selector: ".admin-integrity-result",
      });
      expect(label.style.color).not.toBe("");
      expect(
        contrastRatio(
          parseCssColor(label.style.color),
          mixHexColors(semanticColor, palettes.light.surface1, 0.08),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("disables finding retries while an integrity operation is pending", async () => {
    const task = createTask();
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(task);
    vi.mocked(fetchStorageIntegrityResults).mockResolvedValue({
      items: [createFinding()],
      limit: 25,
      offset: 0,
      total: 1,
    });
    let resolveRetry: ((task: StorageIntegrityTask) => void) | undefined;
    vi.mocked(retryStorageIntegrityTask).mockReturnValue(
      new Promise<StorageIntegrityTask>((resolve) => {
        resolveRetry = resolve;
      }),
    );
    renderPanel({ requestedTaskId: "task-1" });
    const retry = await screen.findByRole("button", {
      name: "storageIntegrity.retryFinding",
    });

    fireEvent.click(retry);
    await waitFor(() => expect(retry).toBeDisabled());
    fireEvent.click(retry);

    expect(retryStorageIntegrityTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRetry?.(createTask({ id: "task-retried", status: "queued" }));
    });
  });

  it("does not offer finding retries until the current task is terminal", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(
      createTask({
        finishedAt: null,
        status: "running",
      }),
    );
    vi.mocked(fetchStorageIntegrityResults).mockResolvedValue({
      items: [createFinding()],
      limit: 25,
      offset: 0,
      total: 1,
    });

    renderPanel({ requestedTaskId: "task-1" });

    await screen.findByText("objects/archive.bin");
    expect(
      screen.queryByRole("button", {
        name: "storageIntegrity.retryFinding",
      }),
    ).not.toBeInTheDocument();
    expect(retryStorageIntegrityTask).not.toHaveBeenCalled();
  });

  it("acknowledges only unacknowledged anomalies and prevents duplicate actions", async () => {
    const finding = createFinding({ objectKey: "objects/mismatch.bin" });
    const acknowledgedFinding = createFinding({
      acknowledgedAt: "2026-08-14T01:00:00.000Z",
      acknowledgedBy: "admin-1",
      objectKey: "objects/mismatch.bin",
    });
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(createTask());
    vi.mocked(fetchStorageIntegrityResults)
      .mockResolvedValueOnce({
        items: [
          finding,
          createFinding({
            acknowledgedAt: "2026-08-13T22:00:00.000Z",
            acknowledgedBy: "admin-2",
            id: "acknowledged-failed",
            objectKey: "objects/acknowledged-failed.bin",
            status: "failed",
          }),
          createFinding({
            id: "unacknowledged-failed",
            objectKey: "objects/unacknowledged-failed.bin",
            status: "failed",
          }),
          createFinding({
            id: "matched",
            objectKey: "objects/matched.bin",
            status: "matched",
          }),
        ],
        limit: 25,
        offset: 0,
        total: 4,
      })
      .mockResolvedValue({
        items: [acknowledgedFinding],
        limit: 25,
        offset: 0,
        total: 1,
      });
    let resolveAcknowledgement:
      | ((result: StorageIntegrityResult) => void)
      | undefined;
    vi.mocked(acknowledgeStorageIntegrityResult).mockReturnValue(
      new Promise<StorageIntegrityResult>((resolve) => {
        resolveAcknowledgement = resolve;
      }),
    );
    renderPanel({ requestedTaskId: "task-1" });

    const mismatchRow = (
      await screen.findByText("objects/mismatch.bin")
    ).closest("tr");
    expect(mismatchRow).not.toBeNull();
    const acknowledge = within(mismatchRow!).getByRole("button", {
      name: "storageIntegrity.acknowledgeFinding",
    });
    expect(
      screen.getAllByRole("button", {
        name: "storageIntegrity.acknowledgeFinding",
      }),
    ).toHaveLength(2);
    expect(acknowledge).not.toHaveTextContent(
      "storageIntegrity.acknowledgeFinding",
    );

    fireEvent.click(acknowledge);
    await waitFor(() => expect(acknowledge).toBeDisabled());
    fireEvent.click(acknowledge);
    expect(acknowledgeStorageIntegrityResult).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAcknowledgement?.(acknowledgedFinding);
    });

    const resultRow = (await screen.findByText("objects/mismatch.bin")).closest(
      "tr",
    );
    expect(resultRow).not.toBeNull();
    expect(
      within(resultRow!).getByText("storageIntegrity.acknowledged"),
    ).toBeVisible();
    expect(within(resultRow!).getByText(/Aug 14, 2026/, { selector: "time" })).toBeVisible();
    expect(
      within(resultRow!).queryByRole("button", {
        name: "storageIntegrity.acknowledgeFinding",
      }),
    ).not.toBeInTheDocument();
  });

  it("surfaces acknowledgement failures through the panel alert", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(createTask());
    vi.mocked(fetchStorageIntegrityResults).mockResolvedValue({
      items: [createFinding()],
      limit: 25,
      offset: 0,
      total: 1,
    });
    vi.mocked(acknowledgeStorageIntegrityResult).mockRejectedValue(
      new Error("request failed"),
    );
    renderPanel({ requestedTaskId: "task-1" });

    const acknowledge = await screen.findByRole("button", {
      name: "storageIntegrity.acknowledgeFinding",
    });
    fireEvent.click(acknowledge);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "storageIntegrity.acknowledgeFailed",
    );
    expect(acknowledge).toBeEnabled();
  });

  it("opens a task from paginated history", async () => {
    vi.mocked(fetchStorageIntegrityTasks).mockResolvedValue({
      items: [createTask()],
      limit: 20,
      offset: 0,
      total: 1,
    });
    const { props } = renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "storageIntegrity.openTask:task=task-1",
      }),
    );
    expect(props.onTaskIdChange).toHaveBeenCalledWith("task-1");
  });

  it("shows a localized safe message for a failed task", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(
      createTask({
        failureCode: "STORAGE_INTEGRITY_TASK_FAILED",
        failureMessage: "完整性巡检任务执行失败",
        status: "failed",
      }),
    );

    renderPanel({ requestedTaskId: "task-1" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("storageIntegrity.failure.taskFailed");
    expect(alert).not.toHaveTextContent("完整性巡检任务执行失败");
  });

  it("uses a safe fallback for an unknown failure code", async () => {
    vi.mocked(fetchStorageIntegrityTask).mockResolvedValue(
      createTask({
        failureCode: "UNRECOGNIZED_FAILURE",
        failureMessage: "不应直接展示的后端错误",
        status: "failed",
      }),
    );

    renderPanel({ requestedTaskId: "task-1" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("storageIntegrity.failure.unknown");
    expect(alert).not.toHaveTextContent("不应直接展示的后端错误");
  });

  it("uses native form constraints instead of silently clamping invalid limits", async () => {
    vi.mocked(createStorageIntegrityTask).mockResolvedValue(
      createTask({ id: "task-created", status: "queued" }),
    );
    renderPanel({
      scope: { kind: "workspace", workspaceId: "workspace-1" },
    });
    const batchSize = screen.getByRole("spinbutton", {
      name: "storageIntegrity.batchSize",
    });
    const bandwidth = screen.getByRole("spinbutton", {
      name: "storageIntegrity.bandwidthMib",
    });

    expect(bandwidth).toHaveAttribute("max", "953");

    fireEvent.change(batchSize, { target: { value: "0" } });
    expect(batchSize).toBeInvalid();
    fireEvent.click(
      screen.getByRole("button", { name: "storageIntegrity.start" }),
    );

    expect(createStorageIntegrityTask).not.toHaveBeenCalled();

    fireEvent.change(batchSize, { target: { value: "501" } });
    expect(batchSize).toBeInvalid();
    fireEvent.click(
      screen.getByRole("button", { name: "storageIntegrity.start" }),
    );

    expect(createStorageIntegrityTask).not.toHaveBeenCalled();

    fireEvent.change(batchSize, { target: { value: "100" } });
    fireEvent.change(bandwidth, { target: { value: "954" } });
    expect(bandwidth).toBeInvalid();
    fireEvent.click(
      screen.getByRole("button", { name: "storageIntegrity.start" }),
    );

    expect(createStorageIntegrityTask).not.toHaveBeenCalled();
  });
});

function renderPanel(
  overrides: Partial<ComponentProps<typeof AdminStorageIntegrityPanel>> = {},
) {
  const props: ComponentProps<typeof AdminStorageIntegrityPanel> = {
    locale: "en",
    onTaskIdChange: vi.fn(),
    palette: palettes.light,
    requestedTaskId: null,
    scope: { kind: "all" },
    timeZone: "UTC",
    ...overrides,
  };
  render(<AdminStorageIntegrityPanel {...props} />);
  return { props };
}

function createTask(
  overrides: Partial<StorageIntegrityTask> = {},
): StorageIntegrityTask {
  return {
    config: {
      bandwidthLimitBytesPerSecond: null,
      batchSize: 100,
      concurrency: 2,
      maxAttempts: 3,
    },
    createdAt: "2026-08-13T12:00:00.000Z",
    failureCode: null,
    failureMessage: null,
    finishedAt: "2026-08-13T12:02:00.000Z",
    id: "task-1",
    mode: "verify",
    progress: {
      bytesRead: 2_048,
      failed: 0,
      matched: 8,
      mismatches: 2,
      processed: 10,
      total: 10,
    },
    scope: "all",
    startedAt: "2026-08-13T12:00:01.000Z",
    status: "completed",
    target: null,
    workspaceId: null,
    ...overrides,
  };
}

function createFinding(
  overrides: Partial<StorageIntegrityResult> = {},
): StorageIntegrityResult {
  return {
    acknowledgedAt: null,
    acknowledgedBy: null,
    actualHash: "sha256:actual",
    actualSizeBytes: 2_048,
    attempts: 2,
    checkedAt: "2026-08-13T12:01:00.000Z",
    errorCode: null,
    errorMessage: null,
    expectedHash: "sha256:expected",
    expectedSizeBytes: 1_024,
    id: "finding-1",
    nodeId: "node-1",
    objectKey: "objects/archive.bin",
    status: "mismatch",
    taskId: "task-1",
    versionId: "version-1",
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function mixHexColors(foreground: string, background: string, weight: number) {
  const left = parseCssColor(foreground);
  const right = parseCssColor(background);
  return left.map((channel, index) =>
    Math.round(channel * weight + right[index] * (1 - weight)),
  ) as [number, number, number];
}

function parseCssColor(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    return [1, 3, 5].map((index) =>
      Number.parseInt(color.slice(index, index + 2), 16),
    ) as [number, number, number];
  }
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${color}`);
  return channels as [number, number, number];
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(channels: [number, number, number]) {
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
