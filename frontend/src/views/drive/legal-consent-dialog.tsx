"use client";

import { Modal } from "@heroui/react";
import { AppDialogShell } from "@/components/ui/app-dialog-shell";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale, Palette } from "@/features/file/model";
import { getLegalDocumentLabelKey, getLegalTextLocale, type LegalDocumentKey } from "@/features/legal/content";
import { useTranslations } from "@/i18n/react";
import { ProgressMeter } from "@/components/ui/progress-meter";
import { AuthPrimaryButton } from "./auth-form-primitives";
import { LocalIcon, ToolButton } from "./drive-primitives";
import { LegalDocumentColumns } from "./legal-page";
import "./styles/legal-consent.css";
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
  return (
    <AppDialogShell className="icedr-legal-consent-dialog" open={open} onOpenChange={nextOpen => !nextOpen && closeDialog()} palette={palette} size="lg">
      <Modal.Header>
        <div className="icedr-legal-consent-heading">
          <LocalIcon name="document" size={18} color={palette.primaryHover} />
          <div>
            <Modal.Heading>{t("legal.consent.title")}</Modal.Heading>
            <p>{t("legal.consent.subtitle")}</p>
          </div>
        </div>
        <ToolButton label={t("app.close")} palette={palette} onClick={closeDialog}>
          <LocalIcon name="cross" size={17} />
        </ToolButton>
      </Modal.Header>
      <Modal.Body>
        <div className="icedr-legal-consent-navigation">
          <ToolButton label={t("legal.consent.previous")} palette={palette} onClick={() => movePage(-1)}>
            <LocalIcon name="arrow_left" size={17} />
          </ToolButton>
          <div className="icedr-legal-consent-progress">
            <strong>{activePageLabel}</strong>
            <span style={{ color: readState[activePage] ? palette.success : palette.subtle }}>
              {readState[activePage] ? t("legal.consent.read") : t("legal.consent.readToBottom")}
            </span>
            <ProgressMeter ariaLabel={activePageLabel} color={readState[activePage] ? palette.success : palette.primaryHover} palette={palette} value={completionValue} />
          </div>
          <ToolButton label={t("legal.consent.next")} palette={palette} onClick={() => movePage(1)}>
            <LocalIcon name="arrow_right" size={17} />
          </ToolButton>
        </div>
        <div className="icedr-legal-consent-document" onScroll={markReadIfAtBottom} ref={scrollRef}>
          <LegalDocumentColumns documentKey={activePage} palette={palette} />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <div className="icedr-legal-consent-status" style={{ color: allRead ? palette.success : palette.subtle }}>
          <LocalIcon name={allRead ? "tick" : "info"} size={15} />
          <span>{allRead ? t("legal.consent.ready") : t("legal.consent.pending")}</span>
        </div>
        <AuthPrimaryButton disabled={!allRead} icon="tick" palette={palette} onClick={onAccept}>
          {t("legal.consent.accept")}
        </AuthPrimaryButton>
      </Modal.Footer>
    </AppDialogShell>
  );
}
