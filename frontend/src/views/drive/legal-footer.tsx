"use client";

import Link from "@/compat/link";
import type { CSSProperties } from "react";
import type { Locale, Palette } from "@/features/file/model";
import { getLegalDocumentLabelKey, getLegalTextLocale } from "@/features/legal/content";
import { resolvePublicSiteName } from "@/lib/drive-api";
import { useTranslations } from "@/i18n/react";
export function LegalFooter({
  locale,
  palette,
  siteName
}: {
  locale: Locale;
  palette: Palette;
  siteName: string;
}) {
  const t = useTranslations();
  const language = getLegalTextLocale(locale);
  const resolvedSiteName = resolvePublicSiteName(siteName);
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
    background: "transparent",
    fontSize: "12px",
    flexWrap: "wrap"
  }}>
      <span style={{
      color: palette.tertiary
    }}>© 2026 {resolvedSiteName}</span>
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
          {t(getLegalDocumentLabelKey("terms", language))}
        </Link>
        <Link href="/privacy" className="icedr-has-hover" style={{
          ...linkStyle,
          display: "inline-block",
          "--hover-color": palette.primaryHover,
          "--hover-transform": "translateY(-1px)"
        } as React.CSSProperties}>
          {t(getLegalDocumentLabelKey("privacy", language))}
        </Link>
      </div>
    </footer>;
}
