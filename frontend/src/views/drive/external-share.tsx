"use client";

import { Modal } from "@heroui/react";
import { useRouter } from "@/compat/navigation";
import { useTimeZone, useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMotionStagger } from "@/components/ui/motion";
import { showAppToast } from "@/components/ui/app-toast-store";
import { ExternalSharePageLoading } from "@/components/common/ui/loading-state";
import { findDriveItem, formatDriveItemModified, formatFileSize, getItemKind, sumDriveItemSizes, palettes, type DriveItem, type Locale, type Palette, type ThemeMode } from "@/features/file/model";
import { createSharedDriveItemBlobUrl, createSharedPreviewIntent, downloadSharedDriveItem, fetchPreviewIntentStatus, type PreviewIntentResponse } from "@/features/file/actions";
import { isValidEmailAddress } from "@/features/auth/auth-input-validation";
import { canOpenFilePreview } from "@/features/file/open-with";
import { usePreviewLifecycle } from "@/features/file/use-preview-lifecycle";
import { formatShareEmailCooldownMessage, resolveShareEmailAccessError, type ShareEmailAccessAction, type ShareEmailAccessCooldown } from "@/features/share/email-access-errors";
import { createShareAccountAccessSession, fetchCurrentUser, getDriveApiErrorMessage, isAuthExpiredApiError, resolvePublicSiteName, sendShareEmailCode, verifyShareEmailCode, type AuthUser, type PublicSiteSettings, type ShareAccessSession } from "@/lib/drive-api";
import { ThemeActions } from "./drive-shell";
import { ItemIcon, LocalIcon, ToolButton } from "./drive-primitives";
import { collectShareDescendants, fetchRegisteredShare, getRegisteredShareParent, getShareItems, getVisibleRegisteredShareItems, type RegisteredShare, type RegisteredShareItem } from "@/features/share/registry";
import type { ExternalSharePolicy } from "@/features/share/policy";
import { AppImage } from "@/components/ui/app-image";
import { ReadOnlyFilePreview } from "@/components/ui/read-only-file-preview";
import { PreviewLifecycleBoundary } from "@/components/ui/preview-lifecycle-boundary";
import { ExternalShareHeroCard } from "./external-share-hero-card";
import { ExternalShareSidePanel } from "./external-share-side-panel";
import { ShareAuthDialog } from "./external-share-auth-dialog";
import { VisitorShareBrowser } from "./external-share-browser";
type ShareMode = "single-file" | "multi-file" | "folder";
type VisitorStage = "choose" | "email" | "code" | "verified" | "waiting" | "download";
type VisitorAccessAction = "download" | "preview";
type AuthMethod = "account" | "email";
type VisitorLevel = "anonymous" | "email" | "ica";
type ExternalShareFeedback = {
  message: string;
  tone: "error" | "info" | "success";
};
type EmailAccessStatus = {
  message: string;
  tone: "error" | "info" | "success";
};
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
function isShareContentLocked(share: RegisteredShare) {
  return getShareAccessRequired(share) && share.items === undefined;
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
  if (rootItems.length === 0 && !isShareContentLocked(record)) return null;
  return {
    title: record.title,
    mode: record.mode,
    owner: record.owner,
    rootItems,
    allowedIds: allowed,
    dynamicRootId: record.dynamicRootId
  };
}
function mapRegisteredShareItemToDriveItem(item: RegisteredShareItem, share: RegisteredShare): DriveItem {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    workspaceId: share.workspaceId,
    parentId: item.parentNodeId,
    owner: share.owner,
    modifiedAt: item.updatedAt ?? share.createdAt,
    mimeType: item.mimeType,
    hasContent: item.hasContent,
    sizeBytes: item.sizeBytes,
    shared: true,
    starred: false,
    archivedAt: item.availability === "archived" ? item.updatedAt ?? share.createdAt : null,
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
  const [sourceItems, setSourceItems] = useState<DriveItem[]>(() => initialShare?.token === token ? initialShare.items?.map(item => mapRegisteredShareItemToDriveItem(item, initialShare)) ?? [] : []);
  const previewLoading = resolvedShare.token !== token;
  const registeredShare = previewLoading ? null : resolvedShare.share;
  const collection = useMemo(() => registeredShare ? getCollectionFromRegisteredShare(registeredShare, sourceItems) : null, [registeredShare, sourceItems]);
  const totalSize = registeredShare?.contentSummary
    ? formatFileSize(registeredShare.contentSummary.totalSizeBytes, locale)
    : collection
      ? formatFileSize(sumDriveItemSizes(collection.rootItems, sourceItems), locale)
      : "--";
  const expiresLabel = registeredShare ? t("share.expiryValue", {
    count: registeredShare.expiresDays,
    unit: t("share.units.days")
  }) : t("share.unavailable");
  const refreshRegisteredShare = useCallback(async (accessSessionId: string) => {
    const share = await fetchRegisteredShare(token, accessSessionId);
    setSourceItems(share?.items?.map(item => mapRegisteredShareItemToDriveItem(item, share)) ?? []);
    setLoadError(share ? null : t("errors.shareUnavailable"));
    setResolvedShare({
      token,
      share: share ?? null,
    });
    return share;
  }, [t, token]);
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
          setSourceItems(share?.items?.map(item => mapRegisteredShareItemToDriveItem(item, share)) ?? []);
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
      {previewLoading ? <ExternalSharePageLoading label={t("app.loading")} palette={palette} /> : !registeredShare || !collection ? <ExternalShareErrorState message={loadError ?? t("errors.shareUnavailable")} palette={palette} /> : <ExternalSharePreview key={token} collection={collection} expiresLabel={expiresLabel} locale={locale} onRefreshShare={refreshRegisteredShare} registeredShare={registeredShare} palette={palette} setThemeMode={setThemeMode} siteSettings={siteSettings} sourceItems={sourceItems} themeMode={themeMode} totalSize={totalSize} />}
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
  onRefreshShare,
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
  onRefreshShare: (accessSessionId: string) => Promise<RegisteredShare | undefined>;
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
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("email");
  const [emailStatus, setEmailStatus] = useState<EmailAccessStatus | null>(null);
  const [emailCooldowns, setEmailCooldowns] = useState<Partial<Record<ShareEmailAccessAction, ShareEmailAccessCooldown>>>({});
  const [remaining, setRemaining] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [accessItem, setAccessItem] = useState<DriveItem | null>(null);
  const [accessAction, setAccessAction] = useState<VisitorAccessAction>("download");
  const [authOpen, setAuthOpen] = useState(false);
  const [feedback, setFeedback] = useState<ExternalShareFeedback | null>(null);
  const [accessSessionId, setAccessSessionId] = useState<string | null>(null);
  const [accessSession, setAccessSession] = useState<ShareAccessSession | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const refreshingAccessSessionId = useRef<string | null>(null);
  const [preview, setPreview] = useState<{
    item: DriveItem;
    intent: PreviewIntentResponse | null;
  } | null>(null);
  const visibleItems = getVisibleRegisteredShareItems(registeredShare, folderId, sourceItems);
  const currentFolder = folderId ? findDriveItem(folderId, sourceItems) : undefined;
  const shareContentCount = registeredShare.contentSummary
    ? registeredShare.contentSummary.fileCount + registeredShare.contentSummary.folderCount
    : Math.max(0, collection.allowedIds.size - 1);
  const experience = getSharePolicyExperience(registeredShare, visitorLevel, accessSession, t);
  const verified = stage === "verified" || stage === "waiting" || stage === "download";
  const sendCooldownSeconds = emailCooldowns.send?.remainingSeconds ?? 0;
  const verifyCooldownSeconds = emailCooldowns.verify?.remainingSeconds ?? 0;
  const activeEmailCooldown = stage === "code"
    ? emailCooldowns.verify ?? emailCooldowns.send
    : emailCooldowns.send;
  const visibleEmailStatus: EmailAccessStatus | null = activeEmailCooldown
    ? {
        message: formatShareEmailCooldownMessage(activeEmailCooldown, t),
        tone: "error",
      }
    : emailStatus;
  const accessSessionRequired = getShareAccessRequired(registeredShare);
  const contentLocked = isShareContentLocked(registeredShare);
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
  const hasEmailCooldown = Boolean(emailCooldowns.send || emailCooldowns.verify);
  useEffect(() => {
    if (!hasEmailCooldown) return;
    const timer = window.setInterval(() => {
      setEmailCooldowns((current) => {
        const next: Partial<Record<ShareEmailAccessAction, ShareEmailAccessCooldown>> = {};
        for (const action of ["send", "verify"] as const) {
          const cooldown = current[action];
          if (!cooldown || cooldown.remainingSeconds <= 1) continue;
          next[action] = {
            ...cooldown,
            remainingSeconds: cooldown.remainingSeconds - 1,
          };
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasEmailCooldown]);
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
  const refreshShareContent = useCallback(async () => {
    if (!accessSessionId || remaining > 0 || refreshingAccessSessionId.current === accessSessionId) return;
    refreshingAccessSessionId.current = accessSessionId;
    try {
      const refreshedShare = await onRefreshShare(accessSessionId);
      if (!refreshedShare || isShareContentLocked(refreshedShare)) {
        refreshingAccessSessionId.current = null;
        setFeedback({ message: t("share.unavailable"), tone: "error" });
      }
    } catch (error) {
      refreshingAccessSessionId.current = null;
      setFeedback({
        message: getDriveApiErrorMessage(error, t, { fallbackKey: "share.unavailable", scope: "share" }),
        tone: "error",
      });
    }
  }, [accessSessionId, onRefreshShare, remaining, t]);
  useEffect(() => {
    if (!contentLocked || !accessSessionId || remaining > 0) return;
    const timer = window.setTimeout(() => {
      void refreshShareContent();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [accessSessionId, contentLocked, refreshShareContent, remaining]);
  const sendCode = () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmailAddress(normalizedEmail) || sendCooldownSeconds > 0) return;
    setAuthBusy(true);
    setEmail(normalizedEmail);
    setCode("");
    setEmailStatus(null);
    void sendShareEmailCode(registeredShare.token, normalizedEmail).then(() => {
      setStage("code");
      setEmailStatus({ message: t("share.codeSent"), tone: "success" });
    }).catch((error) => {
      const result = resolveShareEmailAccessError(error, "send", t);
      if (result.cooldown) {
        setEmailCooldowns((current) => ({ ...current, send: result.cooldown }));
        setEmailStatus(null);
      } else {
        setEmailStatus({ message: result.message, tone: result.tone });
      }
    }).finally(() => setAuthBusy(false));
  };
  const verifyCode = () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmailAddress(normalizedEmail) || code.length !== 6 || verifyCooldownSeconds > 0) return;
    setAuthBusy(true);
    setEmailStatus(null);
    void verifyShareEmailCode(registeredShare.token, normalizedEmail, code).then(session => {
      setAccessSessionId(session.sessionId);
      setAccessSession(session);
      setVisitorLevel("email");
      setEmailCooldowns({});
      setRemaining(session.waitSeconds);
      setStage("verified");
    }).catch((error) => {
      const result = resolveShareEmailAccessError(error, "verify", t);
      if (result.cooldown) {
        setEmailCooldowns((current) => ({ ...current, verify: result.cooldown }));
        setEmailStatus(null);
      } else {
        setEmailStatus({ message: result.message, tone: result.tone });
      }
    }).finally(() => setAuthBusy(false));
  };
  const changeEmail = () => {
    setCode("");
    setEmailStatus(null);
    setStage("email");
  };
  const updateEmail = (value: string) => {
    setEmail(value);
    setCode("");
    setEmailStatus(null);
  };
  const goUp = () => setFolderId(getRegisteredShareParent(registeredShare, folderId, sourceItems));
  const redirectToLogin = () => {
    router.push(`/login?next=${encodeURIComponent(`/share/s/${registeredShare.token}`)}`);
  };
  const requestVisitorAction = (item: DriveItem | null, action: VisitorAccessAction) => {
    if (item && action === "download" && !registeredShare.allowDownload) {
      setFeedback({ message: t("share.downloadBlocked"), tone: "error" });
      return;
    }
    if (item && action === "preview" && !registeredShare.allowPreview) {
      showAppToast({
        dedupeKey: `share-preview-blocked-${registeredShare.token}-${item.id}`,
        title: t("preview.noArtifact"),
        tone: "info",
      });
      return;
    }
    if (item && action === "preview" && !canOpenFilePreview(item)) {
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
    setAuthOpen(true);
    setCode("");
    setEmailStatus(null);
    if (!accessSessionId) setAccessSession(null);
    setRemaining(experience.waitSeconds);
    const nextAuthMethod: AuthMethod = currentUser ? "account" : "email";
    setAuthMethod(nextAuthMethod);
    setStage(nextAuthMethod === "account" ? "choose" : "email");
  };
  const authenticateAccount = () => {
    if (!currentUser) {
      redirectToLogin();
      return;
    }
    setAuthBusy(true);
    void createShareAccountAccessSession(registeredShare.token).then(session => {
      setAccessSessionId(session.sessionId);
      setAccessSession(session);
      setVisitorLevel("ica");
      setEmail(currentUser.email);
      setEmailStatus(null);
      setEmailCooldowns({});
      setRemaining(session.waitSeconds);
      setStage(session.waitSeconds > 0 ? "verified" : "download");
    }).catch((error) => {
      if (isAuthExpiredApiError(error)) {
        redirectToLogin();
        return;
      }
      setFeedback({
        message: getDriveApiErrorMessage(error, t, { fallbackKey: "share.icaUnavailable", scope: "share" }),
        tone: "error",
      });
    }).finally(() => setAuthBusy(false));
  };
  const selectAuthMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    setCode("");
    setEmailStatus(null);
    setAccessSessionId(null);
    setAccessSession(null);
    setVisitorLevel("anonymous");
    setRemaining(0);
    setStage(method === "email" ? "email" : "choose");
  };
  const continueToDownload = () => {
    const currentWait = remaining;
    setRemaining(currentWait);
    setStage(currentWait > 0 ? "waiting" : "download");
  };
  const completeVisitorAction = () => {
    if (!accessItem) {
      setAuthOpen(false);
      void refreshShareContent();
      return;
    }
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
      setFeedback({ message: t("app.downloaded"), tone: "success" });
    }) : createSharedPreviewIntent(registeredShare.token, accessItem.id, accessSessionId ?? undefined).then(intent => {
      setPreview({
        item: accessItem,
        intent
      });
    });
    void actionPromise.then(() => setAuthOpen(false)).catch((error) => {
      setFeedback({
        message: getDriveApiErrorMessage(error, t, {
          fallbackKey: accessAction === "download" ? "share.downloadFailed" : "preview.notConfigured",
          scope: "share",
        }),
        tone: "error",
      });
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
          onStartAccess={primaryAccessItem && primaryAccessAction
            ? () => requestVisitorAction(primaryAccessItem, primaryAccessAction)
            : contentLocked
              ? () => requestVisitorAction(null, primaryAccessAction ?? "preview")
              : undefined}
          registeredShare={registeredShare}
          selectedEmail={email || currentUser?.email || ""}
          totalItems={shareContentCount}
          totalSize={totalSize}
          verified={verified}
        />
      </div>

      <ShareAuthDialog action={accessAction} accessExperience={experience} accessItem={accessItem} authMethod={authMethod} code={code} email={email} emailStatus={visibleEmailStatus} locale={locale} accountConfigured={Boolean(currentUser)} busy={authBusy} onAccountAuth={authenticateAccount} onChangeEmail={changeEmail} onCodeChange={(value) => { setCode(value); setEmailStatus(null); }} onClose={() => setAuthOpen(false)} onEmailChange={updateEmail} onMethodChange={selectAuthMethod} onResendCode={sendCode} onSendCode={sendCode} onVerifyCode={verifyCode} onContinue={continueToDownload} onComplete={completeVisitorAction} open={authOpen} palette={palette} remaining={remaining} sendCooldownSeconds={sendCooldownSeconds} sourceItems={sourceItems} stage={stage} verifyCooldownSeconds={verifyCooldownSeconds} />
      <SharePreviewDialog accessSessionId={accessSessionId} onClose={() => setPreview(null)} open={Boolean(preview)} palette={palette} preview={preview} locale={locale} shareToken={registeredShare.token} />
      {feedback ? <div aria-live={feedback.tone === "error" ? "assertive" : "polite"} className="icedr-r-right external-share-feedback" data-tone={feedback.tone} role={feedback.tone === "error" ? "alert" : "status"} style={{
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
            {feedback.message}
          </span>
        </div> : null}
    </div>;
}
function getPrimaryShareAccessItem(
  visibleItems: DriveItem[],
  sourceItems: DriveItem[],
  registeredShare: RegisteredShare,
) {
  const availableIds = new Set(
    (registeredShare.items ?? [])
      .filter((item) => item.availability === "available")
      .map((item) => item.id),
  );
  const directFile = visibleItems.find(
    (item) => getItemKind(item) !== "folder" && availableIds.has(item.id),
  );
  if (directFile) return directFile;
  const visibleFolder = visibleItems.find((item) => getItemKind(item) === "folder");
  if (!visibleFolder) return null;
  return collectShareDescendants(visibleFolder, sourceItems).find((item) =>
    getItemKind(item) !== "folder" && availableIds.has(item.id)
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
  const initialIntent = preview?.intent ?? null;
  const size = item ? formatFileSize(sumDriveItemSizes([item], [item]), locale) : "--";
  const previewIdentity = open && item ? `${shareToken}:${item.id}` : null;
  const createPreviewLifecycleIntent = useCallback((signal: AbortSignal) => {
    if (!item) return Promise.reject(new Error("Preview item is unavailable"));
    return createSharedPreviewIntent(
      shareToken,
      item.id,
      accessSessionId ?? undefined,
      { signal },
    );
  }, [accessSessionId, item, shareToken]);
  const pollPreviewLifecycleIntent = useCallback(
    (intent: PreviewIntentResponse, signal: AbortSignal) => fetchPreviewIntentStatus(intent, {
      accessSessionId: accessSessionId ?? undefined,
      signal,
    }),
    [accessSessionId],
  );
  const previewLifecycle = usePreviewLifecycle({
    createIntent: createPreviewLifecycleIntent,
    enabled: Boolean(previewIdentity),
    identity: previewIdentity,
    initialIntent,
    pollIntent: pollPreviewLifecycleIntent,
  });
  const statusLabel = previewLifecycle.intent
    ? t("preview.lifecycleStatus.completed")
    : t("preview.notConfigured");
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
              <PreviewLifecycleBoundary
                error={previewLifecycle.error}
                intent={previewLifecycle.intent}
                loading={previewLifecycle.loading}
                onRetry={previewLifecycle.retry}
                palette={palette}
              >
                <ReadOnlyFilePreview key={item?.id ?? "empty"} item={item} loadBlobUrl={loadBlobUrl} locale={locale} palette={palette} statusLabel={statusLabel} t={t} />
              </PreviewLifecycleBoundary>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>;
}
