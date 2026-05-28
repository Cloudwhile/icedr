"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDriveItemModified, formatFileSize, getItemKind, palettes, sumDriveItemSizes, type DriveItem, type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { copyTextToClipboard, createFilePreviewIntent, createPreviewUrl, downloadWorkspaceDriveItem, type PreviewIntentResponse } from "@/features/file/actions";
import { AuthGate } from "./auth-client";
import { fetchFileNode, fetchWorkspaces } from "@/lib/drive-api";
import { mapFileNodeToDriveItem } from "@/features/file/mappers";
import { LocalizedDriveShell, ThemeLanguageActions } from "./drive-shell";
import { ItemIcon, LocalIcon, Surface, ToolButton } from "./drive-primitives";
export function FilePreviewRoute({
  itemId
}: {
  itemId: string;
}) {
  return <LocalizedDriveShell>
      {({
      locale,
      setLocale,
      setThemeMode,
      themeMode
    }) => <AuthGate>
          <FilePreviewPage itemId={itemId} locale={locale} setLocale={setLocale} setThemeMode={setThemeMode} themeMode={themeMode} />
        </AuthGate>}
    </LocalizedDriveShell>;
}
function FilePreviewPage({
  itemId,
  locale,
  setLocale,
  setThemeMode,
  themeMode
}: {
  itemId: string;
  locale: Locale;
  setLocale: React.Dispatch<React.SetStateAction<Locale>>;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const palette = palettes[themeMode];
  const [resolvedItem, setResolvedItem] = useState<{
    itemId: string;
    item: DriveItem | null;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [resolvedPreviewIntent, setResolvedPreviewIntent] = useState<{
    itemId: string;
    intent: PreviewIntentResponse | null;
  } | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const item = resolvedItem?.itemId === itemId ? resolvedItem.item : null;
  const itemResolved = resolvedItem?.itemId === itemId;
  const previewIntent = resolvedPreviewIntent?.itemId === itemId ? resolvedPreviewIntent.intent : null;
  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaces().then(workspaces => {
      const currentWorkspaceId = workspaces[0]?.id;
      if (!currentWorkspaceId) throw new Error("Workspace unavailable");
      if (!cancelled) setWorkspaceId(currentWorkspaceId);
      return fetchFileNode(itemId);
    }).then(node => {
      if (!cancelled) setResolvedItem({
        itemId,
        item: mapFileNodeToDriveItem(node)
      });
    }).catch(() => {
      if (!cancelled) setResolvedItem({
        itemId,
        item: null
      });
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    void createFilePreviewIntent(item.id).then(intent => {
      if (!cancelled) setResolvedPreviewIntent({
        itemId: item.id,
        intent
      });
    }).catch(() => {
      if (!cancelled) setResolvedPreviewIntent({
        itemId: item.id,
        intent: null
      });
    });
    return () => {
      cancelled = true;
    };
  }, [item]);
  const copyPreviewLink = async () => {
    if (!item) return;
    await copyTextToClipboard(createPreviewUrl(item.id));
    setFeedback(t("app.copied"));
  };
  const downloadPreviewItem = () => {
    if (!item) return;
    void downloadWorkspaceDriveItem(item, workspaceId ?? undefined).then(() => setFeedback(t("app.downloaded"))).catch(() => setFeedback(t("share.downloadFailed")));
  };
  return <div style={{
    minHeight: "100vh",
    background: palette.canvas,
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  }}>
      <div className="icedr-r-padding-inline" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "56px",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    } as React.CSSProperties}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "12px",
        minWidth: "0px"
      }}>
          <ToolButton label={t("app.up")} palette={palette} onClick={() => router.push("/")}>
            <LocalIcon name="arrow_left" size={17} />
          </ToolButton>
          {item ? <ItemIcon item={item} palette={palette} size={18} /> : <LocalIcon name="visible" size={18} color={palette.primaryHover} />}
          <div style={{
          minWidth: "0px"
        }}>
            <span className="icedr-truncate" style={{
            color: palette.ink,
            fontWeight: "600"
          }}>
              {item?.name ?? t("preview.missing")}
            </span>
            <span className="icedr-truncate" style={{
            color: palette.subtle,
            fontSize: "12px"
          }}>
              {item ? formatFileSize(sumDriveItemSizes([item], [item]), locale) : "--"}
            </span>
          </div>
        </div>

        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "4px"
      }}>
          {item ? <>
              <ToolButton label={t("actions.share")} palette={palette} onClick={copyPreviewLink}>
                <LocalIcon name="share2" size={17} />
              </ToolButton>
              <ToolButton label={t("actions.download")} palette={palette} onClick={downloadPreviewItem}>
                <LocalIcon name="download" size={17} />
              </ToolButton>
            </> : null}
          <ThemeLanguageActions locale={locale} palette={palette} setLocale={setLocale} setThemeMode={setThemeMode} themeMode={themeMode} />
        </div>
      </div>

      <div style={{
      display: "flex",
      minHeight: "calc(100vh - 56px)",
      alignItems: "center",
      justifyContent: "center",
      paddingInline: "16px",
      paddingBlock: "24px"
    }}>
        {item ? <PreviewContent item={item} locale={locale} palette={palette} previewIntent={previewIntent} /> : itemResolved ? <Surface palette={palette} style={{
        width: "min(860px, 100%)",
        minHeight: "460px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
            <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "center",
          textAlign: "center",
          paddingInline: "24px"
        }}>
              <LocalIcon name="info" size={44} color={palette.primaryHover} />
              <span style={{
            color: palette.ink,
            fontSize: "20px",
            fontWeight: "600"
          }}>
                {t("preview.missing")}
              </span>
              <span style={{
            color: palette.subtle,
            maxWidth: "460px"
          }}>
                {t("preview.missingHint")}
              </span>
            </div>
          </Surface> : <Surface palette={palette} style={{
        width: "min(860px, 100%)",
        minHeight: "460px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
            <span style={{
          color: palette.subtle
        }}>{t("preview.notConfigured")}</span>
          </Surface>}
      </div>
      {feedback ? <div className="icedr-r-right" style={{
      display: "flex",
      position: "fixed",
      "--r-right-base": "12px",
      "--r-right-md": "20px",
      bottom: "24px",
      zIndex: "60",
      alignItems: "center",
      gap: "8px",
      minHeight: "40px",
      maxWidth: "min(360px, calc(100vw - 24px))",
      paddingInline: "12px",
      borderRadius: "8px",
      background: palette.surface3,
      color: palette.ink,
      borderWidth: "1px",
      borderColor: palette.hairlineStrong,
      boxShadow: "0 18px 44px rgba(0, 0, 0, 0.34)"
    } as React.CSSProperties}>
          <span className="icedr-truncate" style={{
        fontSize: "13px",
        fontWeight: "600"
      }}>
            {feedback}
          </span>
        </div> : null}
    </div>;
}
function PreviewContent({
  item,
  locale,
  palette,
  previewIntent
}: {
  item: DriveItem;
  locale: Locale;
  palette: Palette;
  previewIntent: PreviewIntentResponse | null;
}) {
  const t = useTranslations();
  const kind = getItemKind(item);
  const size = formatFileSize(sumDriveItemSizes([item], [item]), locale);
  const title = t(`preview.kindTitle.${kind}`);
  const statusLabel = previewIntent ? t(`preview.apiStatus.${previewIntent.status}`) : t("preview.notConfigured");
  return <Surface palette={palette} style={{
    width: "min(980px, 100%)",
    minHeight: "520px",
    overflow: "hidden"
  }}>
      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      height: "58px",
      paddingInline: "16px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "12px",
        minWidth: "0px"
      }}>
          <ItemIcon item={item} palette={palette} size={22} />
          <div style={{
          minWidth: "0px"
        }}>
            <span className="icedr-truncate" style={{
            color: palette.ink,
            fontWeight: "700"
          }}>
              {title}
            </span>
            <span className="icedr-truncate" style={{
            color: palette.subtle,
            fontSize: "12px"
          }}>
              {item.owner ? `${item.owner} / ` : ""}{formatDriveItemModified(item, locale)} / {size}
            </span>
          </div>
        </div>
      </div>

      <div className="icedr-r-padding" style={{
      display: "flex",
      minHeight: "462px",
      alignItems: "center",
      justifyContent: "center",
      "--r-padding-base": "16px",
      "--r-padding-md": "24px"
    } as React.CSSProperties}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        alignItems: "center",
        textAlign: "center",
        maxWidth: "520px"
      }}>
          <ItemIcon item={item} palette={palette} size={38} />
          <div>
            <span style={{
            color: palette.ink,
            fontWeight: "700",
            fontSize: "20px"
          }}>
              {t("preview.notConfigured")}
            </span>
            <span style={{
            color: palette.subtle,
            marginTop: "8px"
          }}>
              {kind === "archive" || previewIntent?.status === "unsupported" ? t("preview.unsupportedHint") : t("preview.notConfiguredHint")}
            </span>
          </div>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          width: "min(420px, 100%)",
          textAlign: "left"
        }}>
            <PreviewMetric label={t("files.type")} value={t(`files.kind.${kind}`)} palette={palette} />
            <PreviewMetric label={t("files.size")} value={size} palette={palette} />
            <PreviewMetric label={t("preview.status")} value={statusLabel} palette={palette} />
          </div>
        </div>
      </div>
    </Surface>;
}
function PreviewMetric({
  label,
  value,
  palette
}: {
  label: string;
  value: string;
  palette: Palette;
}) {
  return <div>
      <span style={{
      color: palette.subtle,
      fontSize: "12px"
    }}>
        {label}
      </span>
      <span style={{
      color: palette.ink,
      fontWeight: "700",
      marginTop: "4px"
    }}>
        {value}
      </span>
    </div>;
}
