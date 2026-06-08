"use client";

import { useEffect, useMemo, useState } from "react";
import { AppImage } from "@/components/ui/app-image";
import { formatDriveItemModified, getItemKind, type DriveItem, type Locale, type Palette } from "@/features/file/model";
import { createSharedDriveItemBlobUrl } from "@/features/file/actions";
import { useTimeZone, useTranslations } from "@/i18n/react";
import { ItemIcon, LocalIcon, StatusPill } from "./drive-primitives";

type ShareHeroCollection = {
  mode: "folder" | "multi-file" | "single-file";
  owner: string;
  rootItems: DriveItem[];
  title: string;
};

export function ExternalShareHeroCard({
  collection,
  expiresLabel,
  locale,
  palette,
  shareToken,
  sourceItems,
  totalItems,
  totalSize,
}: {
  collection: ShareHeroCollection;
  expiresLabel: string;
  locale: Locale;
  palette: Palette;
  shareToken: string;
  sourceItems: DriveItem[];
  totalItems: number;
  totalSize: string;
}) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  const coverItem = useMemo(() => findShareCoverItem(collection.rootItems, sourceItems), [collection.rootItems, sourceItems]);
  const updatedItem = useMemo(() => findLatestShareItem(collection.rootItems, sourceItems), [collection.rootItems, sourceItems]);
  const updatedLabel = updatedItem ? formatDriveItemModified(updatedItem, locale, timeZone) : "--";

  return (
    <section className="external-share-hero-card" aria-label={collection.title}>
      <div className="external-share-hero-badge-row">
        <StatusPill indicator={false} palette={palette} tone="accent">
          <LocalIcon name="earth" size={13} />
          {t("share.publicShare")}
        </StatusPill>
        <StatusPill indicator={false} palette={palette} tone="neutral">
          <LocalIcon name="visible" size={13} />
          {t("share.readOnly")}
        </StatusPill>
      </div>

      <div className="external-share-hero-main">
        <ShareHeroCover coverItem={coverItem} palette={palette} shareToken={shareToken} />

        <div className="external-share-hero-copy">
          <div className="external-share-hero-title-row">
            <h1>{collection.title}</h1>
            <StatusPill indicator={false} palette={palette}>{expiresLabel}</StatusPill>
          </div>
          <p>{t("share.sharedBy", { owner: collection.owner, count: totalItems })}</p>

          <div className="external-share-hero-chip-row">
            <StatusPill indicator={false} palette={palette}>
              <LocalIcon name="folder" size={13} />
              {t(`share.mode.${collection.mode}`)}
            </StatusPill>
            <StatusPill indicator={false} palette={palette}>
              {t("share.itemCountValue", { count: totalItems })}
            </StatusPill>
            <StatusPill indicator={false} palette={palette}>
              <LocalIcon name="file" size={13} />
              {totalSize}
            </StatusPill>
            <StatusPill indicator={false} palette={palette} tone="accent">
              <LocalIcon name="shield" size={13} />
              {t("share.secureShare")}
            </StatusPill>
          </div>

          <div className="external-share-hero-meta-grid">
            <HeroMeta icon="user_avatar" label={t("files.owner")} value={collection.owner} />
            <HeroMeta icon="clock" label={t("files.modified")} value={updatedLabel} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ShareHeroCover({
  coverItem,
  palette,
  shareToken,
}: {
  coverItem: DriveItem | null;
  palette: Palette;
  shareToken: string;
}) {
  const [coverState, setCoverState] = useState<{ itemId: string | null; url: string | null }>({ itemId: null, url: null });
  const coverUrl = coverState.itemId === (coverItem?.id ?? null) ? coverState.url : null;

  useEffect(() => {
    if (!coverItem) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    void createSharedDriveItemBlobUrl(shareToken, coverItem)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setCoverState({ itemId: coverItem.id, url });
      })
      .catch(() => {
        if (!cancelled) setCoverState({ itemId: coverItem.id, url: null });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverItem, shareToken]);

  return (
    <div className="external-share-hero-cover" data-has-cover={coverUrl && coverItem ? "true" : undefined}>
      {coverUrl && coverItem ? (
        <AppImage alt={coverItem.name} src={coverUrl} width="100%" height="100%" className="external-share-hero-cover-image" />
      ) : (
        <div className="external-share-hero-cover-fallback">
          <span className="external-share-hero-cover-emblem">
            {coverItem ? <ItemIcon item={coverItem} palette={palette} size={28} /> : <LocalIcon name="folder" size={28} color={palette.primaryHover} />}
          </span>
          <span className="external-share-hero-cover-mark" />
        </div>
      )}
    </div>
  );
}

function HeroMeta({
  icon,
  label,
  value,
}: {
  icon: "clock" | "user_avatar";
  label: string;
  value: string;
}) {
  return (
    <div className="external-share-hero-meta">
      <LocalIcon name={icon} size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function findShareCoverItem(rootItems: DriveItem[], sourceItems: DriveItem[]) {
  const roots = new Set(rootItems.map((item) => item.id));
  return sourceItems.find((item) => roots.has(item.id) && getItemKind(item) === "image") ?? sourceItems.find((item) => getItemKind(item) === "image") ?? null;
}

function findLatestShareItem(rootItems: DriveItem[], sourceItems: DriveItem[]) {
  const allowedIds = new Set(rootItems.map((item) => item.id));
  return sourceItems
    .filter((item) => allowedIds.has(item.id))
    .sort((left, right) => new Date(right.modifiedAt ?? right.createdAt ?? 0).getTime() - new Date(left.modifiedAt ?? left.createdAt ?? 0).getTime())[0] ?? rootItems[0] ?? null;
}
