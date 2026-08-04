import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { palettes } from "@/features/file/model";
import { DriveFileSelectBox, DriveTableSortHeader } from "./file-list-controls";

afterEach(() => {
  cleanup();
});

describe("DriveTableSortHeader", () => {
  it("exposes the active sort direction on the column header", () => {
    const onSort = vi.fn();
    const { rerender } = render(
      <table>
        <thead>
          <tr>
            <DriveTableSortHeader active direction="asc" label="Name" onSort={onSort} />
          </tr>
        </thead>
      </table>,
    );

    const columnHeader = screen.getByRole("columnheader", { name: "Name" });
    const sortButton = screen.getByRole("button", { name: "Name" });
    expect(columnHeader).toHaveAttribute("aria-sort", "ascending");
    expect(sortButton).not.toHaveAttribute("aria-sort");
    fireEvent.click(sortButton);
    expect(onSort).toHaveBeenCalledOnce();

    rerender(
      <table>
        <thead>
          <tr>
            <DriveTableSortHeader active direction="desc" label="Name" onSort={onSort} />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "descending");

    rerender(
      <table>
        <thead>
          <tr>
            <DriveTableSortHeader active={false} direction="desc" label="Name" onSort={onSort} />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).not.toHaveAttribute("aria-sort");
  });
});

describe("DriveFileSelectBox", () => {
  it.each(["table", "grid"] as const)("keeps double clicks inside the %s selection control", (surface) => {
    const onChange = vi.fn();
    const onSurfaceDoubleClick = vi.fn();
    const selectBox = (
      <DriveFileSelectBox
        checked={false}
        label="Select report"
        onChange={onChange}
        palette={palettes.light}
      />
    );

    if (surface === "table") {
      render(
        <table>
          <tbody>
            <tr onDoubleClick={onSurfaceDoubleClick}>
              <td>{selectBox}</td>
            </tr>
          </tbody>
        </table>,
      );
    } else {
      render(
        <div onDoubleClick={onSurfaceDoubleClick} role="group">
          {selectBox}
        </div>,
      );
    }

    fireEvent.doubleClick(screen.getByRole("checkbox", { name: "Select report" }));
    expect(onSurfaceDoubleClick).not.toHaveBeenCalled();
  });
});
