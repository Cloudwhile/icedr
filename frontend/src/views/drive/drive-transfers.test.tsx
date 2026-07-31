import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
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
});
