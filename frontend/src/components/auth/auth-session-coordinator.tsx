import { useEffect } from "react";
import { showAppToast } from "@/components/ui/app-toast-store";
import { useRouter } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import {
  resetDriveApiAuthExpiredNotification,
  subscribeDriveApiAuthExpired,
} from "@/lib/drive-api";
import { createLoginRedirect } from "./auth-session-navigation";

const authEntryPaths = new Set([
  "/callback",
  "/forgot-password",
  "/login",
  "/register",
  "/reset-password",
  "/setup",
]);

export function AuthSessionCoordinator() {
  const router = useRouter();
  const t = useTranslations();

  useEffect(
    () =>
      subscribeDriveApiAuthExpired(({ hadToken }) => {
        const source = getCurrentInternalLocation();
        if (authEntryPaths.has(window.location.pathname)) {
          resetDriveApiAuthExpiredNotification();
          return;
        }

        if (hadToken) {
          showAppToast({
            dedupeKey: "auth-session-expired",
            duration: 3600,
            title: t("errors.authExpired"),
            tone: "warning",
          });
        }
        router.replace(createLoginRedirect(source));
      }),
    [router, t],
  );

  return null;
}

function getCurrentInternalLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
