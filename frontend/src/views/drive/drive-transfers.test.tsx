import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type { TransferRow } from "./drive-types";
import { TransfersModule } from "./drive-transfers";

vi.mock("@/components/ui/e-chart", () => ({
  EChart: () => null,
}));

vi.mock("@/components/ui/motion", () => ({
  MotionList: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/ui/progress-meter", () => ({
  ProgressMeter: ({ value }: { value: number }) => (
    <div data-progress={value} />
  ),
}));

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (
    key: string,
    values?: Record<string, string | number>,
  ) => values === undefined ? key : `${key}:${JSON.stringify(values)}`,
}));

vi.mock("./drive-primitives", () => ({
  AnimatedCheckMark: () => null,
  ItemIcon: () => null,
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

function createRecoverableRow(): TransferRow {
  const timestamp = "2026-07-30T00:00:00.000Z";
  return {
    createdAt: timestamp,
    hasContent: false,
    id: "transfer-recovery",
    name: "archive.zip",
    nodeId: null,
    progress: 42,
    recoveryHint: "Select the original file to continue",
    recoveryRequired: true,
    status: "paused",
    type: "upload",
    updatedAt: timestamp,
    workspaceId: "workspace-default",
  };
}

function createTransferRow(id: string, status: TransferRow["status"]): TransferRow {
  const timestamp = "2026-07-30T00:00:00.000Z";
  return {
    createdAt: timestamp,
    hasContent: false,
    id,
    name: `${id}.bin`,
    nodeId: null,
    progress: status === "failed" ? 35 : 50,
    status,
    type: "upload",
    updatedAt: timestamp,
    workspaceId: "workspace-default",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("TransfersModule upload recovery", () => {
  it("shows a recovery hint and action for a task without an in-memory controller", () => {
    const onRetryTransfer = vi.fn();

    render(
      <TransfersModule
        onRetryTransfer={onRetryTransfer}
        palette={palettes.light}
        rows={[createRecoverableRow()]}
      />,
    );

    expect(
      screen.getByText("Select the original file to continue"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "transfers.resume" }),
    );
    expect(onRetryTransfer).toHaveBeenCalledWith("transfer-recovery");
  });

  it("persists real upload settings and omits the unsupported speed limit", () => {
    const { unmount } = render(
      <TransfersModule palette={palettes.light} rows={[]} />,
    );

    const concurrency = screen.getByRole("combobox", {
      name: "transfers.concurrentUploads",
    });
    const autoClear = screen.getByRole("checkbox", {
      name: "transfers.autoClearCompleted",
    });
    expect(concurrency).toHaveValue("3");
    expect(autoClear).not.toBeChecked();
    expect(screen.queryByText("transfers.uploadSpeedLimit")).not.toBeInTheDocument();

    fireEvent.change(concurrency, { target: { value: "1" } });
    fireEvent.click(autoClear);
    unmount();

    render(<TransfersModule palette={palettes.light} rows={[]} />);
    expect(screen.getByRole("combobox", {
      name: "transfers.concurrentUploads",
    })).toHaveValue("1");
    expect(screen.getByRole("checkbox", {
      name: "transfers.autoClearCompleted",
    })).toBeChecked();
  });

  it("selects and focuses the needs-attention tab when requested by the HUD", async () => {
    const onAttentionRequestHandled = vi.fn();
    render(
      <TransfersModule
        attentionRequestKey={1}
        onAttentionRequestHandled={onAttentionRequestHandled}
        palette={palettes.light}
        rows={[
          createTransferRow("failed-upload", "failed"),
          createTransferRow("active-upload", "running"),
        ]}
      />,
    );

    const attentionTab = screen.getByRole("tab", {
      name: /transfers\.needsAttention/,
    });
    await waitFor(() => {
      expect(attentionTab).toHaveAttribute("aria-selected", "true");
      expect(attentionTab).toHaveFocus();
      expect(onAttentionRequestHandled).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("failed-upload.bin")).toBeInTheDocument();
    expect(screen.queryByText("active-upload.bin")).not.toBeInTheDocument();
  });
});
