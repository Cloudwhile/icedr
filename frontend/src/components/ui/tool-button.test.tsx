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
