import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { WorkspaceBar, type WorkspaceBarProps } from "./drive-layout";

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en_US",
  useTranslations: () => (key: string) => key,
}));

afterEach(cleanup);

const noop = () => undefined;

function renderWorkspaceBar(overrides: Partial<WorkspaceBarProps> = {}) {
  return render(
    <WorkspaceBar
      activeNav="drive"
      createMenuItems={[]}
      filtersActive={false}
      folderPath={[]}
      hasActionTarget={false}
      onClearSelection={noop}
      onDownloadSelection={noop}
      onNavigateFolder={noop}
      onNavigateRoot={noop}
      onRefresh={noop}
      onShareSelection={noop}
      onToggleFilters={noop}
      onTriggerUpload={noop}
      palette={palettes.light}
      refreshing={false}
      rootLabel="Drive"
      selectionCount={0}
      selectionMenuItems={[]}
      setViewMode={noop}
      sortMenuItems={[]}
      viewMode="grid"
      {...overrides}
    />,
  );
}

describe("WorkspaceBar", () => {
  it("does not render the three file actions without an action target", () => {
    const { container } = renderWorkspaceBar();

    expect(
      container.querySelector(".drive-toolbar-action-group"),
    ).not.toBeInTheDocument();
  });

  it("keeps the mobile refresh action available and disables it while refreshing", () => {
    const { container } = renderWorkspaceBar({ refreshing: true });
    const mobileToolbar = container.querySelector(
      ".drive-mobile-workspace-tools",
    );

    expect(mobileToolbar).not.toBeNull();
    expect(
      within(mobileToolbar as HTMLElement).getByRole("button", {
        name: "app.refresh",
      }),
    ).toBeDisabled();
  });

  it("uses restore actions for a selected trash item", () => {
    const { container } = renderWorkspaceBar({
      activeNav: "trash",
      hasActionTarget: true,
      selectionCount: 1,
      selectionMenuItems: [
        { label: "actions.restore", onClick: noop, value: "restore" },
        {
          label: "actions.deletePermanently",
          onClick: noop,
          value: "delete",
        },
      ],
    });
    const desktopActions = container.querySelector(
      ".drive-workspace-tools-desktop .drive-toolbar-action-group",
    );

    expect(desktopActions).not.toBeNull();
    expect(
      within(desktopActions as HTMLElement).getByRole("button", {
        name: "actions.restore",
      }),
    ).toBeInTheDocument();
    expect(
      within(desktopActions as HTMLElement).getByRole("button", {
        name: "actions.deletePermanently",
      }),
    ).toBeInTheDocument();
    expect(
      within(desktopActions as HTMLElement).queryByRole("button", {
        name: "actions.share",
      }),
    ).not.toBeInTheDocument();
  });
});
