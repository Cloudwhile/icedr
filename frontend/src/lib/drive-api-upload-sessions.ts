import { requestDriveApi } from "./drive-api-client";
import type { UploadSessionRecoveryResponse } from "./drive-api-types";

export function fetchUploadSessionRecovery(sessionId: string) {
  return requestDriveApi<UploadSessionRecoveryResponse>(
    `/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}`,
  );
}

export function cancelUploadSessionRecovery(sessionId: string) {
  return requestDriveApi<unknown>(
    `/file-nodes/upload-sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST" },
  );
}
