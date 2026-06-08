"use client";

import type { Palette } from "@/features/file/model";
import {
  getLegalDocument,
  getLegalDocumentEffectiveDateKey,
  getLegalDocumentIntroKey,
  getLegalDocumentSectionBodyKey,
  getLegalDocumentSectionTitleKey,
  getLegalDocumentSubtitleKey,
  getLegalDocumentTitleKey,
  getLegalTextLocale,
  type LegalDocumentKey,
  type LegalTextLocale,
} from "@/features/legal/content";
import { translateLocaleMessage } from "@/i18n/messages";
import { useTranslations } from "@/i18n/react";
import { LocalizedDriveShell, type DriveShellState } from "./drive-shell";
import { LegalFooter } from "./legal-footer";
import { LocalIcon } from "./drive-primitives";
import { PublicPageNav } from "./public-page-nav";
const orderedLegalLocales: LegalTextLocale[] = ["zh", "en"];
export function LegalPageRoute({
  documentKey
}: {
  documentKey: LegalDocumentKey;
}) {
  return <LocalizedDriveShell>
      {shellState => <LegalPage {...shellState} documentKey={documentKey} />}
    </LocalizedDriveShell>;
}
function LegalPage({
  documentKey,
  locale,
  palette,
  setThemeMode,
  siteSettings,
  themeMode
}: {
  documentKey: LegalDocumentKey;
} & DriveShellState) {
  const t = useTranslations();
  const primaryLanguage = getLegalTextLocale(locale);
  return <div style={{
    display: "flex",
    height: "100dvh",
    flexDirection: "column",
    overflow: "hidden",
    background: "transparent",
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  }}>
      <PublicPageNav palette={palette} setThemeMode={setThemeMode} siteSettings={siteSettings} themeMode={themeMode} />

      <main style={{
      flex: "1 1 auto",
      minHeight: "0px",
      overflowY: "auto",
      overscrollBehavior: "contain"
    }}>
        <div className="icedr-r-padding-inline icedr-r-padding-block" style={{
        width: "100%",
        maxWidth: "1120px",
        marginInline: "auto",
        boxSizing: "border-box",
        "--r-padding-inline-base": "16px",
        "--r-padding-inline-md": "28px",
        "--r-padding-inline-xl": "32px",
        "--r-padding-block-base": "24px",
        "--r-padding-block-md": "36px"
      } as React.CSSProperties}>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "28px"
        }}>
            <div style={{
            borderBottomWidth: "1px",
            borderColor: palette.hairline,
            paddingBottom: "24px"
          }}>
              <div style={{
              alignItems: "center",
              display: "flex",
              gap: "8px",
              color: palette.primaryHover,
              marginBottom: "12px"
            }}>
                <LocalIcon name={documentKey === "terms" ? "document" : "shield"} size={18} />
                <span style={{
                fontSize: "12px",
                fontWeight: "760",
                textTransform: "uppercase"
              }}>
                  {t("legal.sectionLabel")}
                </span>
              </div>
              <h1 style={{
              fontSize: "32px",
              fontWeight: "800",
              lineHeight: "1.12",
              letterSpacing: "0px",
              maxWidth: "820px"
            }}>
                {t(getLegalDocumentTitleKey(documentKey, primaryLanguage))}
              </h1>
              <span style={{
              marginTop: "12px",
              color: palette.subtle,
              maxWidth: "820px",
              lineHeight: "1.7"
            }}>
                {t(getLegalDocumentSubtitleKey(documentKey, primaryLanguage))}
              </span>
            </div>

            <LegalDocumentColumns documentKey={documentKey} palette={palette} />
          </div>
        </div>

        <LegalFooter locale={locale} palette={palette} siteName={siteSettings.siteName} />
      </main>
    </div>;
}
export function LegalDocumentColumns({
  documentKey,
  palette
}: {
  documentKey: LegalDocumentKey;
  palette: Palette;
}) {
  const document = getLegalDocument(documentKey);
  const t = useTranslations();
  const readLegalMessage = (language: LegalTextLocale, key: string) => translateLocaleMessage(language, key);
  return <div className="icedr-r-grid-template-columns icedr-r-gap" style={{
    display: "grid",
    "--r-grid-template-columns-base": "1fr",
    "--r-grid-template-columns-lg": "1fr 1fr",
    "--r-gap-base": "24px",
    "--r-gap-lg": "32px",
    alignItems: "start"
  } as React.CSSProperties}>
      {orderedLegalLocales.map(language => {
      return <div key={language} lang={language === "zh" ? "zh-CN" : "en"} style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        minWidth: "0px"
      }}>
            <div>
              <span style={{
            color: palette.tertiary,
            fontSize: "12px",
            fontWeight: "760",
            textTransform: "uppercase"
          }}>
                {t(`legal.language.${language}`)}
              </span>
              <h2 style={{
            marginTop: "4px",
            fontSize: "22px",
            fontWeight: "780",
            lineHeight: "1.22"
          }}>
                {readLegalMessage(language, getLegalDocumentTitleKey(documentKey, language))}
              </h2>
              <span style={{
            marginTop: "8px",
            color: palette.subtle,
            fontSize: "13px"
          }}>
                {t(`legal.effectiveDate.${language}`)}: {readLegalMessage(language, getLegalDocumentEffectiveDateKey(documentKey, language))}
              </span>
            </div>

            <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          color: palette.ink,
          lineHeight: "1.78"
        }}>
              {Array.from({ length: document.introCount }).map((_, index) => {
            const key = getLegalDocumentIntroKey(documentKey, language, index);
            return <span key={key}>{readLegalMessage(language, key)}</span>;
          })}
            </div>

            {document.sections.map(section => <div key={section.index} style={{
          borderTopWidth: "1px",
          borderColor: palette.hairline,
          paddingTop: "16px"
        }}>
                <h3 style={{
            fontSize: "17px",
            fontWeight: "760",
            lineHeight: "1.35"
          }}>
                  {readLegalMessage(language, getLegalDocumentSectionTitleKey(documentKey, language, section.index))}
                </h3>
                <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            marginTop: "12px",
            color: palette.subtle,
            lineHeight: "1.78"
          }}>
                  {Array.from({ length: section.bodyCount }).map((_, bodyIndex) => {
              const key = getLegalDocumentSectionBodyKey(documentKey, language, section.index, bodyIndex);
              return <span key={key}>{readLegalMessage(language, key)}</span>;
            })}
                </div>
              </div>)}
          </div>;
    })}
    </div>;
}

