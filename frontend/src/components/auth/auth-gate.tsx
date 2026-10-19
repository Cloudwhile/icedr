import { useEffect, useState, type ReactNode } from "react";
import { LdrsLoadingState } from "@/components/common/ui/loading-state";
import { showAppToast } from "@/components/ui/app-toast-store";
import { getStoredAuthToken } from "@/lib/drive-api-client";
import { createLoginRedirect } from "./auth-session-navigation";
import { ApiErrorState } from "@/components/ui/app-error-boundary";
import { usePathname, useRouter } from "@/compat/navigation";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  fetchCurrentUser,
  fetchSetupStatus,
  type AuthUser,
} from "@/lib/drive-api";
import {
  getDriveApiErrorMessage,
  isAuthExpiredApiError,
} from "@/lib/drive-api-errors";

export function AuthGate({
  children,
  palette,
}: {
  children: ReactNode | ((user: AuthUser | null) => ReactNode);
  palette: Palette;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    void (async () => {
      try {
        const setup = await fetchSetupStatus();
        if (cancelled) return;
        if (setup.needsSetup) {
          router.replace(`/setup?next=${encodeURIComponent(nextPath)}`);
          return;
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(getDriveApiErrorMessage(error, t, {
            fallbackKey: "errors.unknown",
          }));
        }
        return;
      }

      const requestToken = getStoredAuthToken();
      try {
        // The gate owns this redirect; ordinary protected requests still use the coordinator.
        const currentUser = await fetchCurrentUser({ auth: "optional" });
        if (cancelled) return;
        if (getStoredAuthToken() !== requestToken) {
          setRetryRevision((revision) => revision + 1);
          return;
        }
        setUser(currentUser);
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        if (isAuthExpiredApiError(error)) {
          const currentToken = getStoredAuthToken();
          if (currentToken && currentToken !== requestToken) {
            setRetryRevision((revision) => revision + 1);
            return;
          }
          if (requestToken) showAppToast({ dedupeKey: "auth-session-expired", duration: 3600, title: t("errors.authExpired"), tone: "warning" });
          router.replace(createLoginRedirect(nextPath));
          return;
        }
        setLoadError(getDriveApiErrorMessage(error, t, {
          fallbackKey: "errors.unknown",
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, retryRevision, router, t]);

  if (loadError) {
    return (
      <ApiErrorState
        detail="ACCESS_CHECK_FAILED"
        fillViewport
        message={loadError}
        onRetry={() => {
          setLoadError(null);
          setReady(false);
          setRetryRevision((revision) => revision + 1);
        }}
        palette={palette}
        retryLabel={t("app.errorBoundary.retry")}
        title={t("errors.server")}
      />
    );
  }
  if (!ready) return <LdrsLoadingState label={t("app.loading")} minHeight="100dvh" palette={palette} />;
  return typeof children === "function" ? children(user) : children;
}
