"use client";

import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { formatFileSize, type DriveItem, type Locale } from "@/features/file/model";
import type { RegisteredShare } from "@/features/share/registry";
import { formatAbsoluteDate } from "./drive-formatters";
import { LocalIcon } from "./drive-primitives";

type AccessPolicySummary = {
  hasSpeedLimit: boolean;
  label: string;
  sessionLabel: string;
  speedLabel: string;
  waitSeconds: number;
};

export function ExternalShareSidePanel({
  collectionItems,
  experience,
  expiresLabel,
  onStartAccess,
  registeredShare,
  selectedEmail,
  totalItems,
  totalSize,
  verified,
}: {
  collectionItems: DriveItem[];
  experience: AccessPolicySummary;
  expiresLabel: string;
  onStartAccess?: () => void;
  registeredShare: RegisteredShare;
  selectedEmail: string;
  totalItems: number;
  totalSize: string;
  verified: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  const rootSize = formatFileSize(collectionItems.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0) || null, locale);
  const createdAt = formatAbsoluteDate(registeredShare.createdAt, locale, timeZone);
  const lastAccessAt = registeredShare.lastAccessAt ? formatAbsoluteDate(registeredShare.lastAccessAt, locale, timeZone) : "--";

  return (
    <aside className="external-share-side-panel">
      <section className="external-share-side-card external-share-verification-card">
        <div className="external-share-side-card-heading">
          <LocalIcon name="shield" size={17} />
          <span>{t("share.authenticate")}</span>
        </div>
        <p>{verified ? t("share.verifiedAccess") : t("share.verificationHint")}</p>
        <div className="external-share-auth-fields" aria-hidden="true">
          <div className="external-share-auth-field">
            <span>{t("auth.email")}</span>
            <strong className="icedr-truncate">{selectedEmail || t("share.emailPlaceholder")}</strong>
          </div>
          <div className="external-share-auth-code-row">
            <div className="external-share-auth-field">
              <span>{t("share.verificationCode")}</span>
              <strong>{verified ? "******" : "000000"}</strong>
            </div>
            <button className="external-share-auth-secondary" disabled type="button">
              {t("share.sendCode")}
            </button>
          </div>
        </div>
        <button
          className="external-share-auth-primary"
          disabled={!onStartAccess}
          onClick={onStartAccess}
          type="button"
        >
          <LocalIcon name={verified ? "tick" : "shield"} size={16} />
          <span>{verified ? t("share.openDownload") : t("share.downloadAndVerify")}</span>
        </button>
        <span className="external-share-auth-note">
          <LocalIcon name="lock" size={13} />
          {t("share.privacyAssurance")}
        </span>
      </section>

      <section className="external-share-side-card">
        <div className="external-share-side-card-heading">
          <LocalIcon name="shield" size={17} />
          <span>{t("share.visitorPolicy")}</span>
        </div>
        <div className="external-share-policy-grid">
          <InfoChip icon="mail" label={experience.label} />
          <InfoChip icon="clock" label={t("admin.waitValue", { seconds: experience.waitSeconds })} />
          <InfoChip icon="download" label={experience.sessionLabel} />
          <InfoChip icon="time" label={experience.hasSpeedLimit ? experience.speedLabel : t("share.unlimited")} />
          <InfoChip icon="visible" label={registeredShare.allowPreview ? t("share.allowPreview") : t("preview.unsupportedHint")} />
          <InfoChip icon="download" label={registeredShare.allowDownload ? t("share.allowDownload") : t("share.downloadBlocked")} />
        </div>
      </section>

      <section className="external-share-side-card">
        <div className="external-share-side-card-heading">
          <LocalIcon name="user_group" size={17} />
          <span>{t("share.shareInformation")}</span>
        </div>
        <div className="external-share-fact-list">
          <FactRow label={t("settings.fileCount")} value={String(registeredShare.contentSummary?.fileCount ?? totalItems)} />
          <FactRow label={t("settings.folderCount")} value={String(registeredShare.contentSummary?.folderCount ?? 0)} />
          <FactRow label={t("share.totalSize")} value={totalSize === "--" ? rootSize : totalSize} />
          {registeredShare.contentSummary?.unavailableCount ? (
            <FactRow label={t("share.unavailableItems")} value={String(registeredShare.contentSummary.unavailableCount)} />
          ) : null}
          {registeredShare.contentSummary?.changedCount ? (
            <FactRow label={t("share.changedItems")} value={String(registeredShare.contentSummary.changedCount)} />
          ) : null}
          <FactRow label={t("share.expires")} value={expiresLabel} />
          <FactRow label={t("preview.createdAt")} value={createdAt} />
          <FactRow label={t("share.visits")} value={String(registeredShare.visitCount ?? 0)} />
          <FactRow label={t("share.downloads")} value={String(registeredShare.downloadCount ?? 0)} />
          <FactRow label={t("share.lastAccess")} value={lastAccessAt} />
        </div>
      </section>
    </aside>
  );
}

function InfoChip({ icon, label }: { icon: "clock" | "download" | "mail" | "time" | "visible"; label: string }) {
  return (
    <span className="external-share-info-chip">
      <LocalIcon name={icon} size={14} />
      <span className="icedr-truncate">{label}</span>
    </span>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="external-share-fact-row">
      <span>{label}</span>
      <span className="icedr-truncate">{value || "--"}</span>
    </div>
  );
}
