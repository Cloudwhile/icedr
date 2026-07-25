import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import type {
  RegisteredShare,
  RegisteredShareItem,
} from "@/features/share/registry";
import { ShareDetailsPanel } from "./share-details-panel";

const { fetchManagementMock } = vi.hoisted(() => ({
  fetchManagementMock: vi.fn(),
}));

vi.mock("@/features/share/registry", () => ({
  fetchRegisteredShareManagement: fetchManagementMock,
}));

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en",
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) => {
      if (values?.name !== undefined) return `${key}:${values.name}`;
      if (values?.count !== undefined) return `${key}:${values.count}`;
      return key;
    },
}));

vi.mock("@/views/drive/drive-primitives", () => ({
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShareDetailsPanel", () => {
  it("renders an explicit empty state when the share has no members", async () => {
    fetchManagementMock.mockResolvedValue(createShare([]));

    render(
      <ShareDetailsPanel
        onClose={vi.fn()}
        palette={palettes.light}
        token="share-token"
      />,
    );

    expect(await screen.findByText("share.emptyCollection")).toBeInTheDocument();
  });

  it("renders large member lists in bounded batches", async () => {
    const members = Array.from({ length: 101 }, (_, index) =>
      createMember(index),
    );
    fetchManagementMock.mockResolvedValue(createShare(members));

    render(
      <ShareDetailsPanel
        onClose={vi.fn()}
        palette={palettes.light}
        token="share-token"
      />,
    );

    expect(await screen.findByText("member-0.txt")).toBeInTheDocument();
    expect(screen.getByText("member-99.txt")).toBeInTheDocument();
    expect(screen.queryByText("member-100.txt")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "share.showMoreItems:1" }),
    );

    expect(await screen.findByText("member-100.txt")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /share\.showMoreItems/ }),
    ).not.toBeInTheDocument();
  });

  it("labels a changed snapshot name with its original-name meaning", async () => {
    fetchManagementMock.mockResolvedValue(
      createShare([
        {
          ...createMember(0),
          changes: ["renamed"],
          name: "renamed.txt",
          snapshotName: "original.txt",
        },
      ]),
    );

    render(
      <ShareDetailsPanel
        onClose={vi.fn()}
        palette={palettes.light}
        token="share-token"
      />,
    );

    expect(
      await screen.findByText("share.originalName:original.txt"),
    ).toBeInTheDocument();
  });
});

function createMember(index: number): RegisteredShareItem {
  return {
    availability: "available",
    changes: [],
    hasContent: true,
    id: `member-${index}`,
    kind: "other",
    mimeType: "text/plain",
    name: `member-${index}.txt`,
    parentNodeId: null,
    role: "selected",
    sizeBytes: index,
  };
}

function createShare(items: RegisteredShareItem[]): RegisteredShare {
  return {
    allowDownload: true,
    allowPreview: true,
    allowedItemIds: items.map((item) => item.id),
    contentSummary: {
      changedCount: 0,
      fileCount: items.length,
      folderCount: 0,
      totalSizeBytes: items.reduce(
        (total, item) => total + (item.sizeBytes ?? 0),
        0,
      ),
      unavailableCount: 0,
    },
    createdAt: "2026-07-25T00:00:00.000Z",
    dynamicRootId: null,
    expiresDays: 7,
    items,
    mode: "multi-file",
    owner: "Owner",
    policy: {
      allowedDomain: "",
      downloadLimit: "",
      expiresUnit: "days",
      expiresValue: 7,
      speedUnit: "MB/s",
      speedValue: 0,
      waitUnit: "seconds",
      waitValue: 0,
    },
    remark: "",
    rootItemIds: items.slice(0, 1).map((item) => item.id),
    scopeMode: "items",
    title: "Shared files",
    token: "share-token",
  };
}
