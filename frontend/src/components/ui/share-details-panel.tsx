"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { formatFileSize, type Locale, type Palette } from "@/features/file/model";
import {
  fetchRegisteredShareManagement,
  type RegisteredShare,
  type RegisteredShareItem,
} from "@/features/share/registry";
import { useLocale, useTranslations } from "@/i18n/react";
import { LocalIcon, StatusPill, ToolButton } from "@/views/drive/drive-primitives";
import { LoadingSpinner } from "@/components/common/ui/loading-state";
import "@/styles/share-details-panel.css";

export function ShareDetailsPanel({
  onClose,
  palette,
  token,
}: {
  onClose: () => void;
  palette: Palette;
  token: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [state, setState] = useState<{
    error: boolean;
    share: RegisteredShare | null;
    token: string;
  }>({ error: false, share: null, token: "" });
  const loading = state.token !== token;
  const share = loading ? null : state.share;

  useEffect(() => {
    let cancelled = false;
    void fetchRegisteredShareManagement(token)
      .then((result) => {
        if (!cancelled) {
          setState({ error: !result, share: result ?? null, token });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ error: true, share: null, token });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <aside
      className="share-details-panel"
      aria-label={t("links.viewDetails")}
      style={{
        "--hairline": palette.hairline,
        "--subtle": palette.subtle,
        "--surface-1": palette.surface1,
      } as CSSProperties}
    >
      <header className="share-details-header">
        <span className="share-details-heading">
          <LocalIcon name="link" size={17} />
          <span className="icedr-truncate">{share?.title ?? t("links.viewDetails")}</span>
        </span>
        <ToolButton label={t("app.close")} onClick={onClose} palette={palette}>
          <LocalIcon name="cross" size={16} />
        </ToolButton>
      </header>

      {loading ? (
        <div className="share-details-state">
          <LoadingSpinner palette={palette} size={18} />
        </div>
      ) : state.error || !share ? (
        <div className="share-details-state">
          <StatusPill palette={palette} tone="risk">
            {t("share.detailsLoadFailed")}
          </StatusPill>
        </div>
      ) : (
        <div className="share-details-body">
          <section className="share-details-summary" aria-label={t("share.quickFacts")}>
            <DetailMetric label={t("settings.fileCount")} value={String(share.contentSummary?.fileCount ?? 0)} />
            <DetailMetric label={t("settings.folderCount")} value={String(share.contentSummary?.folderCount ?? 0)} />
            <DetailMetric
              label={t("share.totalSize")}
              value={formatFileSize(share.contentSummary?.totalSizeBytes ?? null, locale)}
            />
            <DetailMetric label={t("share.unavailableItems")} value={String(share.contentSummary?.unavailableCount ?? 0)} />
          </section>

          <div className="share-details-scope-row">
            <span>{t("share.visibleScope")}</span>
            <StatusPill palette={palette} tone="accent">
              {t(`share.scopeMode.${share.scopeMode ?? "legacy"}`)}
            </StatusPill>
          </div>

          <section className="share-details-members" aria-label={t("share.collection")}>
            {(share.items ?? []).map((item) => (
              <ShareMemberRow item={item} key={item.id} palette={palette} />
            ))}
          </section>
        </div>
      )}
    </aside>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="share-details-metric">
      <span>{label}</span>
      <strong className="icedr-truncate">{value}</strong>
    </span>
  );
}

function ShareMemberRow({
  item,
  palette,
}: {
  item: RegisteredShareItem;
  palette: Palette;
}) {
  const t = useTranslations();
  const changed = item.changes.length > 0;
  const available = item.availability === "available";
  const statusLabel = available
    ? changed
      ? item.changes.map((change) => t(`share.memberChange.${change}`)).join(" / ")
      : t("share.memberStatus.available")
    : t(`share.memberStatus.${item.availability}`);
  return (
    <div className="share-details-member">
      <span className="share-details-member-icon" aria-hidden="true">
        <LocalIcon name={item.kind === "folder" ? "folder" : "file"} size={16} />
      </span>
      <span className="share-details-member-copy">
        <span className="icedr-truncate">{item.name || t("share.unavailable")}</span>
        {item.snapshotName && item.snapshotName !== item.name ? (
          <span className="icedr-truncate">{item.snapshotName}</span>
        ) : null}
      </span>
      <StatusPill palette={palette} tone={available ? (changed ? "accent" : "neutral") : "risk"}>
        {statusLabel}
      </StatusPill>
    </div>
  );
}
