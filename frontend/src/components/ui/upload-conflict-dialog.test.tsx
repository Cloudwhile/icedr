import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { UploadConflictDialog } from "./upload-conflict-dialog";

vi.mock("@/i18n/react", () => ({
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
}));

vi.mock("./app-dialog-shell", () => ({
  AppDialogShell: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
}));

vi.mock("./app-icon", () => ({
  LocalIcon: () => null,
}));

vi.mock("./tool-button", () => ({
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UploadConflictDialog", () => {
  it("applies each conflict strategy to the selected upload batch", () => {
    const onSelect = vi.fn();

    render(
      <UploadConflictDialog
        conflictCount={2}
        fileNames={["report.txt", "notes.txt"]}
        onClose={vi.fn()}
        onSelect={onSelect}
        open
        palette={palettes.light}
      />,
    );

    for (const strategy of ["skip", "overwrite", "rename", "version"]) {
      fireEvent.click(
        screen.getByRole("button", { name: `upload.conflict.${strategy}` }),
      );
    }

    expect(onSelect.mock.calls).toEqual([
      ["skip"],
      ["overwrite"],
      ["rename"],
      ["version"],
    ]);
  });

  it("summarizes conflict names without rendering an unbounded list", () => {
    render(
      <UploadConflictDialog
        conflictCount={5}
        fileNames={[
          "one.txt",
          "two.txt",
          "three.txt",
          "four.txt",
          "five.txt",
        ]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        open
        palette={palettes.light}
      />,
    );

    expect(screen.getByText("one.txt")).toBeInTheDocument();
    expect(screen.getByText("four.txt")).toBeInTheDocument();
    expect(screen.queryByText("five.txt")).not.toBeInTheDocument();
    expect(screen.getByText("upload.conflictMore:1")).toBeInTheDocument();
  });
});
