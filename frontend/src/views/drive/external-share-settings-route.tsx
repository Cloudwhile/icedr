"use client";

import { LocalizedDriveShell } from "./drive-shell";
import { ExternalShareAdminSettingsPage } from "./external-share";
import { AuthGate } from "./auth-client";

export function ExternalShareSettingsRoute() {
  return (
    <LocalizedDriveShell>
      {({ locale, setLocale, setThemeMode, themeMode }) => (
        <AuthGate>
          <ExternalShareAdminSettingsPage
            locale={locale}
            setLocale={setLocale}
            setThemeMode={setThemeMode}
            themeMode={themeMode}
          />
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}
