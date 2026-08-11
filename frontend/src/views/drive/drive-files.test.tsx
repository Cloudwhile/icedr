import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { FilesModule } from "./drive-files";

vi.mock("@/i18n/react", () => ({
  useLocale: () => "en_US",
  useTimeZone: () => "UTC",
  useTranslations: () => (key: string) => key,
}));

afterEach(() => {
  cleanup();
});

const noop = () => undefined;
const items: DriveItem[] = ["report.txt", "notes.txt"].map((name, index) => ({
  colorKey: "primary",
  hasContent: true,
  id: `file-${index + 1}`,
  kind: "doc",
  mimeType: "text/plain",
  modifiedAt: new Date(index).toISOString(),
  name,
  owner: "Mina",
  parentId: null,
  shared: false,
  sizeBytes: 128,
  starred: false,
}));

describe("FilesModule", () => {
  it("leaves multi-selection actions to the workspace toolbar", () => {
    const { container } = render(
      <FilesModule
        activeNav="drive"
        canPaste={false}
        createMenuItems={[]}
        currentFolderId={null}
        error={null}
        goUp={noop}
        hasQuery={false}
        items={items}
        onArchiveItem={noop}
        onBatchArchiveItems={noop}
        onBatchCopyItems={noop}
        onBatchCutItems={noop}
        onBatchDeletePermanentlyItems={noop}
        onBatchDownloadItems={noop}
        onBatchRestoreItems={noop}
        onBatchShareItems={noop}
        onBlankGoRoot={noop}
        onBlankGoUp={noop}
        onBlankPaste={noop}
        onBlankRefresh={noop}
        onBlankSelect={noop}
        onCancelRenameItem={noop}
        onCommitRenameItem={() => true}
        onCopyItem={noop}
        onCopyNodeItem={noop}
        onDeletePermanentlyItem={noop}
        onDownloadItem={noop}
        onEditItem={noop}
        onMoveItem={noop}
        onRenameItem={noop}
        onRestoreItem={noop}
        onSecurityItem={noop}
        onSetViewMode={noop}
        onShareItem={noop}
        onShowDetailsItem={noop}
        onSortChange={noop}
        openFolder={noop}
        openPreview={noop}
        palette={palettes.light}
        renamingItemId={null}
        selected={items.map((item) => item.id)}
        sortBy="name"
        sortDirection="asc"
        sourceItems={items}
        toggleSelected={noop}
        toggleStar={noop}
        viewMode="grid"
      />,
    );

    expect(screen.getByText("report.txt")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(container.querySelector(".drive-batch-toolbar")).not.toBeInTheDocument();
  });
});
