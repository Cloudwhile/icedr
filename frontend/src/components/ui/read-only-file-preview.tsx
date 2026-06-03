"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { getPreviewRenderMode } from "@/features/file/open-with";
import { formatDriveItemModified, formatFileSize, getItemKind, sumDriveItemSizes, type DriveItem, type Locale, type Palette } from "@/features/file/model";
import { ItemIcon, LocalIcon } from "@/components/ui/local-icon";
import { useTimeZone } from "@/i18n/react";

export type ReadOnlyFilePreviewProps = {
  item: DriveItem | null;
  loadBlobUrl: (item: DriveItem) => Promise<string>;
  locale: Locale;
  palette: Palette;
  statusLabel: string;
  t: (key: string, values?: Record<string, string | number>) => string;
};

type PreviewState = {
  content: string;
  error: boolean;
  html: string;
  itemId: string | null;
  loading: boolean;
  url: string | null;
};

export function ReadOnlyFilePreview({ item, loadBlobUrl, locale, palette, statusLabel, t }: ReadOnlyFilePreviewProps) {
  const timeZone = useTimeZone();
  const kind = item ? getItemKind(item) : "doc";
  const renderMode = item ? getPreviewRenderMode(item) : "download-only";
  const canRenderText = renderMode === "markdown" || renderMode === "text";
  const canRenderDocument = renderMode === "docx" || renderMode === "pdf";
  const canRenderMedia = renderMode === "image" || renderMode === "video";
  const canRenderBlob = Boolean(item && item.previewCapability?.supported !== false && (canRenderMedia || canRenderText || canRenderDocument));
  const [state, setState] = useState<PreviewState>(() => ({
    content: "",
    error: false,
    html: "",
    itemId: item?.id ?? null,
    loading: canRenderBlob,
    url: null,
  }));
  const activeUrl = state.itemId === item?.id ? state.url : null;
  const activeContent = state.itemId === item?.id ? state.content : "";
  const activeHtml = state.itemId === item?.id ? state.html : "";
  const loading = Boolean(item && canRenderBlob && (state.itemId !== item.id || state.loading));
  const error = state.itemId === item?.id && state.error;
  const markdownHtml = useMemo(() => {
    if (renderMode !== "markdown") return "";
    return DOMPurify.sanitize(marked.parse(activeContent || "", { async: false }) as string);
  }, [activeContent, renderMode]);

  useEffect(() => {
    if (!item || !canRenderBlob) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    void loadBlobUrl(item).then(async (url) => {
      createdUrl = url;
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }

      if (canRenderText) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Preview failed");
        const content = await response.text();
        setState({
          content,
          error: false,
          html: "",
          itemId: item.id,
          loading: false,
          url,
        });
        return;
      }

      if (renderMode === "docx") {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Preview failed");
        const arrayBuffer = await response.arrayBuffer();
        const { default: mammoth } = await import("mammoth/mammoth.browser");
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setState({
          content: "",
          error: false,
          html: DOMPurify.sanitize(result.value),
          itemId: item.id,
          loading: false,
          url,
        });
        return;
      }

      setState({
        content: "",
        error: false,
        html: "",
        itemId: item.id,
        loading: false,
        url,
      });
    }).catch(() => {
      if (!cancelled) {
        if (createdUrl) URL.revokeObjectURL(createdUrl);
        setState({
          content: "",
          error: true,
          html: "",
          itemId: item.id,
          loading: false,
          url: null,
        });
      }
    });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [canRenderBlob, canRenderText, item, loadBlobUrl, renderMode]);

  useEffect(() => {
    return () => {
      if (state.url) URL.revokeObjectURL(state.url);
    };
  }, [state.url]);

  if (!item) {
    return <PreviewFallback icon="visible" message={t("preview.notConfigured")} palette={palette} title={t("preview.title")} />;
  }

  if (!canRenderBlob || error) {
    return <PreviewMetadataFallback item={item} locale={locale} palette={palette} statusLabel={statusLabel} t={t} timeZone={timeZone} />;
  }

  if (loading) {
    return <PreviewFallback item={item} message={statusLabel} palette={palette} title={t(`preview.kindTitle.${kind}`)} />;
  }

  if (renderMode === "image" && activeUrl) {
    return (
      <div className="icedr-readonly-preview-frame">
        <img alt={item.name} src={activeUrl} className="icedr-readonly-preview-image" />
      </div>
    );
  }

  if (renderMode === "video" && activeUrl) {
    return (
      <div className="icedr-readonly-preview-frame">
        <video className="icedr-readonly-preview-image" controls playsInline preload="metadata" src={activeUrl} title={item.name} />
      </div>
    );
  }

  if (renderMode === "pdf" && activeUrl) {
    return <iframe className="icedr-readonly-preview-frame icedr-readonly-preview-iframe" src={activeUrl} title={item.name} />;
  }

  if (renderMode === "docx" && activeHtml) {
    return (
      <div className="icedr-readonly-preview-document">
        <div className="icedr-preview-document" dangerouslySetInnerHTML={{ __html: activeHtml }} />
      </div>
    );
  }

  if (canRenderText) {
    if (renderMode === "markdown") {
      return (
        <div className="icedr-readonly-preview-document">
          <div className="icedr-preview-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
        </div>
      );
    }

    return (
      <pre className="icedr-readonly-preview-text">
        <code>{activeContent}</code>
      </pre>
    );
  }

  return <PreviewMetadataFallback item={item} locale={locale} palette={palette} statusLabel={statusLabel} t={t} timeZone={timeZone} />;
}

function PreviewMetadataFallback({
  item,
  locale,
  palette,
  statusLabel,
  t,
  timeZone,
}: {
  item: DriveItem;
  locale: Locale;
  palette: Palette;
  statusLabel: string;
  t: ReadOnlyFilePreviewProps["t"];
  timeZone?: string;
}) {
  const kind = getItemKind(item);
  const size = formatFileSize(sumDriveItemSizes([item], [item]), locale);

  return (
    <div className="icedr-readonly-preview-empty">
      <ItemIcon item={item} palette={palette} size={42} />
      <div>
        <span className="icedr-readonly-preview-title">{t(`preview.kindTitle.${kind}`)}</span>
        <span className="icedr-readonly-preview-description">
          {getPreviewFallbackHint(item, t)}
        </span>
      </div>
      <div className="icedr-readonly-preview-metrics">
        <PreviewMetric label={t("files.type")} value={t(`files.kind.${kind}`)} palette={palette} />
        <PreviewMetric label={t("files.size")} value={size} palette={palette} />
        <PreviewMetric label={t("files.modified")} value={formatDriveItemModified(item, locale, timeZone)} palette={palette} />
        <PreviewMetric label={t("preview.status")} value={statusLabel} palette={palette} />
      </div>
    </div>
  );
}

function PreviewFallback({
  icon,
  item,
  message,
  palette,
  title,
}: {
  icon?: "visible";
  item?: DriveItem;
  message: string;
  palette: Palette;
  title: string;
}) {
  return (
    <div className="icedr-readonly-preview-empty">
      {item ? <ItemIcon item={item} palette={palette} size={42} /> : <LocalIcon name={icon ?? "visible"} size={42} color={palette.primaryHover} />}
      <div>
        <span className="icedr-readonly-preview-title">{title}</span>
        <span className="icedr-readonly-preview-description">{message}</span>
      </div>
    </div>
  );
}

function PreviewMetric({ label, palette, value }: { label: string; palette: Palette; value: string }) {
  return (
    <div>
      <span className="icedr-readonly-preview-metric-label" style={{ color: palette.subtle }}>
        {label}
      </span>
      <span className="icedr-readonly-preview-metric-value" style={{ color: palette.ink }}>
        {value}
      </span>
    </div>
  );
}

function getPreviewFallbackHint(item: DriveItem, t: ReadOnlyFilePreviewProps["t"]) {
  if (item.previewCapability?.downloadOnly || getItemKind(item) === "archive") {
    return t("preview.downloadOnlyHint");
  }
  return t("preview.notConfiguredHint");
}
