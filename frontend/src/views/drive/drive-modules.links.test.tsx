import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type { RegisteredShare } from "@/features/share/registry";
import { LinksModule, type LinksModuleProps } from "./drive-modules";

vi.mock("@/components/ui/motion", () => ({
  MotionList: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/ui/share-details-panel", () => ({
  ShareDetailsPanel: ({ token }: { token: string }) => (
    <div data-testid="share-details-panel">{token}</div>
  ),
}));

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en-US",
  useTimeZone: () => "UTC",
  useTranslations: () => (
    key: string,
    values?: Record<string, string | number>,
  ) => values?.count === undefined ? key : `${key}:${values.count}`,
}));

vi.mock("./drive-primitives", () => ({
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
    onClick: () => void;
  }) => (
    <button aria-label={label} onClick={onClick} type="button">
      {children}
    </button>
  ),
}));

const policy = {
  waitValue: 0,
  waitUnit: "seconds" as const,
  speedValue: 0,
  speedUnit: "KB/s" as const,
  expiresValue: 7,
  expiresUnit: "days" as const,
  downloadLimit: "",
  allowedDomain: "",
};

function createShare(
  token: string,
  input: Partial<RegisteredShare> = {},
): RegisteredShare {
  return {
    allowDownload: true,
    allowPreview: true,
    allowedItemIds: [],
    createdAt: "2026-07-25T00:00:00.000Z",
    dynamicRootId: null,
    expiresDays: 7,
    mode: "single-file",
    owner: "Mina",
    policy,
    remark: "",
    rootItemIds: [],
    title: token,
    token,
    ...input,
  };
}

function createProps(links: RegisteredShare[]): LinksModuleProps {
  return {
    error: null,
    links,
    onCloseLink: vi.fn(),
    onCopyLink: vi.fn(),
    palette: palettes.light,
    sourceItems: [],
  };
}

afterEach(() => {
  cleanup();
});

describe("LinksModule focused share", () => {
  it("clears a focused token when its link disappears", async () => {
    const focusedShare = createShare("share-a");
    const riskShare = createShare("share-risk", {
      riskLevel: "high",
      title: "Risk share",
    });
    const { rerender } = render(
      <LinksModule {...createProps([focusedShare, riskShare])} />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "links.viewDetails" })[0],
    );
    expect(screen.getByTestId("share-details-panel")).toHaveTextContent(
      focusedShare.token,
    );

    rerender(<LinksModule {...createProps([riskShare])} />);

    await waitFor(() => {
      expect(screen.queryByTestId("share-details-panel")).not.toBeInTheDocument();
      expect(screen.getByText("links.riskSignal")).toBeInTheDocument();
    });

    rerender(<LinksModule {...createProps([focusedShare, riskShare])} />);
    expect(screen.queryByTestId("share-details-panel")).not.toBeInTheDocument();
  });
});
