import { useEffect, useState, type ReactNode } from "react";
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
    const nextPath = pathname || "/";
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

      try {
        const currentUser = await fetchCurrentUser();
        if (cancelled) return;
        setUser(currentUser);
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        if (isAuthExpiredApiError(error)) {
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
  if (!ready) return null;
  return typeof children === "function" ? children(user) : children;
}
