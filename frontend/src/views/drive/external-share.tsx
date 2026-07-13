"use client";

import { Modal } from "@heroui/react";
import { useRouter } from "@/compat/navigation";
import { useTimeZone, useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMotionStagger } from "@/components/ui/motion";
import { showAppToast } from "@/components/ui/app-toast-store";
import { ExternalSharePageLoading } from "@/components/common/ui/loading-state";
import { findDriveItem, formatDriveItemModified, formatFileSize, getItemKind, sumDriveItemSizes, palettes, type DriveItem, type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { createSharedDriveItemBlobUrl, createSharedPreviewIntent, downloadSharedDriveItem, type PreviewIntentResponse } from "@/features/file/actions";
import { canOpenFilePreview } from "@/features/file/open-with";
import { createShareAccountAccessSession, fetchCurrentUser, getDriveApiErrorMessage, isAuthExpiredApiError, resolvePublicSiteName, type AuthUser, type PublicSiteSettings, type ShareAccessSession } from "@/lib/drive-api";
import { ThemeActions } from "./drive-shell";
import { ItemIcon, LocalIcon, StatusPill, Surface, ToolButton } from "./drive-primitives";
import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
import { collectShareDescendants, fetchRegisteredShare, getRegisteredShareParent, getShareItems, getVisibleRegisteredShareItems, type RegisteredShare, type RegisteredShareItem } from "@/features/share/registry";
import type { ExternalSharePolicy } from "@/features/share/policy";
import { AppImage } from "@/components/ui/app-image";
import { ReadOnlyFilePreview } from "@/components/ui/read-only-file-preview";
import { ExternalShareHeroCard } from "./external-share-hero-card";
import { ExternalShareSidePanel } from "./external-share-side-panel";
import { ShareAuthDialog } from "./external-share-auth-dialog";
const buttonTypeAttr: {
  type?: "button";
} = {
  type: "button"
};
type ShareMode = "single-file" | "multi-file" | "folder";
type VisitorStage = "choose" | "verified" | "waiting" | "download";
type VisitorAccessAction = "download" | "preview";
type VisitorLevel = "anonymous" | "email" | "ica";
type DriveTranslator = ReturnType<typeof useTranslations>;
type IdentityExperience = {
  hasSpeedLimit: boolean;
  label: string;
  waitSeconds: number;
  speedLabel: string;
  sessionLabel: string;
};
type AccessPolicyExperience = IdentityExperience;
function formatSpeedLimit(speedLimit: {
  value: number;
  unit: "KB/s" | "MB/s";
} | null, t: DriveTranslator) {
  return speedLimit ? `${speedLimit.value} ${speedLimit.unit}` : t("share.unlimited");
}
function formatPolicyWaitSeconds(policy: ExternalSharePolicy) {
  return policy.waitUnit === "minutes" ? policy.waitValue * 60 : policy.waitValue;
}
function getVisitorLabel(level: VisitorLevel, t: DriveTranslator) {
  if (level === "ica") return t("share.visitor.icaUser");
  if (level === "email") return t("share.visitor.emailVerified");
  return t("share.visitor.anonymous");
}
function getSharePolicyExperience(share: RegisteredShare, level: VisitorLevel, accessSession: ShareAccessSession | null, t: DriveTranslator): AccessPolicyExperience {
  const policyRule = share.downloadPolicy?.rules[level];
  const policyDecision = accessSession?.policyDecision;
  const waitSeconds = policyDecision?.waitSeconds ?? policyRule?.waitSeconds ?? (accessSession ? accessSession.waitSeconds : level === "ica" ? 0 : formatPolicyWaitSeconds(share.policy));
  const speedLimit = policyDecision?.speedLimit ?? policyRule?.speedLimit ?? (accessSession ? accessSession.speedLimit : share.policy.speedValue > 0 ? {
    value: share.policy.speedValue,
    unit: share.policy.speedUnit
  } : null);
  return {
    hasSpeedLimit: Boolean(speedLimit),
    label: getVisitorLabel(level, t),
    waitSeconds,
    speedLabel: formatSpeedLimit(speedLimit, t),
    sessionLabel: formatDownloadLimitLabel(policyDecision?.maxDownloads ?? share.downloadPolicy?.maxDownloads ?? 0, policyDecision?.downloadLimit ?? share.downloadPolicy?.downloadLimit ?? share.policy.downloadLimit, t)
  };
}
function getShareAccessRequired(share: RegisteredShare) {
  return share.downloadPolicy?.requiresAccessSession ?? Boolean(share.policy.allowedDomain || share.policy.downloadLimit || formatPolicyWaitSeconds(share.policy) > 0);
}
function formatDownloadLimitLabel(maxDownloads: number, downloadLimit: string, t: DriveTranslator) {
  if (maxDownloads > 0) return t("share.downloadLimitValue", { count: maxDownloads });
  return downloadLimit || t("share.noDownloadLimit");
}
type ShareCollection = {
  title: string;
  mode: ShareMode;
  owner: string;
  rootItems: DriveItem[];
  allowedIds: Set<string>;
  dynamicRootId: string | null;
};
function getCollectionFromRegisteredShare(record: RegisteredShare, sourceItems: DriveItem[]): ShareCollection | null {
  const {
    allowed,
    rootItems
  } = getShareItems(record, sourceItems);
  if (rootItems.length === 0) return null;
  return {
    title: record.title,
    mode: record.mode,
    owner: record.owner,
    rootItems,
    allowedIds: allowed,
    dynamicRootId: record.dynamicRootId
  };
}
function mapRegisteredShareItemToDriveItem(item: RegisteredShareItem): DriveItem {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    workspaceId: item.workspaceId,
    parentId: item.parentNodeId,
    owner: item.owner,
    modifiedAt: item.updatedAt,
    mimeType: item.mimeType,
    hasContent: item.hasContent,
    sizeBytes: item.sizeBytes,
    shared: true,
    starred: item.starred,
    archivedAt: item.archivedAt,
    previewCapability: item.previewCapability,
    colorKey: item.kind === "sheet" ? "success" : item.kind === "image" || item.kind === "video" ? "secure" : item.kind === "archive" ? "tertiary" : "primary"
  };
}
export function ExternalShareStandalone({
  initialShare,
  locale,
  setThemeMode,
  siteSettings,
  themeMode,
  token
}: {
  initialShare?: RegisteredShare;
  locale: Locale;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  siteSettings: PublicSiteSettings;
  themeMode: ThemeMode;
  token: string;
}) {
  const t = useTranslations();
  const palette = palettes[themeMode];
  const [resolvedShare, setResolvedShare] = useState<{
    token: string;
    share: RegisteredShare | null;
  }>(() => ({
    token: initialShare?.token === token ? token : "",
    share: initialShare?.token === token ? initialShare : null
  }));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceItems, setSourceItems] = useState<DriveItem[]>(() => initialShare?.token === token ? initialShare.items?.map(mapRegisteredShareItemToDriveItem) ?? [] : []);
  const previewLoading = resolvedShare.token !== token;
  const registeredShare = previewLoading ? null : resolvedShare.share;
  const collection = useMemo(() => registeredShare ? getCollectionFromRegisteredShare(registeredShare, sourceItems) : null, [registeredShare, sourceItems]);
  const totalSize = collection ? formatFileSize(sumDriveItemSizes(collection.rootItems, sourceItems), locale) : "--";
  const expiresLabel = registeredShare ? t("share.expiryValue", {
    count: registeredShare.expiresDays,
    unit: t("share.units.days")
  }) : t("share.unavailable");
  useEffect(() => {
    let cancelled = false;
    if (initialShare?.token === token && resolvedShare.token === token) {
      return () => {
        cancelled = true;
      };
    }
    const loadShare = async () => {
      try {
        const share = await fetchRegisteredShare(token);
        if (!cancelled) {
          setSourceItems(share?.items?.map(mapRegisteredShareItemToDriveItem) ?? []);
          setLoadError(share ? null : t("errors.shareUnavailable"));
          setResolvedShare({
            token,
            share: share ?? null
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSourceItems([]);
          setLoadError(getDriveApiErrorMessage(error, t, { fallbackKey: "share.unavailable", scope: "share" }));
          setResolvedShare({
            token,
            share: null
          });
        }
      }
    };
    void loadShare();
    return () => {
      cancelled = true;
    };
  }, [initialShare?.token, resolvedShare.token, t, token]);
  return <div className="external-share-root" style={{
    minHeight: "100vh",
    background: "transparent",
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  }}>
      {previewLoading ? <ExternalSharePageLoading label={t("app.loading")} palette={palette} /> : !registeredShare || !collection ? <ExternalShareErrorState message={loadError ?? t("errors.shareUnavailable")} palette={palette} /> : <ExternalSharePreview key={token} collection={collection} expiresLabel={expiresLabel} locale={locale} registeredShare={registeredShare} palette={palette} setThemeMode={setThemeMode} siteSettings={siteSettings} sourceItems={sourceItems} themeMode={themeMode} totalSize={totalSize} />}
    </div>;
}

function ExternalShareErrorState({
  message,
  palette,
}: {
  message: string;
  palette: Palette;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background: palette.canvas,
        color: palette.ink,
        display: "flex",
        justifyContent: "center",
        minHeight: "100vh",
        paddingBlock: "32px",
        paddingInline: "18px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          maxWidth: "360px",
          textAlign: "center",
        }}
      >
        <LocalIcon name="shield" size={28} />
        <div style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "0px" }}>{message}</div>
      </div>
    </div>
  );
}

function ExternalSharePreview({
  collection,
  expiresLabel,
  locale,
  palette,
  registeredShare,
  setThemeMode,
  siteSettings,
  sourceItems,
  themeMode,
  totalSize
}: {
  collection: ShareCollection;
  expiresLabel: string;
  locale: Locale;
  palette: Palette;
  registeredShare: RegisteredShare;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  siteSettings: PublicSiteSettings;
  sourceItems: DriveItem[];
  themeMode: ThemeMode;
  totalSize: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [stage, setStage] = useState<VisitorStage>("choose");
  const [visitorLevel, setVisitorLevel] = useState<VisitorLevel>("anonymous");
  const [remaining, setRemaining] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [accessItem, setAccessItem] = useState<DriveItem | null>(null);
  const [accessAction, setAccessAction] = useState<VisitorAccessAction>("download");
  const [authOpen, setAuthOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [accessSessionId, setAccessSessionId] = useState<string | null>(null);
  const [accessSession, setAccessSession] = useState<ShareAccessSession | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [preview, setPreview] = useState<{
    item: DriveItem;
    intent: PreviewIntentResponse | null;
  } | null>(null);
  const visibleItems = getVisibleRegisteredShareItems(registeredShare, folderId, sourceItems);
  const currentFolder = folderId ? findDriveItem(folderId, sourceItems) : undefined;
  const shareContentCount = collection.allowedIds.size;
  const experience = getSharePolicyExperience(registeredShare, visitorLevel, accessSession, t);
  const verified = stage === "verified" || stage === "waiting" || stage === "download";
  const accessSessionRequired = getShareAccessRequired(registeredShare);
  const primaryAccessItem = getPrimaryShareAccessItem(visibleItems, sourceItems, registeredShare);
  const primaryAccessAction: VisitorAccessAction | null = registeredShare.allowDownload ? "download" : registeredShare.allowPreview ? "preview" : null;
  const visibleListRef = useMotionStagger<HTMLDivElement>([folderId, visibleItems.map(item => item.id).join("|")]);
  useEffect(() => {
    if (stage !== "waiting") return;
    const id = window.setInterval(() => {
      setRemaining(value => {
        if (value <= 1) {
          window.clearInterval(id);
          setStage("download");
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [stage]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser().then(user => {
      if (!cancelled) setCurrentUser(user);
    }).catch(() => {
      if (!cancelled) setCurrentUser(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!currentUser || accessSessionId || accessSession?.identityType === "ica") return;
    let cancelled = false;
    void createShareAccountAccessSession(registeredShare.token).then(session => {
      if (cancelled) return;
      setAccessSessionId(session.sessionId);
      setAccessSession(session);
      setVisitorLevel("ica");
      setRemaining(session.waitSeconds);
      setStage(session.waitSeconds > 0 ? "verified" : "download");
    }).catch(() => {
      if (!cancelled) setCurrentUser(null);
    });
    return () => {
      cancelled = true;
    };
  }, [accessSession?.identityType, accessSessionId, currentUser, registeredShare.token]);
  const goUp = () => setFolderId(getRegisteredShareParent(registeredShare, folderId, sourceItems));
  const redirectToLogin = () => {
    router.push(`/login?next=${encodeURIComponent(`/share/s/${registeredShare.token}`)}`);
  };
  const requestVisitorAction = (item: DriveItem, action: VisitorAccessAction) => {
    if (action === "download" && !registeredShare.allowDownload) {
      setFeedback(t("share.downloadBlocked"));
      return;
    }
    if (action === "preview" && !registeredShare.allowPreview) {
      showAppToast({
        dedupeKey: `share-preview-blocked-${registeredShare.token}-${item.id}`,
        title: t("preview.noArtifact"),
        tone: "info",
      });
      return;
    }
    if (action === "preview" && !canOpenFilePreview(item)) {
      showAppToast({
        dedupeKey: `share-preview-no-artifact-${registeredShare.token}-${item.id}`,
        title: t("preview.noArtifact"),
        tone: "info",
      });
      return;
    }
    setAccessItem(item);
    setAccessAction(action);
    if (stage === "download") {
      setAuthOpen(true);
      return;
    }
    if (!accessSessionRequired) {
      setAuthOpen(true);
      setVisitorLevel("anonymous");
      setRemaining(0);
      setStage("download");
      return;
    }
    if (!currentUser) {
      redirectToLogin();
      return;
    }
    setAuthOpen(true);
    if (!accessSessionId) setAccessSession(null);
    setRemaining(experience.waitSeconds);
    setStage("choose");
  };
  const authenticateAccount = () => {
    if (!accessItem) return;
    if (!currentUser) {
      redirectToLogin();
      return;
    }
    setAuthBusy(true);
    void createShareAccountAccessSession(registeredShare.token).then(session => {
      setAccessSessionId(session.sessionId);
      setAccessSession(session);
      setVisitorLevel("ica");
      setRemaining(session.waitSeconds);
      setStage(session.waitSeconds > 0 ? "verified" : "download");
    }).catch((error) => {
      if (isAuthExpiredApiError(error)) {
        redirectToLogin();
        return;
      }
      setFeedback(getDriveApiErrorMessage(error, t, { fallbackKey: "share.icaUnavailable", scope: "share" }));
    }).finally(() => setAuthBusy(false));
  };
  const continueToDownload = () => {
    const currentWait = remaining;
    setRemaining(currentWait);
    setStage(currentWait > 0 ? "waiting" : "download");
  };
  const completeVisitorAction = () => {
    if (!accessItem) return;
    if (accessAction === "preview" && !canOpenFilePreview(accessItem)) {
      showAppToast({
        dedupeKey: `share-preview-no-artifact-${registeredShare.token}-${accessItem.id}`,
        title: t("preview.noArtifact"),
        tone: "info",
      });
      setAuthOpen(false);
      return;
    }
    const actionPromise = accessAction === "download" ? downloadSharedDriveItem(registeredShare.token, accessItem, accessSessionId ?? undefined).then(() => {
      setFeedback(t("app.downloaded"));
    }) : createSharedPreviewIntent(registeredShare.token, accessItem.id, accessSessionId ?? undefined).then(intent => {
      if (!intent.capability.supported) {
        showAppToast({
          dedupeKey: `share-preview-no-artifact-${registeredShare.token}-${accessItem.id}`,
          title: t("preview.noArtifact"),
          tone: "info",
        });
        return;
      }
      setPreview({
        item: accessItem,
        intent
      });
    });
    void actionPromise.then(() => setAuthOpen(false)).catch((error) => {
      setFeedback(getDriveApiErrorMessage(error, t, {
        fallbackKey: accessAction === "download" ? "share.downloadFailed" : "preview.notConfigured",
        scope: "share",
      }));
    });
  };
  return <div className="external-share-preview" style={{
    minHeight: "100vh"
  }}>
      <div className="icedr-r-padding-inline external-share-topbar" style={{
      "--r-padding-inline-base": "16px",
      "--r-padding-inline-md": "24px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    } as React.CSSProperties}>
        <div className="external-share-brand">
          <AppImage
            src={siteSettings.authLogoDataUrl || "/logo.png"}
            alt=""
            height={28}
            width={28}
            className="external-share-brand-logo"
          />
          <span className="external-share-brand-name icedr-truncate">{resolvePublicSiteName(siteSettings.siteName)}</span>
        </div>
        <div className="external-share-topbar-actions">
          <span className="external-share-topbar-status">
            <LocalIcon name="shield" size={16} />
            <span>{verified ? t("share.verifiedAccess") : t("share.title")}</span>
          </span>
          <button className="external-share-topbar-home" type="button" onClick={() => router.push("/")}>
            <LocalIcon name="house" size={16} />
            <span>{t("share.returnHome")}</span>
          </button>
          <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
        </div>
      </div>

      <div className="icedr-r-padding-inline external-share-content" style={{
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "18px",
      maxWidth: "1280px",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      paddingBlock: "26px",
      minHeight: "calc(100vh - 56px)"
    } as React.CSSProperties}>
        <div className="external-share-main-column" style={{
        display: "flex",
        flexDirection: "column",
        gap: "0px",
        minWidth: "0px"
      }}>
          <div className="external-share-workbench">
            <ExternalShareHeroCard collection={collection} expiresLabel={expiresLabel} locale={locale} palette={palette} shareToken={registeredShare.token} sourceItems={sourceItems} totalItems={shareContentCount} totalSize={totalSize} />

            <VisitorShareBrowser activeItemId={accessItem?.id ?? null} allowDownload={registeredShare.allowDownload} allowPreview={registeredShare.allowPreview} collectionTitle={collection.title} currentFolder={currentFolder} folderId={folderId} goUp={goUp} locale={locale} onDownloadItem={item => requestVisitorAction(item, "download")} onOpenFolder={setFolderId} onPreviewItem={item => requestVisitorAction(item, "preview")} palette={palette} registeredShare={registeredShare} sourceItems={sourceItems} totalItems={shareContentCount} visibleItems={visibleItems} visibleListRef={visibleListRef} />
          </div>
        </div>

        <ExternalShareSidePanel
          collectionItems={collection.rootItems}
          experience={experience}
          expiresLabel={expiresLabel}
          onStartAccess={primaryAccessItem && primaryAccessAction ? () => requestVisitorAction(primaryAccessItem, primaryAccessAction) : undefined}
          registeredShare={registeredShare}
          selectedEmail={currentUser?.email ?? ""}
          totalItems={shareContentCount}
          totalSize={totalSize}
          verified={verified}
        />
      </div>

      <ShareAuthDialog action={accessAction} accessExperience={experience} accessItem={accessItem} locale={locale} accountConfigured={Boolean(currentUser)} busy={authBusy} onAccountAuth={authenticateAccount} onClose={() => setAuthOpen(false)} onContinue={continueToDownload} onComplete={completeVisitorAction} open={authOpen} palette={palette} remaining={remaining} sourceItems={sourceItems} stage={stage} />
      <SharePreviewDialog accessSessionId={accessSessionId} onClose={() => setPreview(null)} open={Boolean(preview)} palette={palette} preview={preview} locale={locale} shareToken={registeredShare.token} />
      {feedback ? <div className="icedr-r-right external-share-feedback" style={{
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
      background: "transparent",
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
function VisitorShareBrowser({
  activeItemId,
  allowDownload,
  allowPreview,
  collectionTitle,
  currentFolder,
  folderId,
  goUp,
  locale,
  onDownloadItem,
  onOpenFolder,
  onPreviewItem,
  palette,
  registeredShare,
  sourceItems,
  totalItems,
  visibleItems,
  visibleListRef
}: {
  activeItemId: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  collectionTitle: string;
  currentFolder?: DriveItem;
  folderId: string | null;
  goUp: () => void;
  locale: Locale;
  onDownloadItem: (item: DriveItem) => void;
  onOpenFolder: (id: string) => void;
  onPreviewItem: (item: DriveItem) => void;
  palette: Palette;
  registeredShare: RegisteredShare;
  sourceItems: DriveItem[];
  totalItems: number;
  visibleItems: DriveItem[];
  visibleListRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  const allowedItemIds = useMemo(() => new Set(registeredShare.allowedItemIds), [registeredShare.allowedItemIds]);
  const canOpenFolder = useCallback((item: DriveItem) => getItemKind(item) === "folder" && collectShareDescendants(item, sourceItems).some(child => allowedItemIds.has(child.id)), [allowedItemIds, sourceItems]);
  const firstBrowsableFolder = !folderId ? visibleItems.find(canOpenFolder) ?? null : null;
  const showFooterAction = !folderId && totalItems > visibleItems.length;
  return <Surface palette={palette} className="icedr-r-min-height external-share-browser" style={{
    overflow: "hidden",
    flex: "0 0 auto",
    "--r-min-height-base": "360px",
    "--r-min-height-lg": "0px"
  } as React.CSSProperties}>
      <div className="external-share-browser-header" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "52px",
      paddingInline: "16px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    }}>
        <div className="external-share-browser-heading" style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        minWidth: "0px"
      }}>
          {folderId ? <ToolButton label={t("app.up")} palette={palette} onClick={goUp}>
              <LocalIcon name="arrow_up" size={16} />
            </ToolButton> : null}
          <div className="external-share-browser-title-stack">
            <span className="external-share-browser-title icedr-truncate">{t("share.contentPreview")}</span>
            <span className="external-share-browser-subtitle icedr-truncate">{currentFolder?.name ?? collectionTitle}</span>
          </div>
        </div>
        <StatusPill palette={palette}>{t("share.itemCountValue", { count: totalItems })}</StatusPill>
      </div>

      {visibleItems.length === 0 ? <div className="external-share-browser-empty" style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      minHeight: "300px",
      color: palette.subtle
    }}>
          <LocalIcon name="folder" size={28} />
          <span style={{
        fontWeight: "600"
      }}>{t("files.emptyTitle")}</span>
        </div> : <div ref={visibleListRef} className="external-share-browser-list" style={{
      display: "flex",
      flexDirection: "column",
      gap: "0px"
    }}>
          <div className="external-share-browser-table-head" aria-hidden="true">
            <span>{t("files.name")}</span>
            <span>{t("files.size")}</span>
            <span>{t("files.type")}</span>
            <span />
          </div>
          {visibleItems.map(item => {
        const isFolder = getItemKind(item) === "folder";
        const canOpen = canOpenFolder(item);
        const isActive = activeItemId === item.id;
        return <div key={item.id} data-motion-row className="icedr-has-hover external-share-file-row" style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          paddingInline: "16px",
          paddingBlock: "12px",
          minHeight: "64px",
          textAlign: "left",
          borderBottomWidth: "1px",
          borderColor: palette.hairline,
          background: "transparent",
          boxShadow: isActive ? `inset 2px 0 0 ${palette.primary}` : "none",
          transition: "background-color var(--motion-base) var(--motion-ease), box-shadow var(--motion-base) var(--motion-ease)",
          "--hover-bg": "transparent",
          "--hover-box-shadow": `inset 2px 0 0 ${palette.primary}`
        } as React.CSSProperties}>
                <div className="external-share-file-primary" style={{
            alignItems: "center",
            display: "flex",
            gap: "12px",
            minWidth: "0px",
            flex: "1 1 auto"
          }}>
                  <ItemIcon item={item} palette={palette} size={20} />
                  <div {...canOpen ? buttonTypeAttr : {}} onClick={canOpen ? () => onOpenFolder(item.id) : undefined} style={{
              minWidth: "0px",
              flex: "1 1 auto",
              textAlign: "left",
              transition: "color var(--motion-fast) var(--motion-ease)"
            } as React.CSSProperties}>
                    <div style={{
                alignItems: "center",
                display: "flex",
                gap: "8px",
                minWidth: "0px"
              }}>
                      <span className="icedr-truncate" style={{
                  color: "inherit",
                  fontWeight: "500"
                }}>
                        {item.name}
                      </span>
                      {isFolder ? <LocalIcon name="arrow_right" size={14} color={palette.subtle} /> : null}
                    </div>
                    <div style={{
                alignItems: "center",
                display: "flex",
                gap: "8px",
                marginTop: "4px",
                color: palette.subtle,
                fontSize: "12px"
              }}>
                      <span>{t(`files.kind.${getItemKind(item)}`)}</span>
                      <span>/</span>
                      <span>{formatDriveItemModified(item, locale, timeZone)}</span>
                    </div>
                  </div>
                </div>

                <span className="external-share-file-size">
                  {formatFileSize(sumDriveItemSizes([item], sourceItems), locale)}
                </span>
                <span className="external-share-file-type icedr-truncate">
                  {t(`files.kind.${getItemKind(item)}`)}
                </span>
                <div className="external-share-file-actions" style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            marginLeft: "12px",
            flexShrink: "0"
          }}>
                  {isFolder ? <ToolButton label={canOpen ? t("actions.open") : t("share.unavailable")} palette={palette} disabled={!canOpen} onClick={() => canOpen && onOpenFolder(item.id)}>
                      <LocalIcon name="folder" size={16} />
                    </ToolButton> : <>
                      <ToolButton label={allowPreview ? t("share.openPreview") : t("preview.unsupportedHint")} palette={palette} disabled={!allowPreview} onClick={() => onPreviewItem(item)}>
                        <LocalIcon name="visible" size={16} />
                      </ToolButton>
                      <VisitorActionsMenu allowDownload={allowDownload} allowPreview={allowPreview} item={item} onDownloadItem={onDownloadItem} onPreviewItem={onPreviewItem} palette={palette} />
                    </>}
                </div>
              </div>;
      })}
          {showFooterAction ? <button className="external-share-browser-footer" type="button" disabled={!firstBrowsableFolder} onClick={() => firstBrowsableFolder && onOpenFolder(firstBrowsableFolder.id)}>
              <span>{t("share.viewAllItems", { count: totalItems })}</span>
              <LocalIcon name="arrow_down" size={15} />
            </button> : null}
        </div>}
    </Surface>;
}
function VisitorActionsMenu({
  allowDownload,
  allowPreview,
  item,
  onDownloadItem,
  onPreviewItem,
  palette
}: {
  allowDownload: boolean;
  allowPreview: boolean;
  item: DriveItem;
  onDownloadItem: (item: DriveItem) => void;
  onPreviewItem: (item: DriveItem) => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const actionItems: AppMenuItem[] = [{
    disabled: !allowPreview,
    icon: <LocalIcon name="visible" size={15} />,
    label: t("share.openPreview"),
    onClick: () => allowPreview && onPreviewItem(item),
    value: "preview"
  }, {
    disabled: !allowDownload,
    icon: <LocalIcon name="download" size={15} />,
    label: allowDownload ? t("actions.download") : t("share.downloadBlocked"),
    onClick: () => allowDownload && onDownloadItem(item),
    value: "download"
  }];
  return <ActionMenu ariaLabel={t("actions.more")} items={actionItems} palette={palette}>
      <button {...buttonTypeAttr} aria-label={t("actions.more")} className="icedr-tool-button icedr-file-menu-trigger icedr-has-hover icedr-has-active icedr-has-focus-visible" style={{
      "--tool-color": palette.subtle,
      "--tool-focus": palette.focusRing,
      "--tool-hover-bg": palette.surface2,
      "--tool-hover-border": palette.hairline,
      "--tool-hover-color": palette.ink,
      "--active-transform": "scale(0.96)",
      "--focus-visible-outline": "2px solid",
      "--focus-visible-outline-color": palette.focusRing,
      "--focus-visible-outline-offset": "2px"
    } as React.CSSProperties}>
        <LocalIcon name="menu7" size={16} />
      </button>
    </ActionMenu>;
}

function getPrimaryShareAccessItem(
  visibleItems: DriveItem[],
  sourceItems: DriveItem[],
  registeredShare: RegisteredShare,
) {
  const directFile = visibleItems.find((item) => getItemKind(item) !== "folder");
  if (directFile) return directFile;
  const visibleFolder = visibleItems.find((item) => getItemKind(item) === "folder");
  if (!visibleFolder) return null;
  return collectShareDescendants(visibleFolder, sourceItems).find((item) =>
    getItemKind(item) !== "folder" && registeredShare.allowedItemIds.includes(item.id)
  ) ?? null;
}

function SharePreviewDialog({
  accessSessionId,
  locale,
  onClose,
  open,
  palette,
  preview,
  shareToken,
}: {
  accessSessionId: string | null;
  locale: Locale;
  onClose: () => void;
  open: boolean;
  palette: Palette;
  preview: {
    item: DriveItem;
    intent: PreviewIntentResponse | null;
  } | null;
  shareToken: string;
}) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  const item = preview?.item ?? null;
  const intent = preview?.intent ?? null;
  const size = item ? formatFileSize(sumDriveItemSizes([item], [item]), locale) : "--";
  const statusLabel = intent ? t(`preview.apiStatus.${intent.status}`) : t("preview.notConfigured");
  const loadBlobUrl = useCallback((targetItem: DriveItem) => createSharedDriveItemBlobUrl(shareToken, targetItem, accessSessionId ?? undefined), [accessSessionId, shareToken]);
  return <Modal.Backdrop isOpen={open} onOpenChange={nextOpen => !nextOpen && onClose()} style={{
        background: "rgba(0, 0, 0, 0.48)"
      }}>
        <Modal.Container placement="center">
          <Modal.Dialog style={{
    background: "transparent",
          color: palette.ink,
          borderWidth: "1px",
          borderColor: palette.hairlineStrong,
          borderRadius: "8px",
          maxWidth: "980px",
          width: "min(980px, calc(100vw - 24px))",
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.48)"
        }}>
            <Modal.Header style={{
            borderBottomWidth: "1px",
            borderColor: palette.hairline,
            paddingInline: "16px",
            paddingBlock: "12px"
          }}>
              <div style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              width: "100%"
            }}>
                <div style={{
                alignItems: "center",
                display: "flex",
                gap: "12px",
                minWidth: "0px"
              }}>
                  {item ? <ItemIcon item={item} palette={palette} size={18} /> : <LocalIcon name="visible" size={18} color={palette.primaryHover} />}
                  <div style={{
                  minWidth: "0px"
                }}>
                    <Modal.Heading className="icedr-truncate" style={{
                      fontWeight: "600"
                    }}>
                        {item?.name ?? t("preview.title")}
                    </Modal.Heading>
                    <span className="icedr-truncate" style={{
                    color: palette.subtle,
                    fontSize: "12px",
                    marginTop: "4px"
                  }}>
                      {item ? `${formatDriveItemModified(item, locale, timeZone)} / ${size}` : statusLabel}
                    </span>
                  </div>
                </div>
                <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
                  <LocalIcon name="cross" size={17} />
                </ToolButton>
              </div>
            </Modal.Header>

            <Modal.Body className="icedr-r-padding" style={{
            "--r-padding-base": "16px",
            "--r-padding-md": "24px"
          } as React.CSSProperties}>
              <ReadOnlyFilePreview key={item?.id ?? "empty"} item={item} loadBlobUrl={loadBlobUrl} locale={locale} palette={palette} statusLabel={statusLabel} t={t} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>;
}
