import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { ResponsiveBreadcrumbs } from "./responsive-breadcrumbs";

afterEach(() => {
  cleanup();
});

describe("ResponsiveBreadcrumbs", () => {
  it("keeps only the root and current directory in the compact path", () => {
    const { container } = render(
      <ResponsiveBreadcrumbs
        ancestorMenuLabel="Show ancestor folders"
        ariaLabel="Folder path"
        currentAnnouncement="Folder path: Current"
        items={[
          { id: "design", name: "Design" },
          { id: "year", name: "2026" },
          { id: "current", name: "Current" },
        ]}
        onNavigateFolder={vi.fn()}
        onNavigateRoot={vi.fn()}
        palette={palettes.light}
        rootLabel="Home"
      />,
    );

    const compactPath = container.querySelector<HTMLElement>(".drive-address-bar-compact");
    expect(compactPath).not.toBeNull();
    expect(within(compactPath!).getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(within(compactPath!).getByRole("button", { name: "Current" })).toHaveAttribute("aria-current", "page");
    expect(within(compactPath!).queryByText("Design")).not.toBeInTheDocument();
    expect(within(compactPath!).queryByText("2026")).not.toBeInTheDocument();
    expect(screen.getByText("Folder path: Current")).toHaveAttribute("aria-live", "polite");
  });

  it("opens the ancestor menu from the keyboard and navigates to an ancestor", async () => {
    const onNavigateFolder = vi.fn();
    const { container } = render(
      <ResponsiveBreadcrumbs
        ancestorMenuLabel="Show ancestor folders"
        ariaLabel="Folder path"
        currentAnnouncement="Folder path: Current"
        items={[
          { id: "design", name: "Design" },
          { id: "year", name: "2026" },
          { id: "current", name: "Current" },
        ]}
        onNavigateFolder={onNavigateFolder}
        onNavigateRoot={vi.fn()}
        palette={palettes.light}
        rootLabel="Home"
      />,
    );

    const compactPath = container.querySelector<HTMLElement>(".drive-address-bar-compact");
    const trigger = within(compactPath!).getByRole("button", { name: "Show ancestor folders" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const designItem = await screen.findByRole("menuitem", { name: "Design" });
    expect(designItem).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "2026" }));
    expect(onNavigateFolder).toHaveBeenCalledWith("year");
  });
});
