"use client";

import { useRouter } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { Suspense, useEffect, useState } from "react";
import { completeOAuthCallback, setStoredAuthToken } from "@/lib/drive-api";
import type { Palette } from "@/features/file/model";
import { AuthPrimaryButton, AuthStatusNotice, type AuthNoticeStatus } from "./auth-form-primitives";
import { LocalizedDriveShell } from "./drive-shell";
import { LocalIcon, Surface } from "./drive-primitives";
export function OAuthCallbackRoute() {
  return <Suspense fallback={null}>
      <LocalizedDriveShell>
        {({
        palette
      }) => <OAuthCallbackPage palette={palette} />}
      </LocalizedDriveShell>
    </Suspense>;
}
function OAuthCallbackPage({
  palette
}: {
  palette: Palette;
}) {
  const router = useRouter();
  const t = useTranslations();
  const [status, setStatus] = useState<AuthNoticeStatus>({
    tone: "info",
    message: t("auth.oauthCompleting")
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const callbackUrl = window.location.href;
    void completeOAuthCallback({
      callbackUrl
    }).then(session => {
      setStoredAuthToken(session.token);
      setStatus({
        tone: "success",
        message: t("auth.oauthCompleted")
      });
      router.replace("/");
    }).catch(() => {
      setStatus({
        tone: "error",
        message: t("auth.oauthExchangeFailed")
      });
    });
  }, [router, t]);
  return <div style={{
    display: "flex",
    minHeight: "100dvh",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: palette.ink,
    paddingInline: "16px"
  }}>
      <div style={{
      width: "min(420px, 100%)"
    }}>
        <Surface palette={palette} style={{
        padding: "20px"
      }}>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}>
            <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: palette.primaryHover
          }}>
              <LocalIcon name="key" size={24} />
            </div>
            <span style={{
            textAlign: "center",
            fontWeight: "760"
          }}>{t("auth.oauthCallbackTitle")}</span>
            <AuthStatusNotice palette={palette} status={status} />
            {status.tone === "error" ? <AuthPrimaryButton icon="arrow_left" palette={palette} onClick={() => router.replace("/login")}>
                {t("auth.backToLogin")}
              </AuthPrimaryButton> : null}
          </div>
        </Surface>
      </div>
    </div>;
}
