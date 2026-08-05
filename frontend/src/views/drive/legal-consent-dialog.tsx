"use client";

import { Modal } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale, Palette } from "@/features/file/model";
import { getLegalDocumentLabelKey, getLegalTextLocale, type LegalDocumentKey } from "@/features/legal/content";
import { useTranslations } from "@/i18n/react";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { AuthPrimaryButton } from "./auth-form-primitives";
import { LocalIcon, ToolButton } from "./drive-primitives";
import { LegalDocumentColumns } from "./legal-page";
const legalPages: LegalDocumentKey[] = ["terms", "privacy"];
export function LegalConsentDialog({
  locale,
  onAccept,
  onClose,
  open,
  palette
}: {
  locale: Locale;
  onAccept: () => void;
  onClose: () => void;
  open: boolean;
  palette: Palette;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [readState, setReadState] = useState<Record<LegalDocumentKey, boolean>>({
    privacy: false,
    terms: false
  });
  const t = useTranslations();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activePage = legalPages[pageIndex];
  const allRead = readState.terms && readState.privacy;
  const completedPages = legalPages.filter(page => readState[page]).length;
  const completionValue = completedPages / legalPages.length * 100;
  const legalLanguage = getLegalTextLocale(locale);
  const activePageLabel = t(getLegalDocumentLabelKey(activePage, legalLanguage));
  const markReadIfAtBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 16) {
      setReadState(current => ({
        ...current,
        [activePage]: true
      }));
    }
  }, [activePage]);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      markReadIfAtBottom();
    });
  }, [activePage, markReadIfAtBottom, open]);
  const closeDialog = () => {
    setPageIndex(0);
    setReadState({
      privacy: false,
      terms: false
    });
    onClose();
  };
  const movePage = (direction: -1 | 1) => {
    setPageIndex(value => (value + direction + legalPages.length) % legalPages.length);
  };
  return <Modal.Backdrop isOpen={open} onOpenChange={nextOpen => !nextOpen && closeDialog()} style={{
        background: palette.backdrop
      }}>
        <Modal.Container placement="center">
          <Modal.Dialog style={{
          background: palette.overlay,
          borderColor: palette.hairlineStrong,
          borderWidth: "1px",
          boxShadow: palette.shadowDialog,
          color: palette.ink,
          maxHeight: "calc(100dvh - 28px)",
          overflow: "hidden",
          borderRadius: "8px",
          width: "min(980px, calc(100vw - 24px))"
        }}>
            <Modal.Header className="icedr-r-padding-inline" style={{
            borderBottomWidth: "1px",
            borderColor: palette.hairline,
            "--r-padding-inline-base": "12px",
            "--r-padding-inline-md": "16px",
            paddingBlock: "12px"
          } as React.CSSProperties}>
              <div style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              justifyContent: "space-between"
            }}>
                <div style={{
                alignItems: "center",
                display: "flex",
                gap: "12px",
                minWidth: "0px"
              }}>
                  <LocalIcon name="document" size={18} color={palette.primaryHover} />
                  <div style={{
                  minWidth: "0px"
                }}>
                    <Modal.Heading className="icedr-truncate" style={{
                      fontWeight: "780"
                    }}>
                    {t("legal.consent.title")}
                    </Modal.Heading>
                    <span className="icedr-truncate" style={{
                    color: palette.subtle,
                    fontSize: "12px"
                  }}>
                      {t("legal.consent.subtitle")}
                    </span>
                  </div>
                </div>
                <ToolButton label={t("app.close")} palette={palette} onClick={closeDialog}>
                  <LocalIcon name="cross" size={17} />
                </ToolButton>
              </div>
            </Modal.Header>

            <Modal.Body style={{
            padding: "0px"
          }}>
              <div className="icedr-r-padding-inline" style={{
              display: "grid",
              alignItems: "center",
              borderBottomWidth: "1px",
              borderColor: palette.hairline,
              gap: "8px",
              gridTemplateColumns: "40px minmax(0, 1fr) 40px",
              "--r-padding-inline-base": "12px",
              "--r-padding-inline-md": "16px",
              paddingBlock: "12px"
            } as React.CSSProperties}>
                <ToolButton label={t("legal.consent.previous")} palette={palette} onClick={() => movePage(-1)}>
                  <LocalIcon name="arrow_left" size={17} />
                </ToolButton>
                <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                minWidth: "0px"
              }}>
                  <span className="icedr-truncate" style={{
                  fontWeight: "760"
                }}>
                    {activePageLabel}
                  </span>
                  <span style={{
                  color: readState[activePage] ? palette.success : palette.subtle,
                  fontSize: "12px"
                }}>
                    {readState[activePage] ? t("legal.consent.read") : t("legal.consent.readToBottom")}
                  </span>
                  <div style={{
                  width: "min(280px, 100%)"
                }}>
                    <ProgressMeter ariaLabel={activePageLabel} color={readState[activePage] ? palette.success : palette.primaryHover} palette={palette} value={completionValue} />
                  </div>
                </div>
                <ToolButton label={t("legal.consent.next")} palette={palette} onClick={() => movePage(1)}>
                  <LocalIcon name="arrow_right" size={17} />
                </ToolButton>
              </div>

              <div ref={scrollRef} style={{
              WebkitOverflowScrolling: "touch",
              maxHeight: "min(58dvh, 560px)",
              overflowY: "auto",
              "--r-padding-inline-base": "16px",
              "--r-padding-inline-md": "20px",
              paddingBlock: "20px"
            } as React.CSSProperties} onScroll={markReadIfAtBottom} className="icedr-r-padding-inline">
                <LegalDocumentColumns documentKey={activePage} palette={palette} />
              </div>

              <div className="icedr-r-align-items icedr-r-flex-direction icedr-r-padding-inline" style={{
              display: "flex",
              "--r-align-items-base": "stretch",
              "--r-align-items-md": "center",
              borderColor: palette.hairline,
              borderTopWidth: "1px",
              "--r-flex-direction-base": "column",
              "--r-flex-direction-md": "row",
              gap: "12px",
              justifyContent: "space-between",
              "--r-padding-inline-base": "12px",
              "--r-padding-inline-md": "16px",
              paddingBlock: "12px"
            } as React.CSSProperties}>
                <div style={{
                alignItems: "center",
                display: "flex",
                color: allRead ? palette.success : palette.subtle,
                fontSize: "12px",
                gap: "8px"
              }}>
                  <LocalIcon name={allRead ? "tick" : "info"} size={15} />
                  <span>{allRead ? t("legal.consent.ready") : t("legal.consent.pending")}</span>
                </div>
                <div className="icedr-r-width" style={{
                "--r-width-base": "100%",
                "--r-width-md": "220px"
              } as React.CSSProperties}>
                  <AuthPrimaryButton disabled={!allRead} icon="tick" palette={palette} onClick={onAccept}>
                    {t("legal.consent.accept")}
                  </AuthPrimaryButton>
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>;
}
