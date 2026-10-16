import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type { TransferRow } from "@/views/drive/drive-types";
import { DriveUploadHud } from "./drive-upload-hud";

vi.mock("@/components/ui/progress-meter", () => ({
  ProgressMeter: ({ value }: { value: number }) => (
    <div data-testid="upload-progress-meter" data-value={value} />
  ),
}));

vi.mock("@/components/ui/app-icon", () => ({
  LocalIcon: () => null,
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (
    key: string,
    values?: Record<string, string | number>,
  ) => values?.count === undefined ? key : `${key}:${values.count}`,
}));

function createRow(index: number, input: Partial<TransferRow> = {}): TransferRow {
  const timestamp = "2026-07-30T00:00:00.000Z";
  return {
    batchId: "batch-many",
    createdAt: timestamp,
    hasContent: false,
    id: `transfer-${index}`,
    loadedBytes: (index + 1) * 10,
    name: `file-${index}.bin`,
    nodeId: null,
    progress: (index + 1) * 10,
    status: "running",
    totalBytes: 100,
    type: "upload",
    updatedAt: timestamp,
    workspaceId: "workspace-default",
    ...input,
  };
}

afterEach(() => {
  cleanup();
});

describe("DriveUploadHud", () => {
  it("limits displayed tasks without truncating aggregate progress", () => {
    render(
      <DriveUploadHud
        locale="en-US"
        palette={palettes.light}
        rows={Array.from({ length: 8 }, (_, index) => createRow(index))}
      />,
    );

    const hud = screen.getByRole("button", { name: "nav.transfers" });
    expect(hud).toHaveAttribute("data-visible-upload-count", "6");
    expect(hud).toHaveAttribute("data-total-upload-count", "8");
    expect(screen.getByTestId("upload-progress-meter")).toHaveAttribute(
      "data-value",
      "45",
    );
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("keeps a failed-task anchor visible and removes it after the failure clears", () => {
    const onOpenFailedTransfers = vi.fn();
    const failedRow = createRow(0, { status: "failed" });
    const { rerender } = render(
      <DriveUploadHud
        locale="en-US"
        onOpenFailedTransfers={onOpenFailedTransfers}
        palette={palettes.light}
        rows={[failedRow]}
      />,
    );

    const failureAnchor = screen.getByRole("button", {
      name: "transfers.failedCount:1",
    });
    expect(failureAnchor.closest(".drive-upload-hud")).toHaveAttribute(
      "data-failed-upload-count",
      "1",
    );
    expect(screen.queryByRole("button", { name: "nav.transfers" })).not.toBeInTheDocument();
    fireEvent.click(failureAnchor);
    expect(onOpenFailedTransfers).toHaveBeenCalledTimes(1);

    rerender(
      <DriveUploadHud
        locale="en-US"
        onOpenFailedTransfers={onOpenFailedTransfers}
        palette={palettes.light}
        rows={[{ ...failedRow, status: "completed" }]}
      />,
    );

    expect(screen.queryByRole("button", {
      name: "transfers.failedCount:1",
    })).not.toBeInTheDocument();
  });
});
