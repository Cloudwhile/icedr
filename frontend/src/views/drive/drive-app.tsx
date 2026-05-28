"use client";

import { AuthGate } from "./auth-client";
import { LocalizedDriveShell } from "./drive-shell";
import { DriveWorkbench } from "./drive-workbench";

export function DriveApp() {
  return (
    <LocalizedDriveShell>
      {(shellState) => (
        <AuthGate>
          {(user) => <DriveWorkbench {...shellState} currentUser={user} />}
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}
