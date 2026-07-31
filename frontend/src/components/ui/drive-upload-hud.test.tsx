import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type { TransferRow } from "@/views/drive/drive-types";
import { DriveUploadHud } from "./drive-upload-hud";

vi.mock("@/components/ui/motion", () => ({
  MotionPresence: ({
    children,
    show,
  }: {
    children: ReactNode;
    show: boolean;
  }) => (show ? <>{children}</> : null),
}));

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

function createRow(index: number): TransferRow {
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
});
