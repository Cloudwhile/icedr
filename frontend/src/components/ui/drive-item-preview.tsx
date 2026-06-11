"use client";

import { useEffect, useState } from "react";
import { createWorkspaceDriveItemSourceUrl } from "@/features/file/actions";
import type { DriveItem, Palette } from "@/features/file/model";
import { getItemExtension, getItemKind } from "@/features/file/model";
import { isImagePreviewFile, isVideoPreviewFile } from "@/features/file/open-with";
import { cn } from "./cn";
import { ItemIcon } from "./app-icon";

export type DriveItemPreviewProps = {
  className?: string;
  iconSize?: number;
  item: DriveItem;
  palette: Palette;
};

export function DriveItemPreview({
  className,
  iconSize = 36,
  item,
  palette,
}: DriveItemPreviewProps) {
  const previewableImage = isImagePreviewFile(item);
  const previewableVideo = isVideoPreviewFile(item);
  const kind = getItemKind(item);
  const extension = getItemExtension(item);
  const [sourceUrl, setSourceUrl] = useState<{ itemId: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!previewableImage && !previewableVideo) {
      return;
    }

    let cancelled = false;
    void createWorkspaceDriveItemSourceUrl(item, item.workspaceId)
      .then((url) => {
        if (!cancelled) setSourceUrl({ itemId: item.id, url });
      })
      .catch(() => {
        if (!cancelled) setSourceUrl({ itemId: item.id, url: null });
      });

    return () => {
      cancelled = true;
    };
  }, [item, previewableImage, previewableVideo]);

  const activeUrl = sourceUrl?.itemId === item.id ? sourceUrl.url : null;
  const hasMedia = Boolean(activeUrl && (previewableImage || previewableVideo));

  return (
    <div
      className={cn("drive-item-preview", className)}
      data-has-media={hasMedia ? "true" : undefined}
      data-kind={kind}
      data-extension={extension || undefined}
    >
      {previewableImage && activeUrl ? (
        <img alt="" className="drive-item-preview-media" src={activeUrl} />
      ) : null}
      {previewableVideo && activeUrl ? (
        <video aria-label={item.name} className="drive-item-preview-media" muted playsInline preload="metadata" src={activeUrl} />
      ) : null}
      {!hasMedia ? (
        <span className="drive-item-preview-icon" aria-hidden="true">
          <ItemIcon item={item} palette={palette} size={iconSize} />
        </span>
      ) : null}
    </div>
  );
}
