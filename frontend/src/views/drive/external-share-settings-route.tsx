"use client";

import { LocalizedDriveShell } from "./drive-shell";
import { ExternalShareAdminSettingsPage } from "./external-share";
import { AuthGate } from "./auth-client";

export function ExternalShareSettingsRoute() {
  return (
    <LocalizedDriveShell>
      {({ setThemeMode, themeMode }) => (
        <AuthGate>
          <ExternalShareAdminSettingsPage
            setThemeMode={setThemeMode}
            themeMode={themeMode}
          />
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}
