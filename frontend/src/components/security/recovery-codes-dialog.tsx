"use client";

import { useState } from "react";
import type { Palette } from "@/features/file/model";
import { useLocale, useTranslations } from "@/i18n/react";
import type { RecoveryCodeSet } from "@/lib/drive-api";
import { ActionButton } from "@/components/ui/action-button";
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogShell,
  AppDialogTitle,
} from "@/components/ui/app-dialog-shell";
import { LocalIcon } from "@/components/ui/app-icon";
import { showAppToast } from "@/components/ui/app-toast-store";
import { ToolButton } from "@/components/ui/tool-button";
import "./security-dialogs.css";

export function RecoveryCodesDialog({
  codeSet,
  onClose,
  palette,
}: {
  codeSet: RecoveryCodeSet | null;
  onClose: () => void;
  palette: Palette;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const [busyAction, setBusyAction] = useState<"copy" | "download" | null>(null);
  const codes = codeSet?.codes ?? [];

  const copyCodes = () => {
    if (codes.length === 0 || busyAction) return;
    setBusyAction("copy");
    void copyText(codes.join("\n"))
      .then(() =>
        showAppToast({
          title: t("settings.recoveryCodesCopied"),
          tone: "success",
        }),
      )
      .finally(() => setBusyAction(null));
  };

  const downloadCodes = () => {
    if (!codeSet || busyAction) return;
    setBusyAction("download");
    const generatedAt = formatDate(codeSet.generatedAt, locale);
    const content = [
      t("settings.recoveryCodesTitle"),
      t("settings.recoveryCodesGeneratedAt", { date: generatedAt }),
      "",
      ...codes,
      "",
      t("settings.recoveryCodesOneTimeWarning"),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.download = `icedr-recovery-codes-${new Date(codeSet.generatedAt).toISOString().slice(0, 10)}.txt`;
    anchor.href = url;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setBusyAction(null);
  };

  return (
    <AppDialogShell
      className="icedr-recovery-codes-dialog"
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      open={Boolean(codeSet)}
      palette={palette}
      scroll="inside"
      size="md"
    >
      <AppDialogHeader className="icedr-security-dialog-header">
        <div className="icedr-security-dialog-heading">
          <LocalIcon name="shield" size={18} />
          <div>
            <AppDialogTitle>{t("settings.recoveryCodesTitle")}</AppDialogTitle>
            <span>
              {codeSet
                ? t("settings.recoveryCodesGeneratedAt", {
                    date: formatDate(codeSet.generatedAt, locale),
                  })
                : ""}
            </span>
          </div>
        </div>
        <div className="icedr-recovery-code-tools">
          <ToolButton
            isPending={busyAction === "copy"}
            label={t("settings.recoveryCodesCopyAll")}
            onClick={copyCodes}
            palette={palette}
            visual="surface"
          >
            <LocalIcon name="copy" size={16} />
          </ToolButton>
          <ToolButton
            isPending={busyAction === "download"}
            label={t("settings.recoveryCodesDownload")}
            onClick={downloadCodes}
            palette={palette}
            visual="surface"
          >
            <LocalIcon name="download" size={16} />
          </ToolButton>
          <ToolButton
            disabled={Boolean(busyAction)}
            label={t("actions.close")}
            onClick={onClose}
            palette={palette}
          >
            <LocalIcon name="cross" size={16} />
          </ToolButton>
        </div>
      </AppDialogHeader>
      <AppDialogBody>
        <div className="icedr-recovery-codes-warning">
          <LocalIcon name="exclamation" size={17} />
          <span>{t("settings.recoveryCodesOneTimeWarning")}</span>
        </div>
        <ol className="icedr-recovery-codes-list">
          {codes.map((code, index) => (
            <li key={code}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <code>{code}</code>
            </li>
          ))}
        </ol>
      </AppDialogBody>
      <AppDialogFooter>
        <ActionButton
          icon={<LocalIcon name="tick" size={16} />}
          onClick={onClose}
          palette={palette}
          tone="primary"
        >
          {t("settings.recoveryCodesSaved")}
        </ActionButton>
      </AppDialogFooter>
    </AppDialogShell>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
