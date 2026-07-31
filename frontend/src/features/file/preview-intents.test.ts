import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchDriveApiResponseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/drive-api", () => ({
  fetchDriveApiResponse: fetchDriveApiResponseMock,
}));

import { fetchPreviewIntentStatus, type PreviewIntentResponse } from "./preview-intents";

function createIntent(statusUrl: string): PreviewIntentResponse {
  return {
    capability: {
      downloadOnly: false,
      maxPreviewBytes: null,
      reason: "previewable",
      renderMode: "text",
      sanitized: false,
      supported: true,
    },
    nodeId: "node-1",
    previewId: "preview-1",
    previewType: "text",
    renderMode: "text",
    status: "pending",
    statusUrl,
  };
}

describe("fetchPreviewIntentStatus", () => {
  beforeEach(() => {
    fetchDriveApiResponseMock.mockReset();
    fetchDriveApiResponseMock.mockResolvedValue(Response.json(createIntent("/preview/status")));
  });

  it("keeps workspace previews on required session handling regardless of the status URL", async () => {
    const intent = createIntent("/file-nodes/node-1/preview/status?return=/shares/example");

    await fetchPreviewIntentStatus(intent);

    expect(fetchDriveApiResponseMock).toHaveBeenCalledWith(
      expect.stringContaining("return=/shares/example&previewId=preview-1"),
      expect.objectContaining({ headers: {}, signal: undefined }),
      {
        auth: "required",
        fallbackMessage: "Preview status failed",
        unauthorized: "session",
      },
    );
  });

  it("uses local unauthorized handling only when the caller marks a shared preview", async () => {
    const intent = createIntent("/preview/status");

    await fetchPreviewIntentStatus(intent, {
      accessSessionId: "share-session",
      shared: true,
    });

    expect(fetchDriveApiResponseMock).toHaveBeenCalledWith(
      "/preview/status?previewId=preview-1",
      {
        headers: { "X-Share-Access-Session": "share-session" },
        signal: undefined,
      },
      {
        auth: "optional",
        fallbackMessage: "Preview status failed",
        unauthorized: "local",
      },
    );
  });
});
