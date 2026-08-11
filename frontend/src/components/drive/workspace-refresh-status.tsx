"use client";

import { getIntlLocale, type Locale, type Palette } from "@/features/file/model";
import { useLocale, useTranslations } from "@/i18n/react";
import type { DriveRefreshSummary, DriveRefreshTarget } from "@/views/drive/drive-refresh-result";
import { LocalIcon } from "@/views/drive/drive-primitives";
import { ToolButton } from "@/components/ui/tool-button";
import "./workspace-refresh-status.css";

export function WorkspaceRefreshStatus({
  onRetry,
  palette,
  refreshing,
  summary,
}: {
  onRetry: () => void;
  palette: Palette;
  refreshing: boolean;
  summary: DriveRefreshSummary | null;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  if (!summary || summary.status === "success") return null;

  const failedModules = [...new Set(summary.incomplete.map((outcome) => getTargetLabel(outcome.target, t)))];
  const stale = summary.incomplete.some((outcome) => outcome.status === "failed" && outcome.stale);

  return (
    <div
      className="drive-refresh-status"
      data-tone={summary.status === "failed" ? "danger" : "warning"}
      role="status"
    >
      <span aria-hidden="true" className="drive-refresh-status-icon">
        <LocalIcon name="exclamation" size={17} />
      </span>
      <span className="drive-refresh-status-copy">
        <strong>{t(summary.status === "failed" ? "app.refreshFailed" : "app.refreshPartial")}</strong>
        <span>{t("app.refreshFailedModules", {
          modules: new Intl.ListFormat(getIntlLocale(locale), { style: "short", type: "conjunction" }).format(failedModules),
        })}</span>
        {stale ? <span>{t("app.refreshStaleHint")}</span> : null}
      </span>
      <ToolButton
        disabled={refreshing}
        isPending={refreshing}
        label={t("app.errorBoundary.retry")}
        onClick={onRetry}
        palette={palette}
        size="sm"
        visual="surface"
      >
        <LocalIcon name="refresh" size={15} />
      </ToolButton>
    </div>
  );
}

function getTargetLabel(
  target: DriveRefreshTarget,
  t: ReturnType<typeof useTranslations>,
) {
  return t(`app.refreshTarget.${target}`);
}
