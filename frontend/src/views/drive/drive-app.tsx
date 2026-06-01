"use client";

import { AuthGate } from "./auth-client";
import { LocalizedDriveShell } from "./drive-shell";
import { DriveWorkbench } from "./drive-workbench";

export function DriveApp({
  initialPreviewItemId,
}: {
  initialPreviewItemId?: string | null;
} = {}) {
  return (
    <LocalizedDriveShell>
      {(shellState) => (
        <AuthGate>
          {(user) => <DriveWorkbench {...shellState} currentUser={user} initialPreviewItemId={initialPreviewItemId} />}
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}
