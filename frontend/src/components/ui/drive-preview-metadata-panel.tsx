"use client";

import { useEffect, useState } from "react";
import { downloadWorkspaceFileVersion } from "@/features/file/actions";
import {
  formatDriveItemModified,
  formatFileSize,
  getIntlLocale,
  getItemExtension,
  getItemKind,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import type { FileOpenWithApp } from "@/features/file/open-with";
import { useTranslations } from "@/i18n/react";
import { fetchFileVersions, restoreFileVersion, type FileVersionResponse } from "@/lib/drive-api";
import { showAppToast } from "./app-toast-store";
import { ItemIcon, LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";

export type PreviewMediaMetadata = {
  aspectRatio?: string;
  duration?: string;
  height?: number;
  width?: number;
};

type DrivePreviewMetadataPanelProps = {
  closeable?: boolean;
  item: DriveItem;
  locale: Locale;
  mediaMetadata: PreviewMediaMetadata;
  onClose: () => void;
  onVersionRestored?: () => void;
  openWith: FileOpenWithApp;
  palette: Palette;
  timeZone?: string;
};

export function DrivePreviewMetadataPanel({
  closeable = true,
  item,
  locale,
  mediaMetadata,
  onClose,
  onVersionRestored,
  openWith,
  palette,
  timeZone,
}: DrivePreviewMetadataPanelProps) {
  const t = useTranslations();
  const extension = getItemExtension(item);
  const kind = getItemKind(item);
  const tags = getPreviewTags(item, openWith, t);
  const [versionState, setVersionState] = useState<{ error: string | null; itemId: string | null; versions: FileVersionResponse[] }>({
    error: null,
    itemId: null,
    versions: [],
  });
  const [activeTab, setActiveTab] = useState<"details" | "versions">("details");
  const canLoadVersions = Boolean(item.objectKey && !item.archivedAt);
  const versions = versionState.itemId === item.id ? versionState.versions : [];
  const versionError = versionState.itemId === item.id ? versionState.error : null;
  const rows = [
    { label: t("files.name"), value: item.name },
    { label: t("files.type"), value: t(`files.kind.${kind}`) },
    { label: t("preview.mimeType"), value: item.mimeType || "--" },
    { label: t("preview.extension"), value: extension ? extension.toUpperCase() : "--" },
    { label: t("files.size"), value: formatFileSize(item.sizeBytes, locale) },
    {
      label: t("preview.sizeBytes"),
      value: typeof item.sizeBytes === "number" ? new Intl.NumberFormat(getIntlLocale(locale)).format(item.sizeBytes) : "--",
    },
    { label: t("files.owner"), value: item.owner || "--" },
    {
      label: t("preview.dimensions"),
      value: mediaMetadata.width && mediaMetadata.height ? `${mediaMetadata.width} x ${mediaMetadata.height}` : "--",
    },
    { label: t("preview.aspectRatio"), value: mediaMetadata.aspectRatio ?? "--" },
    openWith === "video" ? { label: t("preview.duration"), value: mediaMetadata.duration ?? "--" } : null,
    { label: t("files.modified"), value: formatDriveItemModified(item, locale, timeZone) },
    { label: t("preview.createdAt"), value: formatOptionalDate(item.createdAt, locale, timeZone) },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const loadVersions = (itemId: string, isCancelled: () => boolean = () => false) => {
    void fetchFileVersions(itemId)
      .then((items) => {
        if (!isCancelled()) setVersionState({ error: null, itemId, versions: items });
      })
      .catch(() => {
        if (!isCancelled()) setVersionState({ error: t("files.versionsLoadFailed"), itemId, versions: [] });
      });
  };

  useEffect(() => {
    if (!canLoadVersions) return;
    let cancelled = false;
    void fetchFileVersions(item.id)
      .then((items) => {
        if (!cancelled) setVersionState({ error: null, itemId: item.id, versions: items });
      })
      .catch(() => {
        if (!cancelled) setVersionState({ error: t("files.versionsLoadFailed"), itemId: item.id, versions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadVersions, item.id, t]);

  const downloadVersion = (version: FileVersionResponse) => {
    void downloadWorkspaceFileVersion(item, version.id).catch(() => {
      setVersionState((current) => ({ ...current, error: t("share.downloadFailed") }));
    });
  };

  const restoreVersion = (version: FileVersionResponse) => {
    void restoreFileVersion(item.id, version.id)
      .then(() => {
        showAppToast({ title: t("audit.actions.file.version_restored"), tone: "success" });
        onVersionRestored?.();
        loadVersions(item.id);
      })
      .catch(() => {
        setVersionState((current) => ({ ...current, error: t("files.restoreVersionFailed") }));
      });
  };

  return (
    <aside className="icedr-preview-metadata-panel">
      <div className="icedr-preview-metadata-tabs" role="tablist" aria-label={item.name}>
        <button type="button" role="tab" aria-selected={activeTab === "details"} data-active={activeTab === "details" ? "true" : undefined} onClick={() => setActiveTab("details")}>{t("app.details")}</button>
        <button type="button" role="tab" aria-selected={activeTab === "versions"} data-active={activeTab === "versions" ? "true" : undefined} onClick={() => setActiveTab("versions")}>{t("files.versions")}</button>
      </div>

      {activeTab === "details" ? <>
        <section className="icedr-preview-metadata-card" data-motion-row>
          <div className="icedr-preview-metadata-heading">
            <div className="icedr-preview-metadata-title">
              <ItemIcon item={item} palette={palette} size={26} />
              <div>
                <span className="icedr-truncate">{item.name}</span>
                <strong className="icedr-truncate">{formatFileSize(item.sizeBytes, locale)} / {t(`files.kind.${kind}`)}</strong>
              </div>
            </div>
            {closeable ? (
              <ToolButton label={t("app.close")} palette={palette} onClick={onClose} visual="surface">
                <LocalIcon name="cross" size={16} />
              </ToolButton>
            ) : null}
          </div>
          <div className="icedr-preview-metadata-list">
            {rows.slice(2).map((row) => (
              <div className="icedr-preview-metadata-row" key={row.label}>
                <span>{row.label}</span>
                <strong title={row.value}>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="icedr-preview-tags-card" data-motion-row>
          <div className="icedr-preview-tags-heading">
            <span>{t("preview.tags")}</span>
          </div>
          <div className="icedr-preview-tags-list">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>

        <section className="icedr-preview-version-card icedr-preview-version-card-compact" data-motion-row>
          <div className="icedr-preview-version-heading">
            <span>{t("files.versions")}</span>
            <strong>{versions.length}</strong>
          </div>
          {versionError ? <span className="icedr-preview-version-error">{versionError}</span> : null}
          {versions.length === 0 && !versionError ? <span className="icedr-preview-version-empty">{t("files.noVersions")}</span> : null}
          <div className="icedr-preview-version-list">
            {versions.slice(0, 2).map((version, index) => (
              <div className="icedr-preview-version-row" data-current={index === 0 ? "true" : undefined} key={version.id}>
                <div className="icedr-preview-version-dot" aria-hidden="true" />
                <div className="icedr-preview-version-copy">
                  <span>{t("files.versionNumber", { number: version.versionNumber })}</span>
                  <strong>
                    {formatFileSize(version.sizeBytes, locale)} / {formatOptionalDate(version.createdAt, locale, timeZone)}
                  </strong>
                  {version.remark ? <strong>{version.remark}</strong> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </> : null}

      {activeTab === "versions" ? <section className="icedr-preview-version-card" data-motion-row>
        <div className="icedr-preview-version-heading">
          <span>{t("files.versions")}</span>
          <strong>{versions.length}</strong>
        </div>
        {versionError ? <span className="icedr-preview-version-error">{versionError}</span> : null}
        {versions.length === 0 && !versionError ? <span className="icedr-preview-version-empty">{t("files.noVersions")}</span> : null}
        <div className="icedr-preview-version-list">
          {versions.map((version) => (
            <div className="icedr-preview-version-row" key={version.id}>
              <div className="icedr-preview-version-dot" aria-hidden="true" />
              <div className="icedr-preview-version-copy">
                <span>{t("files.versionNumber", { number: version.versionNumber })}</span>
                <strong>
                  {formatFileSize(version.sizeBytes, locale)} / {formatOptionalDate(version.createdAt, locale, timeZone)}
                </strong>
                {version.uploadedBy ? <strong>{version.uploadedBy}</strong> : null}
                {version.remark ? <strong>{version.remark}</strong> : null}
              </div>
              <div className="icedr-preview-version-actions">
                <ToolButton label={t("actions.download")} palette={palette} size="sm" onClick={() => downloadVersion(version)}>
                  <LocalIcon name="download" size={15} />
                </ToolButton>
                <ToolButton label={t("actions.restore")} palette={palette} size="sm" onClick={() => restoreVersion(version)}>
                  <LocalIcon name="refresh" size={15} />
                </ToolButton>
              </div>
            </div>
          ))}
        </div>
      </section> : null}
    </aside>
  );
}

function getPreviewTags(
  item: DriveItem,
  openWith: FileOpenWithApp,
  t: ReturnType<typeof useTranslations>,
) {
  const extension = getItemExtension(item);
  const tags = new Set<string>();
  if (extension) tags.add(extension.toUpperCase());
  if (openWith === "video") tags.add(t("files.kind.video"));
  if (openWith === "image") tags.add(t("files.kind.image"));
  if (openWith === "office") tags.add(t("files.kind.doc"));
  if (item.starred) tags.add(t("nav.starred"));
  return Array.from(tags).slice(0, 4);
}

function formatOptionalDate(value: string | null | undefined, locale: Locale, timeZone?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
