import { useCallback } from "react";
import { showWorkspaceNotification } from "@/components/ui/workspace-notification-store";
import { getIntlLocale, type Locale } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type { DriveRefreshSummary, DriveRefreshTarget } from "./drive-refresh-result";

export function useDriveRefreshFeedback(locale: Locale) {
  const t = useTranslations();

  return useCallback((summary: DriveRefreshSummary) => {
    if (summary.status === "success") {
      showWorkspaceNotification({
        dedupeKey: "workspace-refresh-success",
        title: t("app.refreshed"),
        tone: "success",
      });
      return;
    }

    const moduleNames = [...new Set(summary.incomplete.map((outcome) => getRefreshTargetLabel(outcome.target, t)))];
    const modules = new Intl.ListFormat(getIntlLocale(locale), {
      style: "short",
      type: "conjunction",
    }).format(moduleNames);
    const stale = summary.incomplete.some((outcome) => outcome.status === "failed" && outcome.stale);
    showWorkspaceNotification({
      dedupeKey: `workspace-refresh-${summary.status}`,
      description: `${t("app.refreshFailedModules", { modules })}${stale ? ` ${t("app.refreshStaleHint")}` : ""}`,
      title: t(summary.status === "partial" ? "app.refreshPartial" : "app.refreshFailed"),
      tone: summary.status === "partial" ? "warning" : "error",
    });
  }, [locale, t]);
}

function getRefreshTargetLabel(
  target: DriveRefreshTarget,
  t: ReturnType<typeof useTranslations>,
) {
  return t(`app.refreshTarget.${target}`);
}
