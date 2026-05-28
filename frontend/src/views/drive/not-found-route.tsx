"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LocalIcon } from "./drive-primitives";
import { LegalFooter } from "./legal-footer";
import { LocalizedDriveShell, type DriveShellState } from "./drive-shell";
import { PublicPageNav } from "./public-page-nav";
import type { Palette } from "@/features/file/model";
export function NotFoundRoute() {
  return <LocalizedDriveShell>
      {state => <NotFoundContent {...state} />}
    </LocalizedDriveShell>;
}
function NotFoundContent({
  locale,
  palette,
  setLocale,
  setThemeMode,
  themeMode
}: DriveShellState) {
  const t = useTranslations();
  const router = useRouter();
  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };
  return <div style={{
    display: "flex",
    minHeight: "100dvh",
    flexDirection: "column",
    background: palette.canvas,
    color: palette.ink
  }}>
      <PublicPageNav locale={locale} palette={palette} setLocale={setLocale} setThemeMode={setThemeMode} themeMode={themeMode} />

      <div className="icedr-r-padding-inline icedr-r-padding-block" style={{
      display: "flex",
      flex: "1 1 auto",
      minHeight: "0px",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      "--r-padding-inline-base": "20px",
      "--r-padding-inline-md": "32px",
      "--r-padding-inline-xl": "48px",
      "--r-padding-block-base": "32px",
      "--r-padding-block-md": "40px"
    } as React.CSSProperties}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        alignItems: "center",
        maxWidth: "540px"
      }}>
          <h1 className="icedr-r-font-size" style={{
          color: palette.ink,
          "--r-font-size-base": "72px",
          "--r-font-size-md": "96px",
          fontWeight: "780",
          lineHeight: "1",
          letterSpacing: "0px"
        } as React.CSSProperties}>
            404
          </h1>
          <span style={{
          color: palette.muted,
          fontSize: "15px",
          lineHeight: "1.7",
          maxWidth: "500px"
        }}>
            {t("notFound.description")}
          </span>
          <div style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap"
        }}>
            <ActionButton label={t("notFound.openHome")} palette={palette} onClick={() => router.push("/")} icon="folder" />
            <ActionButton label={t("notFound.goBack")} palette={palette} onClick={goBack} icon="arrow_left" />
            <ActionButton label={t("notFound.reload")} palette={palette} onClick={() => window.location.reload()} icon="refresh" />
          </div>
        </div>
      </div>

      <LegalFooter locale={locale} palette={palette} />
    </div>;
}
function ActionButton({
  icon,
  label,
  onClick,
  palette
}: {
  icon: "arrow_left" | "folder" | "refresh";
  label: string;
  onClick: () => void;
  palette: Palette;
}) {
  return <button aria-label={label} onClick={onClick} className="icedr-has-hover icedr-has-active" style={{
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "40px",
    paddingInline: "12px",
    borderRadius: "8px",
    background: "transparent",
    color: palette.subtle,
    borderWidth: "1px",
    borderColor: palette.hairline,
    transition: "background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease), color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
    "--hover-bg": palette.surface2,
    "--hover-border-color": palette.hairlineStrong,
    "--hover-color": palette.ink,
    "--hover-transform": "translateY(-1px)",
    "--active-bg": palette.surface3,
    "--active-transform": "translateY(0) scale(0.98)"
  } as React.CSSProperties}>
      <LocalIcon name={icon} size={17} />
      <span style={{
      fontSize: "12px",
      fontWeight: "650",
      lineHeight: "1.3"
    }}>
        {label}
      </span>
    </button>;
}

