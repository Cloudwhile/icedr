"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { LocalizedDriveShell } from "./drive-shell";
import { DriveWorkbench } from "./drive-workbench";
import type { DriveUserNav } from "@/features/file/model";
import "./styles/index.css";

export function DriveApp({
  initialActiveNav,
  initialPreviewItemId,
}: {
  initialActiveNav?: DriveUserNav;
  initialPreviewItemId?: string | null;
} = {}) {
  return (
    <LocalizedDriveShell>
      {(shellState) => (
        <AuthGate palette={shellState.palette}>
          {(user) => <DriveWorkbench {...shellState} currentUser={user} initialActiveNav={initialActiveNav} initialPreviewItemId={initialPreviewItemId} />}
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}
