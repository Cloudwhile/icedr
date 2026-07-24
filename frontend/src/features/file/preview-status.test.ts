import { describe, expect, it } from "vitest";
import {
  getPreviewStatusMessageKey,
  getPreviewTitleMessageKey,
} from "./preview-status";

describe("preview status", () => {
  it("shows a structured lifecycle failure before a generic capability hint", () => {
    const intent = {
      lifecycle: {
        errorCode: "PREVIEW_TOO_LARGE",
        status: "failed",
        retryable: false,
      },
    };
    const capability = {
      downloadOnly: true,
      supported: false,
    };

    expect(getPreviewStatusMessageKey(intent, capability))
      .toBe("transfers.failureReason.PREVIEW_TOO_LARGE");
    expect(getPreviewTitleMessageKey(intent, capability))
      .toBe("transfers.failureReason.PREVIEW_TOO_LARGE");
  });

  it("shows an expired lifecycle reason before unsupported capability text", () => {
    expect(getPreviewStatusMessageKey({
      lifecycle: {
        errorCode: "DOWNLOAD_INTENT_EXPIRED",
        status: "expired",
        retryable: false,
      },
    }, {
      downloadOnly: false,
      supported: false,
    })).toBe("transfers.failureReason.DOWNLOAD_INTENT_EXPIRED");
  });

  it("fails closed when the nested lifecycle status is unknown", () => {
    expect(getPreviewStatusMessageKey({
      lifecycle: {
        status: "future-status",
        retryable: true,
      },
    }, {
      downloadOnly: true,
      supported: false,
    })).toBe("transfers.failureReason.TRANSFER_FAILED");
  });

  it("uses capability hints when there is no failed lifecycle", () => {
    expect(getPreviewStatusMessageKey(null, {
      downloadOnly: true,
      supported: false,
    })).toBe("preview.downloadOnlyHint");
    expect(getPreviewStatusMessageKey(null, {
      downloadOnly: false,
      supported: false,
    })).toBe("preview.unsupportedHint");
    expect(getPreviewTitleMessageKey(null, {
      downloadOnly: true,
      supported: false,
    })).toBe("preview.unsupportedHint");
  });
});
