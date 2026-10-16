import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { palettes, type DriveItem } from "@/features/file/model";
import { DriveItemPreview } from "./drive-item-preview";

const { createSourceUrlMock } = vi.hoisted(() => ({
  createSourceUrlMock: vi.fn(),
}));

vi.mock("@/features/file/actions", () => ({
  createWorkspaceDriveItemSourceUrl: createSourceUrlMock,
}));

let intersectionCallback: IntersectionObserverCallback = () => undefined;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "200px";
  readonly thresholds = [0];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  disconnect = disconnectMock;
  observe = observeMock;
  takeRecords = () => [];
  unobserve = vi.fn();
}

const imageItem: DriveItem = {
  colorKey: "primary",
  hasContent: true,
  id: "image-1",
  kind: "image",
  mimeType: "image/png",
  modifiedAt: "2026-10-16T00:00:00.000Z",
  name: "photo.png",
  owner: "Mina",
  parentId: null,
  shared: false,
  sizeBytes: 128,
  starred: false,
  workspaceId: "workspace-1",
};

beforeEach(() => {
  createSourceUrlMock.mockReset().mockResolvedValue("https://example.test/photo.png");
  observeMock.mockReset();
  disconnectMock.mockReset();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DriveItemPreview", () => {
  it("loads media only after entering the preload range and keeps it loaded", async () => {
    const { container } = render(
      <DriveItemPreview item={imageItem} palette={palettes.light} />,
    );

    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(createSourceUrlMock).not.toHaveBeenCalled();
    expect(container.querySelector(".drive-item-preview-media")).not.toBeInTheDocument();

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(createSourceUrlMock).toHaveBeenCalledTimes(1);
    });
    expect(createSourceUrlMock).toHaveBeenCalledWith(imageItem, "workspace-1");

    await waitFor(() => {
      expect(container.querySelector(".drive-item-preview-media")).toBeInTheDocument();
    });
    const image = container.querySelector(".drive-item-preview-media");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(disconnectMock).toHaveBeenCalled();

    act(() => {
      intersectionCallback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(container.querySelector(".drive-item-preview-media")).toBe(image);
    expect(createSourceUrlMock).toHaveBeenCalledTimes(1);
  });
});
