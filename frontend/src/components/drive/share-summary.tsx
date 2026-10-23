import { ItemIcon, LocalIcon } from "@/components/ui/app-icon";
import type { DriveItem, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import "./share-summary.css";

export function ShareSummary({ collection, expiresLabel, palette, totalItems, totalSize }: {
  collection: { rootItems: DriveItem[]; owner: string; title: string };
  expiresLabel: string;
  palette: Palette;
  totalItems: number;
  totalSize: string;
}) {
  const t = useTranslations();
  return (
    <header className="external-share-summary">
      {collection.rootItems.length > 1 ? <LocalIcon name="list" size={32} /> : collection.rootItems[0] ? <ItemIcon item={collection.rootItems[0]} palette={palette} size={32} /> : null}
      <div>
        <h1>{collection.title}</h1>
        <p>{t("share.sharedBy", { owner: collection.owner, count: totalItems })} · {totalSize}</p>
        <span>{t("share.expires")}: {expiresLabel}</span>
      </div>
    </header>
  );
}
