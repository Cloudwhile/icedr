"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { LoadingSpinner } from "@/components/common/ui/loading-state";
import { AppDialogShell } from "./app-dialog-shell";
import { showAppToast } from "./app-toast";
import { cn } from "./cn";
import { ItemIcon, LocalIcon } from "./local-icon";
import { ToolButton } from "./tool-button";
import { useTimeZone, useTranslations } from "@/i18n/react";
import {
  formatDriveItemModified,
  formatFileSize,
  getIntlLocale,
  getItemExtension,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import {
  getDefaultFileOpenWith,
  isFileOpenWithAvailable,
  isImagePreviewFile,
  isMarkdownFile,
  isOfficePreviewFile,
  isTextEditableFile,
  isVideoPreviewFile,
  type FileOpenWithApp,
} from "@/features/file/open-with";
import {
  createFilePreviewIntent,
  createWorkspaceDriveItemBlobUrl,
  createWorkspaceDriveItemSourceUrl,
  type PreviewIntentResponse,
} from "@/features/file/actions";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { fetchFileNode, fetchFileNodeContent, updateFileNodeContent } from "@/lib/drive-api";

const mediaDetailsPreferenceKey = "icedr.preview.mediaDetailsOpen";

export type DriveFilePreviewDialogProps = {
  item?: DriveItem | null;
  itemId?: string | null;
  locale: Locale;
  onClose: () => void;
  onSaved?: () => void;
  openWith?: FileOpenWithApp | null;
  open: boolean;
  palette: Palette;
  workspaceId?: string | null;
};

export function DriveFilePreviewDialog({
  item,
  itemId,
  locale,
  onClose,
  onSaved,
  openWith,
  open,
  palette,
  workspaceId,
}: DriveFilePreviewDialogProps) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  const targetItemId = item?.id ?? itemId ?? null;
  const [resolvedItem, setResolvedItem] = useState<{ itemId: string; item: DriveItem | null } | null>(null);
  const [resolvedPreviewIntent, setResolvedPreviewIntent] = useState<{
    itemId: string;
    intent: PreviewIntentResponse | null;
  } | null>(null);
  const [mediaDetailsOpen, setMediaDetailsOpen] = useState(() => readMediaDetailsPreference());
  const activeItem = item ?? (resolvedItem?.itemId === targetItemId ? resolvedItem.item : null);
  const itemResolved = Boolean(item) || (Boolean(targetItemId) && resolvedItem?.itemId === targetItemId);
  const effectiveWorkspaceId = workspaceId ?? activeItem?.workspaceId ?? undefined;
  const effectiveOpenWith = activeItem ? resolveFileOpenWith(activeItem, openWith ?? null) : null;
  const mediaPreview = isMediaDetailsPreview(activeItem, effectiveOpenWith);

  useEffect(() => {
    if (!open || item || !targetItemId) return;
    let cancelled = false;
    void fetchFileNode(targetItemId)
      .then((node) => {
        if (!cancelled) setResolvedItem({ itemId: targetItemId, item: mapFileNodeToDriveItem(node) });
      })
      .catch(() => {
        if (!cancelled) setResolvedItem({ itemId: targetItemId, item: null });
      });
    return () => {
      cancelled = true;
    };
  }, [item, open, targetItemId]);

  useEffect(() => {
    if (!open || !activeItem) return;
    let cancelled = false;
    void createFilePreviewIntent(activeItem.id)
      .then((intent) => {
        if (!cancelled) setResolvedPreviewIntent({ itemId: activeItem.id, intent });
      })
      .catch(() => {
        if (!cancelled) setResolvedPreviewIntent({ itemId: activeItem.id, intent: null });
      });
    return () => {
      cancelled = true;
    };
  }, [activeItem, open]);

  const updateMediaDetailsOpen = (nextOpen: boolean) => {
    setMediaDetailsOpen(nextOpen);
    writeMediaDetailsPreference(nextOpen);
  };

  const previewIntent =
    resolvedPreviewIntent && resolvedPreviewIntent.itemId === activeItem?.id ? resolvedPreviewIntent.intent : null;
  const sizeLabel = activeItem ? formatFileSize(sumDriveItemSizes([activeItem], [activeItem]), locale) : "--";

  return (
    <AppDialogShell
      className={cn("icedr-file-preview-dialog", mediaPreview && "icedr-file-preview-dialog-media")}
      containerClassName={mediaPreview ? "icedr-dialog-container-media" : undefined}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      palette={palette}
      scroll="inside"
      size="full"
      style={{
        "--file-preview-dialog-height": mediaPreview ? "100dvh" : "min(820px, calc(100dvh - 48px))",
        "--file-preview-dialog-width": mediaPreview ? "100vw" : "min(1160px, calc(100vw - 48px))",
      } as CSSProperties}
    >
      <div className="icedr-file-preview-frame">
        {!mediaPreview ? (
          <header
            className="icedr-r-padding-inline"
            style={{
              alignItems: "center",
              borderBottom: `1px solid ${palette.hairline}`,
              display: "flex",
              flexShrink: 0,
              gap: "12px",
              justifyContent: "space-between",
              minHeight: "58px",
              "--r-padding-inline-base": "12px",
              "--r-padding-inline-md": "16px",
            } as CSSProperties}
          >
            <div style={{ alignItems: "center", display: "flex", gap: "12px", minWidth: "0px" }}>
              {activeItem ? (
                <ItemIcon item={activeItem} palette={palette} size={22} />
              ) : (
                <LocalIcon name="visible" size={22} color={palette.primaryHover} />
              )}
              <div style={{ minWidth: "0px" }}>
                <span
                  className="icedr-truncate"
                  style={{ color: palette.ink, fontSize: "14px", fontWeight: 720, lineHeight: 1.35 }}
                >
                  {activeItem?.name ?? t(itemResolved ? "preview.missing" : "preview.title")}
                </span>
                <span
                  className="icedr-truncate"
                  style={{ color: palette.subtle, fontSize: "12px", lineHeight: 1.35 }}
                >
                  {activeItem ? sizeLabel : itemResolved ? t("preview.missingHint") : t("app.loading")}
                </span>
              </div>
            </div>

            <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "4px" }}>
              <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
                <LocalIcon name="cross" size={17} />
              </ToolButton>
            </div>
          </header>
        ) : null}

        <div className={cn("icedr-file-preview-body", mediaPreview && "icedr-file-preview-body-media")}>
          <div className="icedr-file-preview-stage">
            {activeItem ? (
              <DriveFilePreviewContent
                key={activeItem.id}
                item={activeItem}
                locale={locale}
                onSaved={onSaved}
                onClose={onClose}
                onMediaDetailsClose={() => updateMediaDetailsOpen(false)}
                onMediaDetailsOpen={() => updateMediaDetailsOpen(true)}
                openWith={openWith ?? null}
                palette={palette}
                mediaDetailsOpen={mediaDetailsOpen}
                previewIntent={previewIntent}
                timeZone={timeZone}
                workspaceId={effectiveWorkspaceId ?? null}
              />
            ) : itemResolved ? (
              <PreviewStatusPane
                icon="info"
                message={t("preview.missingHint")}
                palette={palette}
                title={t("preview.missing")}
              />
            ) : (
              <PreviewLoadingPane message={t("app.loading")} palette={palette} />
            )}
          </div>
        </div>
      </div>
    </AppDialogShell>
  );
}

function readMediaDetailsPreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(mediaDetailsPreferenceKey) !== "false";
}

function writeMediaDetailsPreference(open: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(mediaDetailsPreferenceKey, open ? "true" : "false");
}

function resolveFileOpenWith(item: DriveItem, requestedOpenWith: FileOpenWithApp | null) {
  if (requestedOpenWith && isFileOpenWithAvailable(item, requestedOpenWith)) return requestedOpenWith;
  return getDefaultFileOpenWith(item);
}

function DriveFilePreviewContent({
  item,
  locale,
  mediaDetailsOpen,
  onClose,
  onMediaDetailsClose,
  onMediaDetailsOpen,
  onSaved,
  openWith: requestedOpenWith,
  palette,
  previewIntent,
  timeZone,
  workspaceId,
}: {
  item: DriveItem;
  locale: Locale;
  mediaDetailsOpen: boolean;
  onClose: () => void;
  onMediaDetailsClose: () => void;
  onMediaDetailsOpen: () => void;
  onSaved?: () => void;
  openWith: FileOpenWithApp | null;
  palette: Palette;
  previewIntent: PreviewIntentResponse | null;
  timeZone?: string;
  workspaceId: string | null;
}) {
  const t = useTranslations();
  const intentCapability = previewIntent?.capability;
  const previewCapability = intentCapability ?? item.previewCapability;
  const previewItem = useMemo(
    () =>
      intentCapability
        ? { ...item, previewCapability: intentCapability }
        : item,
    [item, intentCapability],
  );
  const kind = getItemKind(previewItem);
  const extension = getItemExtension(previewItem);
  const size = formatFileSize(sumDriveItemSizes([previewItem], [previewItem]), locale);
  const statusLabel = previewCapability?.downloadOnly
    ? t("preview.downloadOnlyHint")
    : previewIntent
      ? t(`preview.apiStatus.${previewIntent.status}`)
      : t("preview.notConfigured");
  const openWith = resolveFileOpenWith(previewItem, requestedOpenWith);
  const [textState, setTextState] = useState<{ content: string; itemId: string | null }>({ content: "", itemId: null });
  const [mediaState, setMediaState] = useState<{ error: boolean; itemId: string | null; openWith: string; url: string | null }>({
    error: false,
    itemId: null,
    openWith: "",
    url: null,
  });
  const [documentState, setDocumentState] = useState<{
    html: string;
    itemId: string | null;
    openWith: string;
    url: string | null;
  }>({ html: "", itemId: null, openWith: "", url: null });
  const [mediaMetadataState, setMediaMetadataState] = useState<PreviewMediaMetadataState>({
    itemId: null,
    openWith: "",
  });
  const canEditText = isTextEditableFile(previewItem);
  const canPreviewDocument = isOfficePreviewFile(previewItem);
  const isMarkdown = openWith === "markdown" && isMarkdownFile(previewItem);
  const textContent = textState.itemId === previewItem.id ? textState.content : "";
  const textLoading = canEditText && textState.itemId !== previewItem.id;
  const mediaUrl = mediaState.itemId === previewItem.id && mediaState.openWith === openWith ? mediaState.url : null;
  const mediaError = mediaState.itemId === previewItem.id && mediaState.openWith === openWith && mediaState.error;
  const mediaMetadata =
    mediaMetadataState.itemId === previewItem.id && mediaMetadataState.openWith === openWith ? mediaMetadataState : {};
  const documentHtml = documentState.itemId === previewItem.id && documentState.openWith === openWith ? documentState.html : "";
  const documentUrl = documentState.itemId === previewItem.id && documentState.openWith === openWith ? documentState.url : null;

  useEffect(() => {
    if (!canEditText) return;
    let cancelled = false;
    void fetchFileNodeContent(previewItem.id)
      .then((content) => {
        if (!cancelled) setTextState({ content: content.content, itemId: previewItem.id });
      })
      .catch(() => {
        if (!cancelled) setTextState({ content: "", itemId: previewItem.id });
      });
    return () => {
      cancelled = true;
    };
  }, [canEditText, previewItem.id]);

  useEffect(() => {
    if (!["image", "video"].includes(openWith)) return;
    let cancelled = false;
    void createWorkspaceDriveItemSourceUrl(previewItem, workspaceId ?? undefined)
      .then((url) => {
        if (!cancelled) setMediaState({ error: false, itemId: previewItem.id, openWith, url });
      })
      .catch(() => {
        if (!cancelled) setMediaState({ error: true, itemId: previewItem.id, openWith, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [openWith, previewItem, workspaceId]);

  useEffect(() => {
    if (openWith !== "office" || !canPreviewDocument) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    void createWorkspaceDriveItemBlobUrl(previewItem, workspaceId ?? undefined)
      .then(async (url) => {
        createdUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (extension === "docx") {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Document preview failed");
          const arrayBuffer = await response.arrayBuffer();
          const { default: mammoth } = await import("mammoth/mammoth.browser");
          const result = await mammoth.convertToHtml({ arrayBuffer });
          const cleanHtml = DOMPurify.sanitize(result.value);
          setDocumentState((current) => {
            if (current.url && current.url !== url) URL.revokeObjectURL(current.url);
            return { html: cleanHtml, itemId: previewItem.id, openWith, url };
          });
          return;
        }
        setDocumentState((current) => {
          if (current.url && current.url !== url) URL.revokeObjectURL(current.url);
          return { html: "", itemId: previewItem.id, openWith, url };
        });
      })
      .catch(() => {
        setDocumentState((current) => {
          if (current.url) URL.revokeObjectURL(current.url);
          return { html: "", itemId: previewItem.id, openWith, url: null };
        });
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [canPreviewDocument, extension, openWith, previewItem, workspaceId]);

  const saveTextContent = () => {
    void updateFileNodeContent(previewItem.id, textContent)
      .then((content) => {
        setTextState({ content: content.content, itemId: previewItem.id });
        showAppToast({ title: t("preview.saved"), tone: "success" });
        onSaved?.();
      })
      .catch(() => showAppToast({ title: t("preview.saveFailed"), tone: "error" }));
  };

  const previewNode =
    openWith === "image" && isImagePreviewFile(previewItem) ? (
      <ImagePreview error={mediaError} errorLabel={t("preview.notConfiguredHint")} imageUrl={mediaUrl} item={previewItem} loadingLabel={t("app.loading")} onMetadata={(metadata) => setMediaMetadataState({ ...metadata, itemId: previewItem.id, openWith })} palette={palette} />
    ) : openWith === "video" && isVideoPreviewFile(previewItem) ? (
      <VideoPreview error={mediaError} errorLabel={t("preview.notConfiguredHint")} item={previewItem} loadingLabel={t("app.loading")} onMetadata={(metadata) => setMediaMetadataState({ ...metadata, itemId: previewItem.id, openWith })} palette={palette} videoUrl={mediaUrl} />
    ) : canEditText ? (
      <TextPreviewEditor
        content={textContent}
        isMarkdown={isMarkdown}
        loading={textLoading}
        onChange={(content) => setTextState({ content, itemId: previewItem.id })}
        onSave={saveTextContent}
        palette={palette}
        t={t}
      />
    ) : canPreviewDocument && openWith === "office" ? (
      <OfficePreview
        documentHtml={documentHtml}
        documentUrl={documentUrl}
        extension={extension}
        item={previewItem}
        palette={palette}
        t={t}
      />
    ) : (
      <PreviewStatusPane
        item={previewItem}
        message={statusLabel}
        metrics={[
          { label: t("files.type"), value: t(`files.kind.${kind}`) },
          { label: t("files.size"), value: size },
          { label: t("preview.status"), value: statusLabel },
        ]}
        palette={palette}
        title={previewCapability?.downloadOnly || previewIntent?.status === "unsupported" ? t("preview.unsupportedHint") : t("preview.officeHint")}
      />
    );

  const showMetadata = !canEditText && (openWith === "image" || openWith === "video");

  return (
    <div style={{ display: "flex", flex: "1 1 auto", minHeight: "0px", width: "100%" }}>
      {showMetadata ? (
        <div className="icedr-preview-media-layout" data-details-open={mediaDetailsOpen ? "true" : "false"}>
          <div className="icedr-preview-media-stage">
            <div className="icedr-preview-media-toolbar">
              <ToolButton active={mediaDetailsOpen} className="icedr-preview-media-action" label={t("app.details")} palette={palette} onClick={onMediaDetailsOpen} tooltipPlacement="bottom end">
                <LocalIcon name="info" size={17} />
              </ToolButton>
              <ToolButton className="icedr-preview-media-action" label={t("app.close")} palette={palette} onClick={onClose} tooltipPlacement="bottom end">
                <LocalIcon name="cross" size={17} />
              </ToolButton>
            </div>
            {previewNode}
          </div>
          {mediaDetailsOpen ? (
            <PreviewMetadataPanel
              item={previewItem}
              locale={locale}
              mediaMetadata={mediaMetadata}
              onClose={onMediaDetailsClose}
              openWith={openWith}
              palette={palette}
              timeZone={timeZone}
            />
          ) : null}
        </div>
      ) : (
        previewNode
      )}
    </div>
  );
}

function isMediaDetailsPreview(item: DriveItem | null | undefined, openWith: FileOpenWithApp | null) {
  if (!item) return false;
  return (openWith === "image" && isImagePreviewFile(item)) || (openWith === "video" && isVideoPreviewFile(item));
}

function PreviewStatusPane({
  icon = "visible",
  item,
  message,
  metrics,
  palette,
  title,
}: {
  icon?: "info" | "visible";
  item?: DriveItem;
  message: string;
  metrics?: Array<{ label: string; value: string }>;
  palette: Palette;
  title: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        justifyContent: "center",
        marginInline: "auto",
        maxWidth: "520px",
        minHeight: "360px",
        textAlign: "center",
      }}
    >
      {item ? <ItemIcon item={item} palette={palette} size={40} /> : <LocalIcon name={icon} size={42} color={palette.primaryHover} />}
      <div>
        <span style={{ color: palette.ink, fontSize: "18px", fontWeight: 720, lineHeight: 1.3 }}>{title}</span>
        <span style={{ color: palette.subtle, lineHeight: 1.55, marginTop: "8px" }}>{message}</span>
      </div>
      {metrics?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", textAlign: "left", width: "min(420px, 100%)" }}>
          {metrics.map((metric) => (
            <PreviewMetric key={metric.label} label={metric.label} palette={palette} value={metric.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewMetric({ label, palette, value }: { label: string; palette: Palette; value: string }) {
  return (
    <div>
      <span style={{ color: palette.subtle, fontSize: "12px" }}>{label}</span>
      <span style={{ color: palette.ink, fontWeight: 720, marginTop: "4px" }}>{value}</span>
    </div>
  );
}

function PreviewMetadataPanel({
  item,
  locale,
  mediaMetadata,
  onClose,
  openWith,
  palette,
  timeZone,
}: {
  item: DriveItem;
  locale: Locale;
  mediaMetadata: PreviewMediaMetadata;
  onClose: () => void;
  openWith: FileOpenWithApp;
  palette: Palette;
  timeZone?: string;
}) {
  const t = useTranslations();
  const extension = getItemExtension(item);
  const kind = getItemKind(item);
  const rows = [
    { label: t("files.name"), value: item.name },
    { label: t("files.type"), value: t(`files.kind.${kind}`) },
    { label: t("preview.mimeType"), value: item.mimeType || "--" },
    { label: t("preview.extension"), value: extension ? extension.toUpperCase() : "--" },
    { label: t("files.size"), value: formatFileSize(item.sizeBytes, locale) },
    { label: t("preview.sizeBytes"), value: typeof item.sizeBytes === "number" ? new Intl.NumberFormat(getIntlLocale(locale)).format(item.sizeBytes) : "--" },
    { label: t("files.owner"), value: item.owner || "--" },
    { label: t("preview.dimensions"), value: mediaMetadata.width && mediaMetadata.height ? `${mediaMetadata.width} × ${mediaMetadata.height}` : "--" },
    { label: t("preview.aspectRatio"), value: mediaMetadata.aspectRatio ?? "--" },
    openWith === "video" ? { label: t("preview.duration"), value: mediaMetadata.duration ?? "--" } : null,
    { label: t("files.modified"), value: formatDriveItemModified(item, locale, timeZone) },
    { label: t("preview.createdAt"), value: formatOptionalDate(item.createdAt, locale, timeZone) },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <aside className="icedr-preview-metadata-panel">
      <div className="icedr-preview-metadata-heading">
        <div className="icedr-preview-metadata-title">
          <ItemIcon item={item} palette={palette} size={20} />
          <span>{t("app.details")}</span>
        </div>
        <ToolButton label={t("app.close")} palette={palette} onClick={onClose} visual="surface">
          <LocalIcon name="cross" size={16} />
        </ToolButton>
      </div>
      <div className="icedr-preview-metadata-list">
        {rows.map((row) => (
          <div className="icedr-preview-metadata-row" key={row.label}>
            <span>{row.label}</span>
            <strong title={row.value}>{row.value}</strong>
          </div>
        ))}
      </div>
    </aside>
  );
}

type PreviewMediaMetadata = {
  aspectRatio?: string;
  duration?: string;
  height?: number;
  width?: number;
};

type PreviewMediaMetadataState = PreviewMediaMetadata & {
  itemId: string | null;
  openWith: string;
};

function PreviewLoadingPane({ message, palette }: { message: string; palette: Palette }) {
  return (
    <div className="icedr-preview-loading">
      <LoadingSpinner palette={palette} size={26} />
      <span>{message}</span>
    </div>
  );
}

function ImagePreview({
  error,
  errorLabel,
  imageUrl,
  item,
  loadingLabel,
  onMetadata,
  palette,
}: {
  error: boolean;
  errorLabel: string;
  imageUrl: string | null;
  item: DriveItem;
  loadingLabel: string;
  onMetadata: (metadata: PreviewMediaMetadata) => void;
  palette: Palette;
}) {
  return (
    <div
      className="icedr-preview-media-viewer"
      style={{
        "--preview-media-bg": palette.surface2,
        "--preview-media-border": palette.hairline,
      } as CSSProperties}
    >
      {imageUrl ? (
        <img
          alt={item.name}
          onLoad={(event) => {
            const image = event.currentTarget;
            onMetadata({
              aspectRatio: formatAspectRatio(image.naturalWidth, image.naturalHeight),
              height: image.naturalHeight || undefined,
              width: image.naturalWidth || undefined,
            });
          }}
          src={imageUrl}
          className="icedr-preview-media-object"
        />
      ) : error ? (
        <span className="icedr-preview-media-error">{errorLabel}</span>
      ) : (
        <PreviewLoadingPane message={loadingLabel} palette={palette} />
      )}
    </div>
  );
}

function VideoPreview({
  error,
  errorLabel,
  item,
  loadingLabel,
  onMetadata,
  palette,
  videoUrl,
}: {
  error: boolean;
  errorLabel: string;
  item: DriveItem;
  loadingLabel: string;
  onMetadata: (metadata: PreviewMediaMetadata) => void;
  palette: Palette;
  videoUrl: string | null;
}) {
  return (
    <div
      className="icedr-preview-media-viewer"
      style={{
        "--preview-media-bg": palette.surface2,
        "--preview-media-border": palette.hairline,
      } as CSSProperties}
    >
      {videoUrl ? (
        <video
          className="icedr-preview-media-object"
          controls
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            onMetadata({
              aspectRatio: formatAspectRatio(video.videoWidth, video.videoHeight),
              duration: Number.isFinite(video.duration) ? formatDuration(video.duration) : undefined,
              height: video.videoHeight || undefined,
              width: video.videoWidth || undefined,
            });
          }}
          playsInline
          preload="metadata"
          src={videoUrl}
          title={item.name}
        />
      ) : error ? (
        <span className="icedr-preview-media-error">{errorLabel}</span>
      ) : (
        <PreviewLoadingPane message={loadingLabel} palette={palette} />
      )}
    </div>
  );
}

function OfficePreview({
  documentHtml,
  documentUrl,
  extension,
  item,
  palette,
  t,
}: {
  documentHtml: string;
  documentUrl: string | null;
  extension: string;
  item: DriveItem;
  palette: Palette;
  t: ReturnType<typeof useTranslations>;
}) {
  if (extension === "pdf" && documentUrl) {
    return (
      <iframe
        src={documentUrl}
        style={{
          background: palette.surface2,
          border: `1px solid ${palette.hairline}`,
          borderRadius: "8px",
          flex: "1 1 auto",
          minHeight: "520px",
          width: "100%",
        }}
        title={item.name}
      />
    );
  }

  if (extension === "docx" && documentHtml) {
    return (
      <div
        style={{
          background: palette.surface2,
          border: `1px solid ${palette.hairline}`,
          borderRadius: "8px",
          color: palette.ink,
          flex: "1 1 auto",
          lineHeight: 1.7,
          minHeight: "420px",
          overflow: "auto",
          padding: "24px",
          width: "100%",
        }}
      >
        <div className="icedr-preview-document" dangerouslySetInnerHTML={{ __html: documentHtml }} />
      </div>
    );
  }

  if ((extension === "pdf" || extension === "docx") && !documentUrl && !documentHtml) {
    return <PreviewLoadingPane message={t("app.loading")} palette={palette} />;
  }

  return (
    <PreviewStatusPane
      item={item}
      message={t("preview.notConfiguredHint")}
      palette={palette}
      title={t("preview.notConfigured")}
    />
  );
}

function TextPreviewEditor({
  content,
  isMarkdown,
  loading,
  onChange,
  onSave,
  palette,
  t,
}: {
  content: string;
  isMarkdown: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  palette: Palette;
  t: ReturnType<typeof useTranslations>;
}) {
  const markdownHtml = useMemo(() => {
    if (!isMarkdown) return "";
    return DOMPurify.sanitize(marked.parse(content || "", { async: false }) as string);
  }, [content, isMarkdown]);

  return (
    <div
      className="icedr-preview-editor-grid"
      style={{
        "--preview-editor-bg": palette.surface1,
        "--preview-editor-border": palette.hairline,
        "--preview-editor-columns": isMarkdown ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
        "--preview-editor-focus": palette.focusRing,
        "--preview-editor-muted": palette.subtle,
        "--preview-editor-panel": palette.surface2,
        "--preview-editor-text": palette.ink,
      } as CSSProperties}
    >
      <div className="icedr-preview-editor-pane">
        <div className="icedr-preview-editor-toolbar">
          <span className="icedr-preview-editor-title">
            {isMarkdown ? t("preview.editor") : t("preview.plainText")}
          </span>
          <ToolButton label={t("preview.save")} palette={palette} onClick={onSave}>
            <LocalIcon name="save" size={17} />
          </ToolButton>
        </div>
        <textarea
          aria-label={t("preview.editor")}
          className="icedr-preview-editor-textarea"
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          value={loading ? "" : content}
        />
      </div>
      {isMarkdown ? <MarkdownPreview html={markdownHtml} palette={palette} /> : null}
    </div>
  );
}

function MarkdownPreview({ html, palette }: { html: string; palette: Palette }) {
  return (
    <div
      className="icedr-preview-markdown-pane"
      style={{
        "--preview-editor-border": palette.hairline,
        "--preview-editor-panel": palette.surface2,
        "--preview-editor-text": palette.ink,
      } as CSSProperties}
    >
      <div className="icedr-preview-markdown" dangerouslySetInnerHTML={{ __html: html || "" }} />
    </div>
  );
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

function formatAspectRatio(width: number, height: number) {
  if (!width || !height) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const rest = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}
