"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "@/compat/navigation";
import { isAdminUser } from "@/features/auth/permissions";
import type { ThemeMode } from "@/features/file/model";
import type { AuthUser } from "@/lib/drive-api";
import { LocalizedDriveShell } from "./drive-shell";
import { ExternalShareAdminSettingsPage } from "./external-share";
import { AuthGate } from "./auth-client";

export function ExternalShareSettingsRoute() {
  return (
    <LocalizedDriveShell>
      {({ setThemeMode, themeMode }) => (
        <AuthGate>
          {(user) => (
            <AdminSettingsGate
              setThemeMode={setThemeMode}
              themeMode={themeMode}
              user={user}
            />
          )}
        </AuthGate>
      )}
    </LocalizedDriveShell>
  );
}

function AdminSettingsGate({
  setThemeMode,
  themeMode,
  user,
}: {
  setThemeMode: Dispatch<SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
  user: AuthUser | null;
}) {
  const router = useRouter();
  const canOpenAdmin = isAdminUser(user);

  useEffect(() => {
    if (!canOpenAdmin) router.replace("/");
  }, [canOpenAdmin, router]);

  if (!canOpenAdmin) return null;

  return (
    <ExternalShareAdminSettingsPage
      setThemeMode={setThemeMode}
      themeMode={themeMode}
    />
  );
}
