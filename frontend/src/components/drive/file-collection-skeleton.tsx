import { SkeletonBlock } from "@/components/common/ui/loading-skeleton-primitives";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import "./file-collection-skeleton.css";

const placeholders = Array.from({ length: 8 }, (_, index) => index);

export function DriveFileCollectionSkeleton({
  palette,
  viewMode = "list",
}: {
  palette: Palette;
  viewMode?: "list" | "grid";
}) {
  const t = useTranslations();
  return (
    <div
      aria-busy="true"
      aria-label={t("app.syncing")}
      className="drive-file-skeleton"
      data-view={viewMode}
      role="status"
    >
      {placeholders.map((index) => (
        <div aria-hidden="true" className="drive-file-skeleton-item" key={index}>
          <SkeletonBlock className="drive-file-skeleton-preview" palette={palette} />
          <div className="drive-file-skeleton-label">
            <SkeletonBlock palette={palette} style={{ height: 14, width: `${60 + (index % 3) * 12}%` }} />
            <SkeletonBlock palette={palette} style={{ height: 12, width: "35%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
