"use client";

import { LocalizedDriveShell } from "./drive-shell";
import { ExternalShareStandalone } from "./external-share";
import type { RegisteredShare } from "@/features/share/registry";
import "./styles/external-share.css";

export function ExternalShareRoute({ initialShare, token }: { initialShare?: RegisteredShare; token: string }) {
  return (
    <LocalizedDriveShell>
      {({ locale, setThemeMode, themeMode }) => (
        <ExternalShareStandalone
          key={token}
          initialShare={initialShare}
          locale={locale}
          setThemeMode={setThemeMode}
          themeMode={themeMode}
          token={token}
        />
      )}
    </LocalizedDriveShell>
  );
}
