"use client";

import Link from "@/compat/link";
import { ThemeActions, type DriveShellState } from "./drive-shell";
import { AppImage } from "@/components/ui/app-image";

type PublicPageNavProps = Pick<DriveShellState, "palette" | "setThemeMode" | "themeMode">;

export function PublicPageNav({
  palette,
  setThemeMode,
  themeMode
}: PublicPageNavProps) {
  return <header style={{
    display: "flex",
    alignItems: "center",
    minHeight: "56px",
    flexShrink: "0",
    borderBottomWidth: "1px",
    borderColor: palette.hairline,
    background: palette.surface1
  } as React.CSSProperties}>
      <div className="icedr-r-padding-inline" style={{
      alignItems: "center",
      display: "flex",
      justifyContent: "space-between",
      gap: "16px",
      width: "100%",
      boxSizing: "border-box",
      "--r-padding-inline-base": "16px",
      "--r-padding-inline-md": "20px",
      "--r-padding-inline-xl": "24px"
    } as React.CSSProperties}>
        <Link href="/" aria-label="ICEDR">
          <div className="icedr-has-hover icedr-has-active" style={{
        alignItems: "center",
        display: "flex",
        gap: "10px",
        minWidth: "0px",
        borderRadius: "8px",
        transition: "opacity var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
        "--hover-opacity": "0.82",
        "--hover-transform": "translateY(-1px)",
        "--active-transform": "translateY(0) scale(0.98)"
      } as React.CSSProperties}>
            <AppImage src="/logo.png" alt="" priority style={{
          width: "34px",
          height: "34px",
          objectFit: "contain",
          flexShrink: "0"
        }} />
            <span className="icedr-truncate" style={{
          color: palette.ink,
          fontSize: "14px",
          fontWeight: "750",
          lineHeight: "1.2"
        }}>
              ICEDR
            </span>
          </div>
        </Link>
        <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
      </div>
    </header>;
}
