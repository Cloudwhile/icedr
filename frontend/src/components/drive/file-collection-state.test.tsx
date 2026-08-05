import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { DriveFileCollectionStateView } from "./file-collection-state";
import { resolveDriveFileCollectionState } from "./file-collection-state-model";

vi.mock("@/components/ui/motion", () => ({
  MotionSurface: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
}));

vi.mock("@/i18n/react", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/views/drive/drive-primitives", () => ({
  LocalIcon: ({ name }: { name: string }) => <span data-icon={name} />,
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

describe("resolveDriveFileCollectionState", () => {
  const base = {
    activeNav: "drive",
    currentFolderId: null,
    error: null,
    hasQuery: false,
    itemCount: 0,
    searchLoading: false,
  };

  it("keeps existing items visible while search refreshes", () => {
    expect(resolveDriveFileCollectionState({ ...base, itemCount: 2, searchLoading: true })).toBe("ready");
  });

  it("shows loading before an empty-search result", () => {
    expect(resolveDriveFileCollectionState({ ...base, hasQuery: true, searchLoading: true })).toBe("search-loading");
    expect(resolveDriveFileCollectionState({ ...base, hasQuery: true })).toBe("search-empty");
  });

  it("prioritizes an empty error over navigation empty states", () => {
    expect(resolveDriveFileCollectionState({ ...base, currentFolderId: "folder", error: "offline" })).toBe("error");
  });

  it("distinguishes root, subdirectory, trash, and shortcut collections", () => {
    expect(resolveDriveFileCollectionState(base)).toBe("root-empty");
    expect(resolveDriveFileCollectionState({ ...base, currentFolderId: "folder" })).toBe("folder-empty");
    expect(resolveDriveFileCollectionState({ ...base, activeNav: "trash" })).toBe("trash-empty");
    expect(resolveDriveFileCollectionState({ ...base, activeNav: "recent" })).toBe("collection-empty");
  });
});

describe("DriveFileCollectionStateView", () => {
  it("renders a labelled icon action outside the button copy", () => {
    const onRetry = vi.fn();
    render(
      <DriveFileCollectionStateView
        actions={[{ icon: "refresh", label: "Retry", onClick: onRetry }]}
        error="Could not load files"
        kind="error"
        palette={palettes.light}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load files");
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
