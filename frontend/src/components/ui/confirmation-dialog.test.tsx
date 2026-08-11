import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { ConfirmationDialog } from "./confirmation-dialog";

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./app-dialog-shell", () => ({
  AppDialogShell: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
}));

vi.mock("./app-icon", () => ({
  LocalIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("./tool-button", () => ({
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfirmationDialog", () => {
  it("keeps the danger tone and trash action icon as defaults", () => {
    render(
      <ConfirmationDialog
        confirmLabel="Delete"
        description="Delete this file permanently"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        open
        palette={palettes.light}
        title="Delete file"
      />,
    );

    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("data-tone", "danger");
    expect(document.querySelector(".icedr-confirmation-frame")).toHaveAttribute("data-tone", "danger");
    expect(document.querySelector('[data-icon="trash"]')).toBeInTheDocument();
  });

  it("supports a warning tone and custom action icon", () => {
    render(
      <ConfirmationDialog
        confirmLabel="Continue"
        description="The extension changed"
        icon="pencil"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        open
        palette={palettes.light}
        title="Confirm extension change"
        tone="warning"
      />,
    );

    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("data-tone", "warning");
    expect(document.querySelector(".icedr-confirmation-frame")).toHaveAttribute("data-tone", "warning");
    expect(document.querySelector('[data-icon="pencil"]')).toBeInTheDocument();
  });

  it("does not close or confirm while pending", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        confirmLabel="Delete"
        description="Delete this file permanently"
        isPending
        onClose={onClose}
        onConfirm={onConfirm}
        open
        palette={palettes.light}
        title="Delete file"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "actions.close" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
