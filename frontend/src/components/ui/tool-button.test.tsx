import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { ToolButton } from "./tool-button";

afterEach(cleanup);

it("exposes the disabled reason through the rendered button and clears it when enabled", () => {
  const onClick = vi.fn();
  const props = {
    disabledReason: "Enable delivery first",
    label: "Send test",
    onClick,
    palette: palettes.light,
  };
  const { rerender } = render(<ToolButton {...props} disabled><span /></ToolButton>);
  const button = screen.getByRole("button", { name: "Send test" });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription("Enable delivery first");
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();

  rerender(<ToolButton {...props}><span /></ToolButton>);
  expect(button).toBeEnabled();
  expect(button).not.toHaveAttribute("aria-describedby");
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

it("shows the action label on request while preserving its accessible name and click behavior", () => {
  const onClick = vi.fn();
  const { rerender } = render(
    <ToolButton label="Save and activate" palette={palettes.light} onClick={onClick} showLabel>
      <span aria-hidden="true">✓</span>
    </ToolButton>,
  );
  const button = screen.getByRole("button", { name: "Save and activate" });
  expect(screen.getByText("Save and activate")).toBeVisible();
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();

  rerender(<ToolButton label="Save and activate" palette={palettes.light} active disabled showLabel><span /></ToolButton>);
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-pressed", "true");

  rerender(<ToolButton label="Save and activate" palette={palettes.light}><span /></ToolButton>);
  expect(screen.queryByText("Save and activate")).not.toBeInTheDocument();
  expect(button).toHaveAccessibleName("Save and activate");
});
