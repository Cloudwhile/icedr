"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { Locale, Palette } from "@/features/file/model";
import { getLegalPageLabel } from "@/features/legal/content";
export function LegalFooter({
  locale,
  palette
}: {
  locale: Locale;
  palette: Palette;
}) {
  const linkStyle: CSSProperties = {
    color: palette.subtle,
    fontSize: "12px",
    fontWeight: 650,
    lineHeight: "1.4",
    transition: "color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)"
  };
  return <footer style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    minHeight: "54px",
    paddingInline: "16px",
    paddingBlock: "12px",
    color: palette.subtle,
    borderTopWidth: "1px",
    borderColor: palette.hairline,
    background: palette.surface1,
    fontSize: "12px",
    flexWrap: "wrap"
  }}>
      <span style={{
      color: palette.tertiary
    }}>© 2026 ICEDR</span>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "12px",
      flexWrap: "wrap",
      justifyContent: "center"
    }}>
        <Link href="/terms" className="icedr-has-hover" style={{
          ...linkStyle,
          display: "inline-block",
          "--hover-color": palette.primaryHover,
          "--hover-transform": "translateY(-1px)"
        } as React.CSSProperties}>
          {getLegalPageLabel("terms", locale)}
        </Link>
        <Link href="/privacy" className="icedr-has-hover" style={{
          ...linkStyle,
          display: "inline-block",
          "--hover-color": palette.primaryHover,
          "--hover-transform": "translateY(-1px)"
        } as React.CSSProperties}>
          {getLegalPageLabel("privacy", locale)}
        </Link>
      </div>
    </footer>;
}
