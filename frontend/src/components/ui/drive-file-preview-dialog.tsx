"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { LoadingSpinner } from "@/components/common/ui/loading-state";
import { DrivePreviewMetadataPanel, type PreviewMediaMetadata } from "./drive-preview-metadata-panel";
import { AppDialogShell } from "./app-dialog-shell";
import { PreviewLifecycleBoundary } from "./preview-lifecycle-boundary";
import { showAppToast } from "./app-toast-store";
import { cn } from "./cn";
import { ItemIcon, LocalIcon } from "./app-icon";
import { ToolButton } from "./tool-button";
import { useTimeZone, useTranslations } from "@/i18n/react";
import {
  formatFileSize,
  getItemExtension,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type Palette,
} from "@/features/file/model";
import {
  canOpenFilePreview,
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
  fetchPreviewIntentStatus,
  copyTextToClipboard,
  createPreviewUrl,
  createWorkspaceDriveItemBlobUrl,
  createWorkspaceDriveItemSourceUrl,
  downloadWorkspaceDriveItem,
  type PreviewIntentResponse,
} from "@/features/file/actions";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { usePreviewLifecycle } from "@/features/file/use-preview-lifecycle";
import {
  getPreviewStatusMessageKey,
  getPreviewTitleMessageKey,
} from "@/features/file/preview-status";
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
  const [mediaDetailsOpen, setMediaDetailsOpen] = useState(() => readMediaDetailsPreference());
  const activeItem = item ?? (resolvedItem?.itemId === targetItemId ? resolvedItem.item : null);
  const itemResolved = Boolean(item) || (Boolean(targetItemId) && resolvedItem?.itemId === targetItemId);
  const previewAvailable = activeItem ? canOpenFilePreview(activeItem) : true;
  const effectiveWorkspaceId = workspaceId ?? activeItem?.workspaceId ?? undefined;
  const effectiveOpenWith = activeItem ? resolveFileOpenWith(activeItem, openWith ?? null) : null;
  const workspacePreview = isWorkspacePreview(activeItem, effectiveOpenWith);
  const previewItemId = open && activeItem && previewAvailable ? activeItem.id : null;
  const createPreviewLifecycleIntent = useCallback((signal: AbortSignal) => {
    if (!previewItemId) return Promise.reject(new Error("Preview item is unavailable"));
    return createFilePreviewIntent(previewItemId, { signal });
  }, [previewItemId]);
  const pollPreviewLifecycleIntent = useCallback(
    (intent: PreviewIntentResponse, signal: AbortSignal) => fetchPreviewIntentStatus(intent, { signal }),
    [],
  );
  const previewLifecycle = usePreviewLifecycle({
    createIntent: createPreviewLifecycleIntent,
    enabled: Boolean(previewItemId),
    identity: previewItemId,
    pollIntent: pollPreviewLifecycleIntent,
  });

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
    if (!open || !activeItem || previewAvailable) return;
    showAppToast({
      dedupeKey: `preview-no-artifact-${activeItem.id}`,
      title: t("preview.noArtifact"),
      tone: "info",
    });
    onClose();
  }, [activeItem, onClose, open, previewAvailable, t]);

  const updateMediaDetailsOpen = (nextOpen: boolean) => {
    setMediaDetailsOpen(nextOpen);
    writeMediaDetailsPreference(nextOpen);
  };

  const previewIntent = previewLifecycle.intent;
  const sizeLabel = activeItem ? formatFileSize(sumDriveItemSizes([activeItem], [activeItem]), locale) : "--";
  const downloadActiveItem = () => {
    if (!activeItem) return;
    void downloadWorkspaceDriveItem(activeItem, effectiveWorkspaceId ?? undefined)
      .then(() => showAppToast({ title: t("app.downloaded"), tone: "success" }))
      .catch(() => showAppToast({ title: t("share.downloadFailed"), tone: "error" }));
  };
  const copyActivePreviewLink = () => {
    if (!activeItem) return;
    void copyTextToClipboard(createPreviewUrl(activeItem.id))
      .then(() => showAppToast({ title: t("app.copied"), tone: "success" }))
      .catch(() => showAppToast({ title: t("share.createFailed"), tone: "error" }));
  };

  if (activeItem && !previewAvailable) return null;

  return (
    <AppDialogShell
      className={cn("icedr-file-preview-dialog", workspacePreview && "icedr-file-preview-dialog-media")}
      containerClassName={workspacePreview ? "icedr-dialog-container-media" : undefined}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
      palette={palette}
      scroll="inside"
      size="full"
      style={{
        "--file-preview-dialog-height": workspacePreview ? "100dvh" : "min(820px, calc(100dvh - 48px))",
        "--file-preview-dialog-width": workspacePreview ? "100vw" : "min(1160px, calc(100vw - 48px))",
      } as CSSProperties}
    >
      <div
        className="icedr-file-preview-frame"
        style={
          {
            "--preview-bg": palette.canvas,
            "--preview-border": palette.hairline,
            "--preview-border-strong": palette.hairlineStrong,
            "--preview-focus": palette.focusRing,
            "--preview-muted": palette.subtle,
            "--preview-panel": palette.surface1,
            "--preview-panel-strong": palette.surface2,
            "--preview-selected": palette.selected,
            "--preview-text": palette.ink,
          } as CSSProperties
        }
      >
        <header className="icedr-file-preview-header">
          <div className="icedr-file-preview-identity">
            {workspacePreview ? (
              <button className="icedr-file-preview-back" type="button" aria-label={t("preview.back")} onClick={onClose}>
                <LocalIcon name="arrow_left" size={18} />
              </button>
            ) : null}
            <span className="icedr-file-preview-icon">
              {activeItem ? (
                <ItemIcon item={activeItem} palette={palette} size={24} />
              ) : (
                <LocalIcon name="visible" size={24} color={palette.primaryHover} />
              )}
            </span>
            <div className="icedr-file-preview-title-block">
              <strong className="icedr-truncate">
                {activeItem?.name ?? t(itemResolved ? "preview.missing" : "preview.title")}
              </strong>
              <span className="icedr-truncate">
                {activeItem ? sizeLabel : itemResolved ? t("preview.missingHint") : t("app.loading")}
              </span>
            </div>
          </div>

          <div className="icedr-file-preview-actions">
            <ToolButton disabled={!activeItem} label={t("actions.download")} palette={palette} onClick={downloadActiveItem} tone="accent" visual="surface">
              <LocalIcon name="download" size={17} />
            </ToolButton>
            <ToolButton disabled={!activeItem} label={t("actions.copyLink")} palette={palette} onClick={copyActivePreviewLink} visual="surface">
              <LocalIcon name="share2" size={17} />
            </ToolButton>
            <ToolButton label={t("app.close")} palette={palette} onClick={onClose} visual="surface">
              <LocalIcon name="cross" size={17} />
            </ToolButton>
          </div>
        </header>

        <div className={cn("icedr-file-preview-body", workspacePreview && "icedr-file-preview-body-media")}>
          <div className="icedr-file-preview-stage">
            {activeItem ? (
              <PreviewLifecycleBoundary
                error={previewLifecycle.error}
                intent={previewIntent}
                loading={previewLifecycle.loading}
                onRetry={previewLifecycle.retry}
                palette={palette}
              >
                <DriveFilePreviewContent
                  key={activeItem.id}
                  item={activeItem}
                  locale={locale}
                  onSaved={onSaved}
                  onMediaDetailsClose={() => updateMediaDetailsOpen(false)}
                  onMediaDetailsOpen={() => updateMediaDetailsOpen(true)}
                  openWith={openWith ?? null}
                  palette={palette}
                  mediaDetailsOpen={mediaDetailsOpen}
                  previewIntent={previewIntent}
                  timeZone={timeZone}
                  workspaceId={effectiveWorkspaceId ?? null}
                />
              </PreviewLifecycleBoundary>
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
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(mediaDetailsPreferenceKey) === "true";
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
  const statusLabel = t(getPreviewStatusMessageKey(previewIntent, previewCapability));
  const previewTitle = t(getPreviewTitleMessageKey(previewIntent, previewCapability));
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
        title={previewTitle}
      />
    );

  const showMetadata = !canEditText && (openWith === "image" || openWith === "video");
  const showWorkspaceChrome = showMetadata || (canPreviewDocument && openWith === "office");
  const workspaceMode = showMetadata ? "media" : canEditText ? "text" : canPreviewDocument ? "document" : "status";

  return (
    <div className="icedr-preview-workspace" data-mode={workspaceMode}>
      {showWorkspaceChrome ? (
        <div
          className="icedr-preview-media-layout"
          data-details-open={(showMetadata && mediaDetailsOpen) || (canPreviewDocument && openWith === "office") ? "true" : "false"}
        >
          <div className="icedr-preview-media-stage">
            <PreviewZoomStage
              detailsOpen={showMetadata ? mediaDetailsOpen : undefined}
              key={`${previewItem.id}-${openWith}`}
              mode={workspaceMode}
              onToggleDetails={showMetadata ? () => {
                if (mediaDetailsOpen) onMediaDetailsClose();
                else onMediaDetailsOpen();
              } : undefined}
              palette={palette}
            >
              {previewNode}
            </PreviewZoomStage>
          </div>
          {showMetadata && mediaDetailsOpen ? (
            <DrivePreviewMetadataPanel
              item={previewItem}
              locale={locale}
              mediaMetadata={mediaMetadata}
              onClose={onMediaDetailsClose}
              onVersionRestored={onSaved}
              openWith={openWith}
              palette={palette}
              timeZone={timeZone}
            />
          ) : canPreviewDocument && openWith === "office" ? (
            <DrivePreviewMetadataPanel
              closeable={false}
              item={previewItem}
              locale={locale}
              mediaMetadata={{}}
              onClose={onMediaDetailsClose}
              onVersionRestored={onSaved}
              openWith={openWith}
              palette={palette}
              timeZone={timeZone}
            />
          ) : null}
        </div>
      ) : (
        <div className="icedr-preview-simple-stage">{previewNode}</div>
      )}
    </div>
  );
}

function isWorkspacePreview(item: DriveItem | null | undefined, openWith: FileOpenWithApp | null) {
  if (!item) return false;
  return (
    (openWith === "image" && isImagePreviewFile(item)) ||
    (openWith === "video" && isVideoPreviewFile(item)) ||
    (openWith === "office" && isOfficePreviewFile(item))
  );
}

function PreviewZoomStage({
  children,
  detailsOpen,
  mode,
  onToggleDetails,
  palette,
}: {
  children: React.ReactNode;
  detailsOpen?: boolean;
  mode: "document" | "media" | "status" | "text";
  onToggleDetails?: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const [zoom, setZoom] = useState(100);
  const decreaseZoom = () => setZoom((current) => Math.max(50, current - 10));
  const increaseZoom = () => setZoom((current) => Math.min(160, current + 10));
  const resetZoom = () => setZoom(100);

  return (
    <div className="icedr-preview-zoom-stage">
      <div className="icedr-preview-media-toolbar" aria-label={t("preview.title")}>
        {mode === "document" ? (
          <span className="icedr-preview-page-meter" aria-label={t("preview.pages")}>
            <LocalIcon name="document" size={14} />
            <strong>1</strong>
            <span>/ --</span>
          </span>
        ) : null}
        <ToolButton disabled={zoom <= 50} label={t("preview.zoomOut")} palette={palette} size="sm" onClick={decreaseZoom} visual="surface">
          <LocalIcon name="minus" size={15} />
        </ToolButton>
        <button className="icedr-preview-zoom-value" type="button" onClick={resetZoom} aria-label={t("preview.zoomReset")}>
          {zoom}%
        </button>
        <ToolButton disabled={zoom >= 160} label={t("preview.zoomIn")} palette={palette} size="sm" onClick={increaseZoom} visual="surface">
          <LocalIcon name="plus" size={15} />
        </ToolButton>
        <ToolButton label={t("preview.zoomReset")} palette={palette} size="sm" onClick={resetZoom} visual="surface">
          <LocalIcon name="expand" size={15} />
        </ToolButton>
        {onToggleDetails ? (
          <ToolButton active={detailsOpen} label={t("app.details")} palette={palette} size="sm" onClick={onToggleDetails} visual="surface">
            <LocalIcon name="info" size={15} />
          </ToolButton>
        ) : null}
      </div>
      <div className="icedr-preview-canvas">
        <div className="icedr-preview-zoom-surface" style={{ "--preview-zoom": zoom / 100 } as CSSProperties}>
          {children}
        </div>
      </div>
    </div>
  );
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
  const [metadata, setMetadata] = useState<PreviewMediaMetadata>({});
  const aspectRatio = metadata.width && metadata.height ? `${metadata.width} / ${metadata.height}` : undefined;

  return (
    <div
      className="icedr-preview-media-viewer"
      style={{
        "--preview-media-border": palette.hairline,
        "--preview-media-aspect-ratio": aspectRatio,
      } as CSSProperties}
    >
      {imageUrl ? (
        <img
          alt={item.name}
          onLoad={(event) => {
            const image = event.currentTarget;
            const nextMetadata = {
              aspectRatio: formatAspectRatio(image.naturalWidth, image.naturalHeight),
              height: image.naturalHeight || undefined,
              width: image.naturalWidth || undefined,
            };
            setMetadata(nextMetadata);
            onMetadata(nextMetadata);
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
  const [metadata, setMetadata] = useState<PreviewMediaMetadata>({});
  const aspectRatio = metadata.width && metadata.height ? `${metadata.width} / ${metadata.height}` : undefined;

  return (
    <div
      className="icedr-preview-media-viewer"
      style={{
        "--preview-media-border": palette.hairline,
        "--preview-media-aspect-ratio": aspectRatio,
      } as CSSProperties}
    >
      {videoUrl ? (
        <video
          className="icedr-preview-media-object"
          controls
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const nextMetadata = {
              aspectRatio: formatAspectRatio(video.videoWidth, video.videoHeight),
              duration: Number.isFinite(video.duration) ? formatDuration(video.duration) : undefined,
              height: video.videoHeight || undefined,
              width: video.videoWidth || undefined,
            };
            setMetadata(nextMetadata);
            onMetadata(nextMetadata);
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
        className="icedr-preview-document-frame"
        src={documentUrl}
        title={item.name}
      />
    );
  }

  if (extension === "docx" && documentHtml) {
    return (
      <div className="icedr-preview-document-shell">
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
