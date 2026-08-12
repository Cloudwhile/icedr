import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { useRouter } from "@/compat/navigation";
import {
  AdminUnsavedChangesProvider,
  type UnsavedChangesDialogLabels,
} from "./unsaved-changes-provider";
import { useUnsavedChangesSection } from "./use-unsaved-changes-section";

vi.mock("@/components/ui/app-dialog-shell", () => ({
  AppDialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AppDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AppDialogShell: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  AppDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/app-icon", () => ({
  LocalIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@/components/ui/tool-button", () => ({
  ToolButton: ({
    children,
    disabled,
    isPending,
    label,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    isPending?: boolean;
    label: string;
    onClick?: () => void;
  }) => (
    <button
      aria-label={label}
      disabled={disabled || isPending}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  ),
}));

const labels: UnsavedChangesDialogLabels = {
  cancel: "Cancel navigation",
  description: "Choose what to do with the pending settings.",
  discard: "Discard changes",
  save: "Save changes",
  saveFailed: "Unable to save changes",
  title: "Unsaved changes",
};

function DirtySection({
  id,
  isDirty = true,
  onDiscard,
  onSave,
}: {
  id: string;
  isDirty?: boolean;
  onDiscard: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
}) {
  useUnsavedChangesSection({ id, isDirty, onDiscard, onSave });
  return null;
}

function NavigateButton({ href = "/admin/audit" }: { href?: string }) {
  const router = useRouter();
  return (
    <button onClick={() => router.push(href)} type="button">
      navigate
    </button>
  );
}

function renderProvider(children: ReactNode) {
  return render(
    <AdminUnsavedChangesProvider labels={labels} palette={palettes.light}>
      {children}
    </AdminUnsavedChangesProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/settings");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminUnsavedChangesProvider", () => {
  it("waits for every dirty section to save before continuing navigation", async () => {
    let finishSecondSave: () => void = () => undefined;
    const firstSave = vi.fn().mockResolvedValue(undefined);
    const secondSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSecondSave = resolve;
        }),
    );

    renderProvider(
      <>
        <DirtySection id="platform" onDiscard={vi.fn()} onSave={firstSave} />
        <DirtySection id="storage" onDiscard={vi.fn()} onSave={secondSave} />
        <NavigateButton />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: labels.save }));
    await waitFor(() => expect(secondSave).toHaveBeenCalledOnce());
    expect(firstSave).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/admin/settings");

    finishSecondSave();
    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open after a save failure and allows retry", async () => {
    const onSave = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    renderProvider(
      <>
        <DirtySection id="authentication" onDiscard={vi.fn()} onSave={onSave} />
        <NavigateButton href="/admin/status" />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    fireEvent.click(screen.getByRole("button", { name: labels.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(labels.saveFailed);
    expect(window.location.pathname).toBe("/admin/settings");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: labels.save }));
    await waitFor(() => expect(window.location.pathname).toBe("/admin/status"));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("supports discard and cancel without confusing their navigation semantics", async () => {
    const onDiscard = vi.fn();
    const onSave = vi.fn();

    renderProvider(
      <>
        <DirtySection id="mail" onDiscard={onDiscard} onSave={onSave} />
        <NavigateButton />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    fireEvent.click(screen.getByRole("button", { name: labels.cancel }));
    expect(window.location.pathname).toBe("/admin/settings");
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));
    fireEvent.click(screen.getByRole("button", { name: labels.discard }));

    await waitFor(() => expect(window.location.pathname).toBe("/admin/audit"));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("registers beforeunload only while at least one section is dirty", () => {
    const view = renderProvider(
      <DirtySection id="platform" isDirty={false} onDiscard={vi.fn()} onSave={vi.fn()} />,
    );
    const cleanEvent = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    view.rerender(
      <AdminUnsavedChangesProvider labels={labels} palette={palettes.light}>
        <DirtySection id="platform" onDiscard={vi.fn()} onSave={vi.fn()} />
      </AdminUnsavedChangesProvider>,
    );
    const dirtyEvent = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });
});
