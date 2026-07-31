import {
  DriveApiError,
  getStoredAuthToken,
  handleDriveApiUnauthorized,
  type TransferTaskFailureCode,
} from "@/lib/drive-api";

export type UploadChunkResponse = {
  partIndex: number;
  progress: number;
  sessionId: string;
  uploadedBytes: number;
  uploadedPartIndexes: number[];
};

export function uploadObjectWithProgress({
  file,
  headers,
  onRequest,
  onProgress,
  url,
}: {
  file: File;
  headers: Record<string, string>;
  onRequest?: (request: XMLHttpRequest | null) => void;
  onProgress: (loadedBytes: number, totalBytes: number) => void;
  url: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      onRequest?.(null);
      callback();
    };
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        settle(() =>
          reject(
            new DriveApiError(
              "Object upload stalled",
              undefined,
              "TRANSFER_STALLED",
            ),
          ),
        );
        request.abort();
      }, 45000);
    };

    request.open("PUT", url);
    request.timeout = 120000;
    Object.entries(headers).forEach(([key, value]) =>
      request.setRequestHeader(key, value),
    );
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      armStallTimer();
      onProgress(event.loaded, event.total || file.size);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size, file.size);
        settle(resolve);
        return;
      }
      settle(() =>
        reject(
          createUploadXhrError(
            request,
            "Object upload failed",
            "UPLOAD_FAILED",
          ),
        ),
      );
    };
    request.onerror = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Object upload failed",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    request.onabort = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Object upload aborted",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    request.ontimeout = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Object upload timed out",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    onRequest?.(request);
    armStallTimer();
    request.send(file);
  });
}

export function uploadChunkWithProgress({
  chunk,
  onRequest,
  onProgress,
  url,
}: {
  chunk: Blob;
  onRequest?: (request: XMLHttpRequest | null) => void;
  onProgress: (loadedBytes: number) => void;
  url: string;
}) {
  return new Promise<UploadChunkResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const requestToken = getStoredAuthToken();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      onRequest?.(null);
      callback();
    };
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        settle(() =>
          reject(
            new DriveApiError(
              "Upload chunk stalled",
              undefined,
              "TRANSFER_STALLED",
            ),
          ),
        );
        request.abort();
      }, 45000);
    };

    request.open("PUT", url);
    request.timeout = 120000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    if (requestToken) {
      request.setRequestHeader("Authorization", `Bearer ${requestToken}`);
    }
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      armStallTimer();
      onProgress(event.loaded);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(chunk.size);
        try {
          const response = JSON.parse(
            request.responseText,
          ) as UploadChunkResponse;
          settle(() => resolve(response));
        } catch {
          settle(() =>
            reject(
              new DriveApiError(
                "Upload chunk response failed",
                request.status,
                "UPLOAD_FAILED",
              ),
            ),
          );
        }
        return;
      }
      const error = createUploadXhrError(
        request,
        "Upload chunk failed",
        "UPLOAD_FAILED",
      );
      handleDriveApiUnauthorized(error, {
        auth: "required",
        requestToken,
        unauthorized: "session",
      });
      settle(() => reject(error));
    };
    request.onerror = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Upload chunk failed",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    request.onabort = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Upload chunk aborted",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    request.ontimeout = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Upload chunk timed out",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    onRequest?.(request);
    armStallTimer();
    request.send(chunk);
  });
}

export function uploadRawChunkWithProgress({
  chunk,
  headers,
  onRequest,
  onProgress,
  url,
}: {
  chunk: Blob;
  headers: Record<string, string>;
  onRequest?: (request: XMLHttpRequest | null) => void;
  onProgress: (loadedBytes: number) => void;
  url: string;
}) {
  return new Promise<{ eTag: string | null }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      onRequest?.(null);
      callback();
    };
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        settle(() =>
          reject(
            new DriveApiError(
              "Upload chunk stalled",
              undefined,
              "TRANSFER_STALLED",
            ),
          ),
        );
        request.abort();
      }, 45000);
    };

    request.open("PUT", url);
    request.timeout = 120000;
    Object.entries(headers).forEach(([key, value]) =>
      request.setRequestHeader(key, value),
    );
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      armStallTimer();
      onProgress(event.loaded);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(chunk.size);
        settle(() =>
          resolve({ eTag: request.getResponseHeader("ETag") }),
        );
        return;
      }
      settle(() =>
        reject(
          createUploadXhrError(
            request,
            "Upload chunk failed",
            "UPLOAD_FAILED",
          ),
        ),
      );
    };
    request.onerror = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Upload chunk failed",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    request.onabort = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Upload chunk aborted",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    request.ontimeout = () =>
      settle(() =>
        reject(
          new DriveApiError(
            "Upload chunk timed out",
            undefined,
            "UPLOAD_FAILED",
          ),
        ),
      );
    onRequest?.(request);
    armStallTimer();
    request.send(chunk);
  });
}

function createUploadXhrError(
  request: XMLHttpRequest,
  fallbackMessage: string,
  fallbackCode: TransferTaskFailureCode,
) {
  let message = fallbackMessage;
  let code: string | undefined = fallbackCode;
  let currentStatus: string | undefined;
  let retryAfter: number | undefined;
  const contentType = request.getResponseHeader("Content-Type") ?? "";
  if (
    contentType.toLowerCase().includes("application/json") ||
    request.responseText.trimStart().startsWith("{")
  ) {
    try {
      const body = JSON.parse(request.responseText) as Record<string, unknown>;
      if (typeof body.message === "string" && body.message.trim()) {
        message = body.message;
      }
      if (typeof body.code === "string") code = body.code;
      if (typeof body.currentStatus === "string") {
        currentStatus = body.currentStatus;
      }
      if (
        typeof body.retryAfter === "number" &&
        Number.isFinite(body.retryAfter) &&
        body.retryAfter >= 0
      ) {
        retryAfter = body.retryAfter;
      }
    } catch {
      // Keep the stable upload fallback for malformed error responses.
    }
  }
  return new DriveApiError(
    message,
    request.status || undefined,
    code,
    retryAfter,
    currentStatus,
  );
}
