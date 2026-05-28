"use client";

import { LocalizedDriveShell } from "./drive-shell";
import { ExternalShareStandalone } from "./external-share";
import type { RegisteredShare } from "@/features/share/registry";

export function ExternalShareRoute({ initialShare, token }: { initialShare?: RegisteredShare; token: string }) {
  return (
    <LocalizedDriveShell>
      {({ locale, setLocale, setThemeMode, themeMode }) => (
        <ExternalShareStandalone
          key={token}
          initialShare={initialShare}
          locale={locale}
          setLocale={setLocale}
          setThemeMode={setThemeMode}
          themeMode={themeMode}
          token={token}
        />
      )}
    </LocalizedDriveShell>
  );
}
