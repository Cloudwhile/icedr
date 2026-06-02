"use client";

import { Input, Modal, TextArea } from "@heroui/react";
import { useRouter, useSearchParams } from "@/compat/navigation";
import { useLocale, useTimeZone, useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { MotionPresence, useMotionReveal, useMotionStagger } from "@/components/ui/motion";
import { showAppToast, type AppToastTone } from "@/components/ui/app-toast";
import { SegmentedToolGroup } from "@/components/ui/segmented-tool-group";
import { ExternalSharePageLoading, LoadingSpinner, ShareCreationLoading } from "@/components/common/ui/loading-state";
import { findDriveItem, formatDriveItemModified, formatFileSize, getChildItems, getItemKind, sumDriveItemSizes, palettes, type DriveItem, type Locale, type LocalIconName, type Palette, type ThemeMode } from "@/features/file/model";
import { copyTextToClipboard, createSharedDriveItemBlobUrl, createSharedPreviewIntent, createShareUrl, downloadSharedDriveItem, type PreviewIntentResponse } from "@/features/file/actions";
import { fetchAuthSettings, createPasskeyRegistrationOptions, deletePasskey, DriveApiError, getApiBaseUrl, fetchPasskeys, fetchSiteSettings, fetchTranslationSettings, fetchWorkspaces, fetchIdentityConfig, fetchMailSettings, fetchStorageSettings, fetchWorkspaceShareSettings, sendShareEmailCode, startShareOAuth, testMailSettings, testStorageSettings, updateAuthSettings, updateMailSettings, updateOAuthSettings, updatePasskeySettings, updateSiteSettings, updateStorageSettings, updateWorkspaceShareSettings, upsertTranslationBundle, verifyPasskeyRegistration, verifyShareEmailCode, type AuthSettings, type MailSettings, type MailSettingsInput, type OAuthSettings, type PasskeyRecord, type PasskeySettings, type PublicSiteSettings, type ShareAccessSession, type StorageSettings, type StorageSettingsInput, type TranslationBundle, type WorkspaceShareSettings } from "@/lib/drive-api";
import { AuthField, AuthInput, AuthPrimaryButton, AuthStatusNotice } from "./auth-form-primitives";
import { ThemeActions } from "./drive-shell";
import { AnimatedCheckMark, ItemIcon, LocalIcon, StatusPill, Surface, ToolButton } from "./drive-primitives";
import { AppMenu as ActionMenu, type AppMenuItem } from "@/components/ui/app-menu";
import { collectShareDescendants, createRegisteredShare, fetchRegisteredShare, getRegisteredShareParent, getShareItems, getVisibleRegisteredShareItems, type RegisteredShare, type RegisteredShareItem, type RegisteredSharePolicy } from "@/features/share/registry";
import { AppImage } from "@/components/ui/app-image";
import { ReadOnlyFilePreview } from "@/components/ui/read-only-file-preview";
const buttonTypeAttr: {
  type?: "button";
} = {
  type: "button"
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const icetowneBlogOAuthPreset = {
  providerProfile: "icetowne-blog",
  issuerUrl: "https://blog.icetowne.com",
  clientId: "client_uNl7QJ689LDXlBWXhCS4",
  audience: "",
  scopes: "basic vip_info"
} satisfies Pick<OAuthSettings, "providerProfile" | "issuerUrl" | "clientId" | "audience" | "scopes">;
function getCurrentSystemBaseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}
function buildLoginCallbackUrl(systemBaseUrl: string) {
  const base = systemBaseUrl.trim().replace(/\/$/, "");
  return base ? `${base}/callback` : "";
}
function getCallbackBaseUrl(redirectUri: string, fallbackBaseUrl: string) {
  const trimmed = redirectUri.trim();
  if (!trimmed) return fallbackBaseUrl;
  return trimmed.replace(/\/callback\/?$/, "");
}
function getAdminSaveFailedMessage(error: unknown, t: ReturnType<typeof useTranslations>) {
  if (error instanceof DriveApiError) {
    if (error.message.includes("OAuth must be configured")) {
      return t("admin.oauthConfigRequired");
    }
    if (error.message.includes("Passkey must be configured")) {
      return t("admin.passkeyConfigRequired");
    }
    if (error.message.includes("OAuth issuer URL and client ID")) {
      return t("admin.oauthConfigRequired");
    }
    if (error.message.includes("OAuth client secret is required")) {
      return t("admin.oauthSecretRequired");
    }
    if (error.message && error.message !== "Drive API request failed") {
      return t("admin.saveFailedWithReason", {
        reason: error.message
      });
    }
  }
  return t("admin.saveFailed");
}
type ShareMode = "single-file" | "multi-file" | "folder";
type VisitorStage = "choose" | "email" | "code" | "verified" | "waiting" | "download";
type VisitorAccessAction = "download" | "preview";
type AuthMethod = "account" | "email";
type VisitorLevel = "anonymous" | "email" | "ica";
type AnonymousAccessPolicy = "blocked" | "email-required" | "public";
export type ExternalSharePolicy = RegisteredSharePolicy;
type IdentityExperience = {
  label: string;
  waitSeconds: number;
  speedLabel: string;
  sessionLabel: string;
};
type AccessPolicyExperience = IdentityExperience;
export const defaultExternalSharePolicy: ExternalSharePolicy = {
  waitValue: 0,
  waitUnit: "seconds",
  speedValue: 512,
  speedUnit: "KB/s",
  expiresValue: 7,
  expiresUnit: "days",
  downloadLimit: "",
  allowedDomain: ""
};
export function policyFromWorkspaceSettings(settings?: WorkspaceShareSettings | null): ExternalSharePolicy {
  return {
    waitValue: settings?.anonymousAccess === "public" ? 0 : 15,
    waitUnit: "seconds",
    speedValue: 512,
    speedUnit: "KB/s",
    expiresValue: settings?.defaultExpiresDays ?? defaultExternalSharePolicy.expiresValue,
    expiresUnit: "days",
    downloadLimit: "",
    allowedDomain: settings?.emailRule === "domains" ? settings.allowedDomains[0] ?? "" : ""
  };
}
function formatSpeedLimit(speedLimit: {
  value: number;
  unit: "KB/s" | "MB/s";
} | null) {
  return speedLimit ? `${speedLimit.value} ${speedLimit.unit}` : "Unlimited";
}
function formatPolicyWaitSeconds(policy: RegisteredSharePolicy) {
  return policy.waitUnit === "minutes" ? policy.waitValue * 60 : policy.waitValue;
}
function getVisitorLabel(level: VisitorLevel) {
  if (level === "ica") return "ICA User";
  if (level === "email") return "Email verified visitor";
  return "Anonymous visitor";
}
function getSharePolicyExperience(share: RegisteredShare, level: VisitorLevel, accessSession: ShareAccessSession | null): AccessPolicyExperience {
  const waitSeconds = accessSession ? accessSession.waitSeconds : level === "ica" ? 0 : formatPolicyWaitSeconds(share.policy);
  return {
    label: getVisitorLabel(level),
    waitSeconds,
    speedLabel: accessSession ? formatSpeedLimit(accessSession.speedLimit) : formatSpeedLimit(share.policy.speedValue > 0 ? {
      value: share.policy.speedValue,
      unit: share.policy.speedUnit
    } : null),
    sessionLabel: accessSession?.downloadLimit || share.policy.downloadLimit || "No download limit"
  };
}
type ShareCollection = {
  title: string;
  mode: ShareMode;
  owner: string;
  rootItems: DriveItem[];
  allowedIds: Set<string>;
  dynamicRootId: string | null;
};
function buildShareCollection({
  selectedItems,
  currentFolder,
  currentDirectoryItems,
  rootTitle,
  sourceItems
}: {
  selectedItems: DriveItem[];
  currentFolder?: DriveItem;
  currentDirectoryItems: DriveItem[];
  rootTitle: string;
  sourceItems: DriveItem[];
}): ShareCollection {
  if (selectedItems.length === 1 && getItemKind(selectedItems[0]) !== "folder") {
    return {
      title: selectedItems[0].name,
      mode: "single-file",
      owner: selectedItems[0].owner,
      rootItems: selectedItems,
      allowedIds: new Set(selectedItems.map(item => item.id)),
      dynamicRootId: null
    };
  }
  if (selectedItems.length === 1 && getItemKind(selectedItems[0]) === "folder") {
    const folder = selectedItems[0];
    const descendants = collectShareDescendants(folder, sourceItems);
    return {
      title: folder.name,
      mode: "folder",
      owner: folder.owner,
      rootItems: getChildItems(folder.id, sourceItems),
      allowedIds: new Set(descendants.map(item => item.id)),
      dynamicRootId: folder.id
    };
  }
  if (selectedItems.length > 1) {
    const selectedAndDescendants = selectedItems.flatMap(item => [item, ...collectShareDescendants(item, sourceItems)]);
    const parentId = selectedItems.every(item => item.parentId === selectedItems[0].parentId) ? selectedItems[0].parentId : null;
    const parent = parentId ? findDriveItem(parentId, sourceItems) : undefined;
    return {
      title: parent?.name ?? rootTitle,
      mode: "multi-file",
      owner: selectedItems.every(item => item.owner === selectedItems[0].owner) ? selectedItems[0].owner : "",
      rootItems: selectedItems,
      allowedIds: new Set(selectedAndDescendants.map(item => item.id)),
      dynamicRootId: null
    };
  }
  const rootItems = currentDirectoryItems;
  const descendants = currentFolder ? collectShareDescendants(currentFolder, sourceItems) : sourceItems;
  return {
    title: currentFolder?.name ?? rootTitle,
    mode: "folder",
    owner: currentFolder?.owner ?? rootItems.find(item => item.owner)?.owner ?? "",
    rootItems,
    allowedIds: new Set(descendants.map(item => item.id)),
    dynamicRootId: currentFolder?.id ?? null
  };
}
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
    workspaceId: item.workspaceId,
    parentId: item.parentNodeId,
    owner: item.owner,
    modifiedAt: item.updatedAt,
    mimeType: item.mimeType,
    objectKey: null,
    sizeBytes: item.sizeBytes,
    shared: true,
    starred: item.starred,
    archivedAt: item.archivedAt,
    colorKey: item.kind === "sheet" ? "success" : item.kind === "image" ? "secure" : item.kind === "archive" ? "tertiary" : "primary"
  };
}
function resolveCreatedShareUrl(token: string, apiUrl?: string) {
  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      if (url.pathname.includes("/share/s/")) return apiUrl;
    } catch {
      return createShareUrl(token);
    }
  }
  return createShareUrl(token);
}
export function ExternalShareDialog({
  currentDirectoryItems,
  currentFolder,
  onClose,
  open,
  palette,
  policyLoadError,
  onShareCreated,
  rootTitle,
  selectedItems,
  sourceItems,
  themeMode,
  workspaceSettings,
  workspaceId
}: {
  currentDirectoryItems: DriveItem[];
  currentFolder?: DriveItem;
  onClose: () => void;
  open: boolean;
  palette: Palette;
  policyLoadError?: string | null;
  onShareCreated?: (share: RegisteredShare) => void;
  rootTitle: string;
  selectedItems: DriveItem[];
  sourceItems: DriveItem[];
  themeMode: ThemeMode;
  workspaceId?: string;
  workspaceSettings?: WorkspaceShareSettings | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [created, setCreated] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowPreview, setAllowPreview] = useState(true);
  const [expiryDays, setExpiryDays] = useState("7");
  const [remark, setRemark] = useState("");
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
  const policy = useMemo(() => policyFromWorkspaceSettings(workspaceSettings), [workspaceSettings]);
  const maxExpiresDays = workspaceSettings?.maxExpiresDays ?? 30;
  const collection = useMemo(() => buildShareCollection({
    selectedItems,
    currentFolder,
    currentDirectoryItems,
    rootTitle,
    sourceItems
  }), [currentDirectoryItems, currentFolder, rootTitle, selectedItems, sourceItems]);
  const shareItems = useMemo(() => Array.from(collection.allowedIds).map(id => findDriveItem(id, sourceItems)).filter((item): item is DriveItem => Boolean(item)), [collection, sourceItems]);
  const totalSize = formatFileSize(sumDriveItemSizes(collection.rootItems, sourceItems), locale);
  const shareUrl = createdShareUrl ?? (createdToken ? createShareUrl(createdToken) : "");
  const routeShareUrl = createdToken ? `/share/s/${encodeURIComponent(createdToken)}` : "";
  const expiresLabel = t("share.expiryValue", {
    count: policy.expiresValue,
    unit: t(`share.units.${policy.expiresUnit}`)
  });
  useEffect(() => {
    if (!createFeedback) return;
    const timer = window.setTimeout(() => setCreateFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [createFeedback]);
  useEffect(() => {
    if (created) return;
    window.queueMicrotask(() => setExpiryDays(String(policy.expiresValue)));
  }, [created, policy.expiresValue]);
  const closeShareDialog = () => {
    setCreated(false);
    setCreating(false);
    setCreateFeedback(null);
    setCreatedToken(null);
    setCreatedShareUrl(null);
    onClose();
  };
  const createShare = () => {
    if (creating) return;
    setCreating(true);
    setCreateFeedback(null);
    const expires = Math.min(Math.max(Number(expiryDays) || policy.expiresValue, 1), maxExpiresDays);
    const record: RegisteredShare = {
      token: "",
      workspaceId,
      title: collection.title,
      mode: collection.mode,
      owner: collection.owner,
      rootItemIds: collection.rootItems.map(item => item.id),
      allowedItemIds: Array.from(collection.allowedIds),
      dynamicRootId: collection.dynamicRootId,
      allowDownload,
      allowPreview,
      expiresDays: expires,
      remark: remark.trim(),
      policy,
      createdAt: new Date().toISOString()
    };
    void createRegisteredShare(record).then(createdShare => {
      onShareCreated?.(createdShare);
      setCreatedToken(createdShare.token);
      setCreatedShareUrl(resolveCreatedShareUrl(createdShare.token, createdShare.url));
      setCreated(true);
    }).catch(() => {
      setCreateFeedback(t("share.createFailed"));
    }).finally(() => setCreating(false));
  };
  return <Fragment>
      <MotionPresence show={open} preset="overlay" style={{
      position: "fixed",
      inset: "0px",
      zIndex: "50"
    }}>
        <div onClick={closeShareDialog} style={{
        position: "absolute",
        inset: "0px",
        background: themeMode === "dark" ? "rgba(0, 0, 0, 0.34)" : "rgba(17, 18, 23, 0.18)"
      }} />
        <ExternalSharePanel palette={palette} themeMode={themeMode}>
          <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "56px",
          paddingInline: "16px",
          borderBottomWidth: "1px",
          borderColor: palette.hairline
      }}>
            <div style={{
        alignItems: "center",
        display: "flex",
        gap: "12px",
        minWidth: "0px",
        flex: "1 1 auto"
      }}>
              <LocalIcon name="link" size={18} color={palette.primaryHover} />
              <div style={{
              minWidth: "0px"
            }}>
                <span className="icedr-truncate" style={{
                color: palette.ink,
                fontWeight: "600"
              }}>
                  {created ? t("share.createdTitle") : t("share.createTitle")}
                </span>
                <span className="icedr-truncate" style={{
                color: palette.subtle,
                fontSize: "12px"
              }}>
                  {created ? shareUrl : t("share.policyApplied")}
                </span>
              </div>
            </div>
            <ToolButton label={t("app.close")} palette={palette} onClick={closeShareDialog}>
              <LocalIcon name="cross" size={17} />
            </ToolButton>
          </div>

          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "0px",
          flex: "1 1 auto",
          minHeight: "0px",
          overflowY: "auto"
        }}>
            <MotionPresence show={created} preset="surface">
              {createdToken ? <ShareCreatedPanel openSharePreview={() => router.push(routeShareUrl)} palette={palette} shareUrl={shareUrl} /> : null}
            </MotionPresence>
            <MotionPresence show={!created && creating} preset="surface">
              <ShareCreationLoading label={t("share.creating")} palette={palette} />
            </MotionPresence>
            <MotionPresence show={!created && !creating} preset="surface">
              <>
                <ShareSetup collection={collection} expiresLabel={expiresLabel} palette={palette} shareItems={shareItems.length} totalSize={totalSize} />
                {policyLoadError ? <div style={{
                paddingInline: "16px",
                paddingBlock: "12px",
                borderBottomWidth: "1px",
                borderColor: palette.hairline
              }}>
                    <StatusPill palette={palette} tone="risk">
                      {policyLoadError}
                    </StatusPill>
                  </div> : null}
                <ShareCreateOptions allowDownload={allowDownload} allowPreview={allowPreview} expiryDays={expiryDays} maxDays={maxExpiresDays} palette={palette} remark={remark} setAllowDownload={setAllowDownload} setAllowPreview={setAllowPreview} setExpiryDays={setExpiryDays} setRemark={setRemark} />
                <ShareCollectionPanel collection={collection} openSharePreview={() => {
                if (createdToken) router.push(routeShareUrl);else createShare();
              }} palette={palette} sourceItems={sourceItems} />
                {createFeedback ? <div style={{
                paddingInline: "16px",
                paddingBlock: "12px",
                borderBottomWidth: "1px",
                borderColor: palette.hairline
              }}>
                    <StatusPill palette={palette} tone="risk">
                      {createFeedback}
                    </StatusPill>
                  </div> : null}
              </>
            </MotionPresence>
          </div>

          {!created ? <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "8px",
          paddingInline: "16px",
          paddingBlock: "12px",
          borderTopWidth: "1px",
          borderColor: palette.hairline
        }}>
              <ToolButton label={t("share.cancel")} palette={palette} disabled={creating} onClick={() => {
            if (!creating) closeShareDialog();
          }}>
                <LocalIcon name="cross" size={17} />
              </ToolButton>
              <ToolButton label={creating ? t("share.creating") : t("share.createLink")} palette={palette} onClick={createShare} disabled={creating}>
                {creating ? <LoadingSpinner palette={palette} size={14} /> : null}
                {!creating ? <LocalIcon name="link" size={17} /> : null}
              </ToolButton>
            </div> : null}
        </ExternalSharePanel>
      </MotionPresence>
    </Fragment>;
}
function ExternalSharePanel({
  children,
  palette,
  themeMode
}: {
  children: React.ReactNode;
  palette: Palette;
  themeMode: ThemeMode;
}) {
  const panelRef = useMotionReveal<HTMLDivElement>("panel-right", []);
  return <div ref={panelRef} className="icedr-r-width icedr-r-border-left-width" style={{
    position: "absolute",
    top: "0px",
    right: "0px",
    bottom: "0px",
    "--r-width-base": "100%",
    "--r-width-md": "560px",
    maxWidth: "100vw",
    background: palette.canvas,
    color: palette.ink,
    "--r-border-left-width-base": "0px",
    "--r-border-left-width-md": "1px",
    borderColor: palette.hairlineStrong,
    boxShadow: themeMode === "dark" ? "-18px 0 52px rgba(0, 0, 0, 0.48)" : "-18px 0 52px rgba(17, 18, 23, 0.14)",
    display: "flex",
    flexDirection: "column"
  } as React.CSSProperties}>
      {children}
    </div>;
}
export function ExternalShareStandalone({
  initialShare,
  locale,
  setThemeMode,
  themeMode,
  token
}: {
  initialShare?: RegisteredShare;
  locale: Locale;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
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
          setResolvedShare({
            token,
            share: share ?? null
          });
        }
      } catch {
        if (!cancelled) {
          setSourceItems([]);
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
  }, [initialShare?.token, resolvedShare.token, token]);
  return <div style={{
    minHeight: "100vh",
    background: palette.canvas,
    color: palette.ink,
    fontSize: "14px",
    letterSpacing: "0px"
  }}>
      {previewLoading || !registeredShare || !collection ? <ExternalSharePageLoading label={t("app.loading")} palette={palette} /> : <ExternalSharePreview key={token} collection={collection} expiresLabel={expiresLabel} locale={locale} registeredShare={registeredShare} palette={palette} setThemeMode={setThemeMode} sourceItems={sourceItems} themeMode={themeMode} totalSize={totalSize} />}
    </div>;
}
export function ExternalShareAdminSettingsPage({
  setThemeMode,
  themeMode
}: {
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const palette = palettes[themeMode];
  return <div style={{
    height: "100dvh",
    minHeight: "100dvh",
    overflow: "hidden",
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
          <LocalIcon name="shield" size={18} color={palette.secure} />
          <div style={{
          minWidth: "0px"
        }}>
            <span className="icedr-truncate" style={{
            color: palette.ink,
            fontWeight: "600"
          }}>
              {t("admin.title")}
            </span>
            <span className="icedr-truncate" style={{
            color: palette.subtle,
            fontSize: "12px"
          }}>
              {t("admin.subtitle")}
            </span>
          </div>
        </div>
        <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
      </div>

      <div style={{
      WebkitOverflowScrolling: "touch",
      height: "calc(100dvh - 56px)",
      minHeight: "0px",
      overflowY: "auto",
      overscrollBehaviorY: "contain",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      paddingBlock: "20px"
    } as React.CSSProperties} className="icedr-r-padding-inline">
        <div style={{
        maxWidth: "920px"
      }}>
          <ExternalShareAdminSettingsPanel palette={palette} />
        </div>
      </div>
    </div>;
}
type WorkspaceShareForm = Omit<WorkspaceShareSettings, "workspaceId" | "updatedAt">;
type UndoActions = Record<string, () => void>;
const defaultMailSettings: MailSettings = {
  enabled: true,
  host: "",
  port: 587,
  secure: false,
  username: "",
  fromName: "ICEDR",
  fromEmail: "",
  replyTo: "",
  configured: false,
  passwordConfigured: false,
  verifiedAt: null
};
function workspaceSettingsToForm(settings: WorkspaceShareSettings): WorkspaceShareForm {
  return {
    anonymousAccess: settings.anonymousAccess,
    emailRule: settings.emailRule,
    allowedDomains: settings.allowedDomains,
    defaultExpiresDays: settings.defaultExpiresDays,
    maxExpiresDays: settings.maxExpiresDays,
    allowPermanent: settings.allowPermanent,
    audit: settings.audit
  };
}
function settingChanged<T>(left: T, right: T) {
  return JSON.stringify(left) !== JSON.stringify(right);
}
export function ExternalShareAdminSettingsPanel({
  palette
}: {
  palette: Palette;
}) {
  const t = useTranslations();
  const [anonymousPolicy, setAnonymousPolicy] = useState<AnonymousAccessPolicy>("email-required");
  const [emailRule, setEmailRule] = useState<"any" | "domains">("any");
  const [allowPermanent, setAllowPermanent] = useState(false);
  const [audit, setAudit] = useState({
    ip: true,
    userAgent: true,
    downloads: true,
    anomaly: true,
    alerts: true
  });
  const [defaultExpiresDays, setDefaultExpiresDays] = useState("7");
  const [maxExpiresDays, setMaxExpiresDays] = useState("30");
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);
  const [mailConfigOpen, setMailConfigOpen] = useState(false);
  const [oauthConfigOpen, setOauthConfigOpen] = useState(false);
  const [passkeyConfigOpen, setPasskeyConfigOpen] = useState(false);
  const [storageDraft, setStorageDraft] = useState<boolean | null>(null);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [storageSettings, setStorageSettings] = useState<StorageSettings | null>(null);
  const [storageSecret, setStorageSecret] = useState("");
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettings>({
    siteName: "ICEDR",
    authLogoDataUrl: null
  });
  const [translationBundles, setTranslationBundles] = useState<TranslationBundle[]>([]);
  const [oauthSettings, setOauthSettings] = useState<OAuthSettings | null>(null);
  const [oauthSecret, setOauthSecret] = useState("");
  const [mailSettings, setMailSettings] = useState<MailSettings>(defaultMailSettings);
  const [mailPassword, setMailPassword] = useState("");
  const [mailTestEmail, setMailTestEmail] = useState("");
  const [passkeySettings, setPasskeySettings] = useState<PasskeySettings | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [passkeyName, setPasskeyName] = useState("ICEDR Passkey");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [undoActions, setUndoActions] = useState<UndoActions>({});
  const [savedWorkspaceSnapshot, setSavedWorkspaceSnapshot] = useState<WorkspaceShareForm | null>(null);
  const [savedStorageSnapshot, setSavedStorageSnapshot] = useState<StorageSettings | null>(null);
  const [savedOauthSnapshot, setSavedOauthSnapshot] = useState<OAuthSettings | null>(null);
  const [savedMailSnapshot, setSavedMailSnapshot] = useState<MailSettings | null>(null);
  const [savedPasskeySnapshot, setSavedPasskeySnapshot] = useState<PasskeySettings | null>(null);
  const savedWorkspaceRef = useRef<WorkspaceShareForm | null>(null);
  const savedAuthRef = useRef<AuthSettings | null>(null);
  const savedStorageRef = useRef<StorageSettings | null>(null);
  const savedSiteRef = useRef<PublicSiteSettings | null>(null);
  const savedOauthRef = useRef<OAuthSettings | null>(null);
  const savedMailRef = useRef<MailSettings | null>(null);
  const savedPasskeyRef = useRef<PasskeySettings | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const translationInputRef = useRef<HTMLInputElement | null>(null);
  const currentSystemBaseUrl = useMemo(() => getCurrentSystemBaseUrl(), []);
  const oauthShareRedirectUri = useMemo(() => `${getApiBaseUrl()}/shares/oauth/callback`, []);
  const oauthCallbackBaseUrl = getCallbackBaseUrl(oauthSettings?.redirectUri ?? "", currentSystemBaseUrl);
  const storageChoice = storageDraft ?? storageSettings?.distributedStorageEnabled ?? true;
  const showToast = useCallback((message: string, tone: AppToastTone = "success") => {
    showAppToast({
      title: message,
      tone,
    });
  }, []);
  const applyWorkspaceShareSettings = useCallback((settings: WorkspaceShareSettings) => {
    const saved = workspaceSettingsToForm(settings);
    savedWorkspaceRef.current = saved;
    setSavedWorkspaceSnapshot(saved);
    setAnonymousPolicy(settings.anonymousAccess);
    setEmailRule(settings.emailRule);
    setAllowPermanent(settings.allowPermanent);
    setAudit(settings.audit);
    setDefaultExpiresDays(String(settings.defaultExpiresDays));
    setMaxExpiresDays(String(settings.maxExpiresDays));
    setDomains(settings.allowedDomains.join("\n"));
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaces().then(workspaces => {
      const currentWorkspaceId = workspaces[0]?.id;
      if (!currentWorkspaceId) throw new Error("Workspace unavailable");
      if (!cancelled) setWorkspaceId(currentWorkspaceId);
      return fetchWorkspaceShareSettings(currentWorkspaceId);
    }).then(settings => {
      if (!cancelled) {
        applyWorkspaceShareSettings(settings);
      }
    }).catch(() => {
      if (!cancelled) showToast(t("admin.loadFailed"), "error");
    });
    return () => {
      cancelled = true;
    };
  }, [applyWorkspaceShareSettings, showToast, t]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchAuthSettings(), fetchStorageSettings(), fetchSiteSettings(), fetchMailSettings(), fetchPasskeys(), fetchTranslationSettings()]).then(([auth, storage, adminSettings, mail, passkeyRows, translations]) => {
      if (!cancelled) {
        setAuthSettings(auth);
        setStorageSettings(storage);
        setSiteSettings(adminSettings.site);
        setTranslationBundles(translations.bundles);
        setOauthSettings(adminSettings.oauth);
        setMailSettings(mail);
        setPasskeySettings(adminSettings.passkey);
        setPasskeys(passkeyRows);
        setStorageDraft(storage.distributedStorageEnabled);
        setMailConfigOpen(mail.enabled);
        setOauthConfigOpen(auth.oauthEnabled);
        setPasskeyConfigOpen(auth.passkeyEnabled);
        savedAuthRef.current = auth;
        savedStorageRef.current = storage;
        savedSiteRef.current = adminSettings.site;
        savedOauthRef.current = adminSettings.oauth;
        savedMailRef.current = mail;
        savedPasskeyRef.current = adminSettings.passkey;
        setSavedStorageSnapshot(storage);
        setSavedOauthSnapshot(adminSettings.oauth);
        setSavedMailSnapshot(mail);
        setSavedPasskeySnapshot(adminSettings.passkey);
      }
    }).catch(() => {
      if (!cancelled) showToast(t("admin.loadFailed"), "error");
    });
    return () => {
      cancelled = true;
    };
  }, [showToast, t]);
  const parseDomainsValue = (value: string) => value.split(/[\n,]/).map(value => value.trim()).filter(Boolean).map(value => value.replace(/^@/, ""));
  const parseDomains = () => parseDomainsValue(domains);
  const clearUndoAction = (key: string) => setUndoActions(current => {
    const next = {
      ...current
    };
    delete next[key];
    return next;
  });
  const setUndoAction = (key: string, action: () => void) => {
    setUndoActions(current => ({
      ...current,
      [key]: action
    }));
  };
  const applyWorkspaceForm = (settings: WorkspaceShareForm) => {
    setAnonymousPolicy(settings.anonymousAccess);
    setEmailRule(settings.emailRule);
    setAllowPermanent(settings.allowPermanent);
    setAudit(settings.audit);
    setDefaultExpiresDays(String(settings.defaultExpiresDays));
    setMaxExpiresDays(String(settings.maxExpiresDays));
    setDomains(settings.allowedDomains.join("\n"));
  };
  const currentWorkspaceForm = (overrides: Partial<WorkspaceShareForm> = {}): WorkspaceShareForm => ({
    anonymousAccess: anonymousPolicy,
    emailRule,
    allowedDomains: parseDomains(),
    defaultExpiresDays: Math.max(1, Number(defaultExpiresDays) || 1),
    maxExpiresDays: Math.max(1, Number(maxExpiresDays) || 1),
    allowPermanent,
    audit,
    ...overrides
  });
  const saveWorkspaceForm = (key: string, next: WorkspaceShareForm, previous: WorkspaceShareForm, recordUndo = true) => {
    if (saving || !workspaceId || !settingChanged(previous, next)) return;
    applyWorkspaceForm(next);
    setSaving(true);
    void updateWorkspaceShareSettings(workspaceId, next).then(settings => {
      const saved = workspaceSettingsToForm(settings);
      savedWorkspaceRef.current = saved;
      setSavedWorkspaceSnapshot(saved);
      applyWorkspaceForm(saved);
      if (recordUndo) setUndoAction(key, () => saveWorkspaceForm(key, previous, saved, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      applyWorkspaceForm(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitWorkspaceForm = (key: string, overrides: Partial<WorkspaceShareForm> = {}) => {
    const previous = savedWorkspaceRef.current ?? currentWorkspaceForm();
    const next = currentWorkspaceForm(overrides);
    saveWorkspaceForm(key, next, previous);
  };
  const saveAuthValue = (key: string, next: AuthSettings, previous: AuthSettings, recordUndo = true) => {
    if (saving || !settingChanged(previous, next)) return;
    setAuthSettings(next);
    setSaving(true);
    void updateAuthSettings({
      localEnabled: next.localEnabled,
      oauthEnabled: next.oauthEnabled,
      passkeyEnabled: next.passkeyEnabled
    }).then(settings => {
      savedAuthRef.current = settings;
      setAuthSettings(settings);
      if (recordUndo) setUndoAction(key, () => saveAuthValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setAuthSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const toggleAuthMethod = (method: "localEnabled" | "oauthEnabled" | "passkeyEnabled") => {
    if (!authSettings || saving) return;
    if (method === "oauthEnabled" && !authSettings.oauthEnabled && !authSettings.oauthConfigured) {
      setOauthConfigOpen(true);
      showToast(t("admin.oauthConfigRequired"), "error");
      return;
    }
    if (method === "passkeyEnabled" && !authSettings.passkeyEnabled && !authSettings.passkeyConfigured) {
      setPasskeyConfigOpen(true);
      showToast(t("admin.passkeyConfigRequired"), "error");
      return;
    }
    const previous = savedAuthRef.current ?? authSettings;
    const next = {
      ...previous,
      [method]: !authSettings[method]
    };
    if (!next.localEnabled && !next.oauthEnabled && !next.passkeyEnabled) {
      showToast(t("admin.authMethodRequired"), "error");
      return;
    }
    saveAuthValue(method, next, previous);
  };
  const storageInputFromSettings = (settings: StorageSettings, secret?: string): StorageSettingsInput => ({
    distributedStorageEnabled: settings.distributedStorageEnabled,
    endpoint: settings.endpoint.trim(),
    region: settings.region.trim(),
    bucket: settings.bucket.trim(),
    accessKeyId: settings.accessKeyId.trim(),
    forcePathStyle: settings.forcePathStyle,
    ...(secret?.trim() ? {
      secretAccessKey: secret.trim()
    } : {})
  });
  const applyStorageSettings = (settings: StorageSettings) => {
    setStorageSettings(settings);
    setStorageDraft(settings.distributedStorageEnabled);
  };
  const saveStorageValue = (key: string, next: StorageSettings, previous: StorageSettings, recordUndo = true, secret?: string) => {
    if (saving || !secret && !settingChanged(previous, next)) return;
    applyStorageSettings(next);
    setSaving(true);
    void updateStorageSettings(storageInputFromSettings(next, secret)).then(settings => {
      savedStorageRef.current = settings;
      setSavedStorageSnapshot(settings);
      applyStorageSettings(settings);
      setStorageSecret("");
      if (recordUndo && !secret) setUndoAction(key, () => saveStorageValue(key, previous, settings, false));else clearUndoAction(key);
      const modeChanged = previous.distributedStorageEnabled !== settings.distributedStorageEnabled;
      showToast(modeChanged ? settings.distributedStorageEnabled ? t("admin.storageSwitchedToObject") : t("admin.storageSwitchedToLocal") : t("admin.saved"));
    }).catch(error => {
      applyStorageSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitStorageSettings = () => {
    if (!storageSettings || saving) return;
    const previous = savedStorageRef.current ?? storageSettings;
    const next = {
      ...storageSettings,
      distributedStorageEnabled: storageChoice
    };
    saveStorageValue("distributedStorage", next, previous, true, storageSecret.trim() || undefined);
  };
  const runStorageTest = () => {
    if (!storageSettings || saving) return;
    setSaving(true);
    const draft = {
      ...storageSettings,
      distributedStorageEnabled: storageChoice
    };
    void testStorageSettings(storageInputFromSettings(draft, storageSecret.trim() || undefined)).then(() => showToast(t("admin.objectStorageTested"))).catch(() => showToast(t("admin.objectStorageTestFailed"), "error")).finally(() => setSaving(false));
  };
  const saveSiteValue = (key: string, next: PublicSiteSettings, previous: PublicSiteSettings, recordUndo = true) => {
    if (saving || !settingChanged(previous, next)) return;
    setSiteSettings(next);
    setSaving(true);
    void updateSiteSettings(next).then(settings => {
      savedSiteRef.current = settings;
      setSiteSettings(settings);
      if (recordUndo) setUndoAction(key, () => saveSiteValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setSiteSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitSite = (key: string, next: PublicSiteSettings) => {
    const previous = savedSiteRef.current ?? siteSettings;
    saveSiteValue(key, next, previous);
  };
  const pickLogo = () => logoInputRef.current?.click();
  const updateLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 256 * 1024) {
      showToast(t("setup.logoTooLarge"), "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : null;
      const previous = savedSiteRef.current ?? siteSettings;
      saveSiteValue("siteLogo", {
        ...previous,
        authLogoDataUrl: value
      }, previous);
    };
    reader.readAsDataURL(file);
  };
  const pickTranslationBundle = () => translationInputRef.current?.click();
  const updateTranslationBundle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const match = file.name.match(/^([a-z]{2,3}_[A-Z0-9]{2,8})\.tsln$/);
    if (!match) {
      showToast(t("admin.translationFileInvalid"), "error");
      return;
    }
    if (file.size > 1024 * 1024) {
      showToast(t("admin.translationFileTooLarge"), "error");
      return;
    }
    const code = match[1];
    setSaving(true);
    void file.text().then(content => upsertTranslationBundle({
      code,
      content
    })).then(bundle => {
      setTranslationBundles(current => [bundle, ...current.filter(item => item.code !== bundle.code)].sort((left, right) => left.code.localeCompare(right.code)));
      showToast(t("admin.translationUploaded"));
    }).catch(error => showToast(getAdminSaveFailedMessage(error, t), "error")).finally(() => setSaving(false));
  };
  const saveOAuthValue = (key: string, next: OAuthSettings, previous: OAuthSettings, recordUndo = true, clientSecret?: string) => {
    if (saving || !clientSecret && !settingChanged(previous, next)) return;
    setOauthSettings(next);
    setSaving(true);
    void updateOAuthSettings(clientSecret ? {
      ...next,
      clientSecret
    } : next).then(async settings => {
      savedOauthRef.current = settings;
      setSavedOauthSnapshot(settings);
      setOauthSettings(settings);
      setOauthSecret("");
      const auth = await fetchAuthSettings();
      savedAuthRef.current = auth;
      setAuthSettings(auth);
      if (recordUndo) setUndoAction(key, () => saveOAuthValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setOauthSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitOAuthSettings = () => {
    if (!oauthSettings) return;
    const previous = savedOauthRef.current ?? oauthSettings;
    saveOAuthValue("oauthSettings", {
      ...oauthSettings,
      enabled: true
    }, previous, true, oauthSecret.trim() || undefined);
  };
  const applyIcetowneBlogOAuthPreset = () => {
    if (!oauthSettings || saving) return;
    const previous = savedOauthRef.current ?? oauthSettings;
    setOauthSettings({
      ...previous,
      ...icetowneBlogOAuthPreset,
      redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl)
    });
    setOauthConfigOpen(true);
    showToast(t("admin.presetApplied"), "neutral");
  };
  const setOAuthProfile = (providerProfile: OAuthSettings["providerProfile"]) => {
    if (!oauthSettings || saving) return;
    const next = providerProfile === "icetowne-blog" ? {
      ...oauthSettings,
      ...icetowneBlogOAuthPreset,
      redirectUri: buildLoginCallbackUrl(oauthCallbackBaseUrl)
    } : {
      ...oauthSettings,
      providerProfile
    };
    setOauthSettings(next);
    setOauthConfigOpen(true);
  };
  const copyOAuthCallback = (value: string) => {
    const target = value.trim();
    if (!target) return;
    void copyTextToClipboard(target).then(() => {
      showToast(t("admin.oauthRedirectCopied"));
    });
  };
  const mailInputFromSettings = (settings: MailSettings, password?: string): MailSettingsInput => ({
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    username: settings.username,
    ...(password ? {
      password
    } : {}),
    fromName: settings.fromName,
    ...(settings.fromEmail.trim() ? {
      fromEmail: settings.fromEmail
    } : {}),
    ...(settings.replyTo.trim() ? {
      replyTo: settings.replyTo
    } : {})
  });
  const saveMailValue = (key: string, next: MailSettings, previous: MailSettings, recordUndo = true, password?: string) => {
    if (saving || !password && !settingChanged(previous, next)) return;
    setMailSettings(next);
    setSaving(true);
    void updateMailSettings(mailInputFromSettings(next, password)).then(settings => {
      savedMailRef.current = settings;
      setSavedMailSnapshot(settings);
      setMailSettings(settings);
      if (password) setMailPassword("");
      if (recordUndo) setUndoAction(key, () => saveMailValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setMailSettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitMailSettings = () => {
    const previous = savedMailRef.current ?? mailSettings;
    saveMailValue("mailSettings", mailSettings, previous, true, mailPassword.trim() || undefined);
  };
  const runMailTest = () => {
    const recipientEmail = (mailTestEmail || mailSettings.fromEmail).trim();
    if (!recipientEmail || saving) return;
    setSaving(true);
    const previous = savedMailRef.current ?? mailSettings;
    const savePromise = mailPassword.trim() ? updateMailSettings(mailInputFromSettings(mailSettings, mailPassword)) : updateMailSettings(mailInputFromSettings(mailSettings));
    void savePromise.then(settings => {
      savedMailRef.current = settings;
      setSavedMailSnapshot(settings);
      setMailSettings(settings);
      setMailPassword("");
      return testMailSettings(recipientEmail);
    }).then(settings => {
      savedMailRef.current = settings;
      setSavedMailSnapshot(settings);
      setMailSettings(settings);
      showToast(t("admin.mailTestSent"));
    }).catch(() => {
      setMailSettings(previous);
      showToast(t("admin.mailTestFailed"), "error");
    }).finally(() => setSaving(false));
  };
  const savePasskeyValue = (key: string, next: PasskeySettings, previous: PasskeySettings, recordUndo = true) => {
    if (saving || !settingChanged(previous, next)) return;
    setPasskeySettings(next);
    setSaving(true);
    void updatePasskeySettings(next).then(async settings => {
      savedPasskeyRef.current = settings;
      setSavedPasskeySnapshot(settings);
      setPasskeySettings(settings);
      const auth = await fetchAuthSettings();
      savedAuthRef.current = auth;
      setAuthSettings(auth);
      if (recordUndo) setUndoAction(key, () => savePasskeyValue(key, previous, settings, false));else clearUndoAction(key);
      showToast(t("admin.saved"));
    }).catch(error => {
      setPasskeySettings(previous);
      showToast(getAdminSaveFailedMessage(error, t), "error");
    }).finally(() => setSaving(false));
  };
  const commitPasskeySettings = () => {
    if (!passkeySettings) return;
    const previous = savedPasskeyRef.current ?? passkeySettings;
    savePasskeyValue("passkeySettings", {
      ...passkeySettings,
      enabled: true
    }, previous);
  };
  const registerPasskey = () => {
    if (!authSettings?.passkeyConfigured) {
      setPasskeyConfigOpen(true);
      showToast(t("admin.passkeyConfigRequired"), "error");
      return;
    }
    setSaving(true);
    void createPasskeyRegistrationOptions().then(optionsJSON => startRegistration({
      optionsJSON
    })).then(response => verifyPasskeyRegistration({
      name: passkeyName,
      response
    })).then(() => fetchPasskeys()).then(rows => {
      setPasskeys(rows);
      showToast(t("admin.saved"));
    }).catch(error => showToast(getAdminSaveFailedMessage(error, t), "error")).finally(() => setSaving(false));
  };
  const removePasskey = (id: string) => {
    setSaving(true);
    void deletePasskey(id).then(() => fetchPasskeys()).then(rows => {
      setPasskeys(rows);
      showToast(t("admin.saved"));
    }).catch(error => showToast(getAdminSaveFailedMessage(error, t), "error")).finally(() => setSaving(false));
  };
  const savedMail = savedMailSnapshot ?? mailSettings;
  const savedOauth = savedOauthSnapshot ?? oauthSettings;
  const savedPasskey = savedPasskeySnapshot ?? passkeySettings;
  const savedStorage = savedStorageSnapshot ?? storageSettings;
  const savedWorkspace = savedWorkspaceSnapshot;
  const mailDirty = settingChanged(savedMail, mailSettings) || Boolean(mailPassword.trim());
  const oauthDirty = Boolean(oauthSettings && savedOauth && (settingChanged(savedOauth, oauthSettings) || oauthSecret.trim()));
  const passkeyDirty = Boolean(passkeySettings && savedPasskey && settingChanged(savedPasskey, passkeySettings));
  const storageModeDirty = Boolean(savedStorage && storageDraft !== null && storageDraft !== savedStorage.distributedStorageEnabled);
  const storageConfigDirty = Boolean(storageSettings && savedStorage && (settingChanged(storageInputFromSettings(savedStorage), storageInputFromSettings(storageSettings)) || storageSecret.trim()));
  const storageDirty = storageModeDirty || storageConfigDirty;
  const canTestStorage = Boolean(storageSettings && storageSettings.endpoint.trim() && storageSettings.region.trim() && storageSettings.bucket.trim() && storageSettings.accessKeyId.trim() && (storageSettings.secretAccessKeyConfigured || storageSecret.trim()));
  const domainDirty = Boolean(savedWorkspace && (savedWorkspace.emailRule !== emailRule || settingChanged(savedWorkspace.allowedDomains, parseDomains())));
  const showOAuthConfig = oauthConfigOpen || Boolean(authSettings?.oauthEnabled) || oauthDirty;
  const showPasskeyConfig = passkeyConfigOpen || Boolean(authSettings?.passkeyEnabled) || passkeyDirty || passkeys.length > 0;
  const resetMailDraft = () => {
    setMailSettings(savedMailSnapshot ?? defaultMailSettings);
    setMailPassword("");
  };
  const resetOAuthDraft = () => {
    if (savedOauthSnapshot) setOauthSettings(savedOauthSnapshot);
    setOauthSecret("");
  };
  const resetPasskeyDraft = () => {
    if (savedPasskeySnapshot) setPasskeySettings(savedPasskeySnapshot);
  };
  const resetStorageDraft = () => {
    if (!savedStorageSnapshot) return;
    applyStorageSettings(savedStorageSnapshot);
    setStorageSecret("");
  };
  const resetDomainDraft = () => {
    if (!savedWorkspaceSnapshot) return;
    setEmailRule(savedWorkspaceSnapshot.emailRule);
    setDomains(savedWorkspaceSnapshot.allowedDomains.join("\n"));
  };
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    maxWidth: "920px"
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      color: palette.subtle,
      fontSize: "12px"
    }}>
        <LocalIcon name="shield" size={14} color={palette.secure} />
        <span>{t("admin.breadcrumb")}</span>
      </div>

      <AdminSection icon={<LocalIcon name="image" size={16} />} palette={palette} title={t("admin.siteBrand")}>
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "150px minmax(0, 1fr)",
        gap: "16px",
        alignItems: "center"
      } as React.CSSProperties}>
          <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "112px",
          background: palette.surface2,
          borderRadius: "8px",
          borderWidth: "1px",
          borderColor: palette.hairline
        }}>
            <AppImage src={siteSettings.authLogoDataUrl || "/logo.png"} alt="" unoptimized style={{
            maxWidth: 96,
            maxHeight: 96,
            objectFit: "contain",
            width: "384px",
            height: "384px"
          }} />
          </div>
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}>
            <SettingItem palette={palette} undoAction={undoActions.siteName}>
              <AuthField label={t("admin.siteName")} palette={palette}>
                <AuthInput palette={palette} value={siteSettings.siteName} onBlur={() => commitSite("siteName", {
                ...(savedSiteRef.current ?? siteSettings),
                siteName: siteSettings.siteName
              })} onChange={event => setSiteSettings(value => ({
                ...value,
                siteName: event.target.value
              }))} />
              </AuthField>
            </SettingItem>
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <ToolButton label={t("admin.chooseLogo")} palette={palette} onClick={pickLogo}>
                <LocalIcon name="upload" size={17} />
              </ToolButton>
              <ToolButton label={t("admin.removeLogo")} palette={palette} onClick={() => commitSite("siteLogo", {
              ...(savedSiteRef.current ?? siteSettings),
              authLogoDataUrl: null
            })}>
                <LocalIcon name="cross" size={17} />
              </ToolButton>
              {undoActions.siteLogo ? <UndoSettingButton palette={palette} onClick={undoActions.siteLogo} /> : null}
            </div>
          </div>
        </div>
        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={updateLogo} style={{
        display: "none"
      }} />
      </AdminSection>

      <AdminSection icon={<LocalIcon name="earth" size={16} />} palette={palette} title={t("admin.translationBundles")}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px"
        }}>
          <div style={{
            minWidth: "0px",
            display: "flex",
            flexDirection: "column",
            gap: "4px"
          }}>
            <span style={{ color: palette.ink, fontWeight: "700" }}>{t("admin.translationUpload")}</span>
            <span style={{ color: palette.subtle, fontSize: "12px" }}>{t("admin.translationCount", { count: translationBundles.length })}</span>
          </div>
          <ToolButton label={t("admin.translationUpload")} palette={palette} disabled={saving} onClick={pickTranslationBundle}>
            <LocalIcon name="upload" size={17} />
          </ToolButton>
        </div>
        {translationBundles.length > 0 ? <div style={{
          display: "grid",
          gap: "6px"
        }}>
          {translationBundles.map(bundle => <div key={bundle.code} style={{
            display: "grid",
            gridTemplateColumns: "minmax(80px, 120px) minmax(0, 1fr)",
            gap: "10px",
            alignItems: "center",
            minHeight: "34px",
            paddingInline: "8px",
            borderRadius: "8px",
            background: palette.surface2,
            borderWidth: "1px",
            borderColor: palette.hairline
          }}>
              <span style={{ color: palette.ink, fontWeight: "700" }}>{bundle.code}</span>
              <span className="icedr-truncate" style={{ color: palette.subtle, fontSize: "12px" }}>{bundle.language}</span>
            </div>)}
        </div> : <SettingStatusLine icon="info" palette={palette} tone="neutral">
            {t("admin.translationEmpty")}
          </SettingStatusLine>}
        <input ref={translationInputRef} type="file" accept=".tsln,text/plain" onChange={updateTranslationBundle} style={{
          display: "none"
        }} />
      </AdminSection>

      <AdminSection icon={<LocalIcon name="lock" size={16} />} palette={palette} title={t("admin.authMethods")}>
        <SettingItem palette={palette} undoAction={undoActions.localEnabled}>
          <PolicyCheck checked={authSettings?.localEnabled ?? true} label={t("admin.localAuth")} onToggle={() => toggleAuthMethod("localEnabled")} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.oauthEnabled}>
          <PolicyCheck checked={authSettings?.oauthEnabled ?? false} label={authSettings?.oauthConfigured ? t("admin.oauthAuth") : t("admin.oauthAuthRequiresConfig")} onToggle={() => toggleAuthMethod("oauthEnabled")} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.passkeyEnabled}>
          <PolicyCheck checked={authSettings?.passkeyEnabled ?? false} label={authSettings?.passkeyConfigured ? t("admin.passkeyAuth") : t("admin.passkeyAuthUnavailable")} onToggle={() => toggleAuthMethod("passkeyEnabled")} palette={palette} />
        </SettingItem>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="mail" size={16} />} palette={palette} title={t("admin.mailSettings")}>
        <SettingItem palette={palette} undoAction={!mailDirty ? undoActions.mailSettings : undefined}>
          <PolicyCheck checked={mailSettings.enabled} label={t("admin.smtpEnabled")} onToggle={() => {
          setMailSettings(value => ({
            ...value,
            enabled: !value.enabled,
            verifiedAt: null
          }));
          setMailConfigOpen(true);
        }} palette={palette} />
        </SettingItem>
        <MotionPresence show={mailConfigOpen || mailSettings.enabled || mailDirty} preset="surface">
          <InlineConfigPanel palette={palette}>
            {mailSettings.enabled ? <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
                <AuthField label={t("admin.smtpHost")} palette={palette}>
                  <AuthInput palette={palette} value={mailSettings.host} onChange={event => setMailSettings(value => ({
                ...value,
                host: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpPort")} palette={palette}>
                  <AuthInput palette={palette} inputMode="numeric" value={String(mailSettings.port)} onChange={event => setMailSettings(value => ({
                ...value,
                port: Math.max(1, Number(event.target.value.replace(/\D/g, "")) || 1),
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpUsername")} palette={palette}>
                  <AuthInput palette={palette} value={mailSettings.username} onChange={event => setMailSettings(value => ({
                ...value,
                username: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpPassword")} palette={palette}>
                  <AuthInput palette={palette} type="password" value={mailPassword} placeholder={mailSettings.passwordConfigured ? t("admin.secretConfigured") : ""} onChange={event => {
                setMailPassword(event.target.value);
                setMailSettings(value => ({
                  ...value,
                  verifiedAt: null
                }));
              }} />
                </AuthField>
                <AuthField label={t("admin.smtpFromName")} palette={palette}>
                  <AuthInput palette={palette} value={mailSettings.fromName} onChange={event => setMailSettings(value => ({
                ...value,
                fromName: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpFromEmail")} palette={palette}>
                  <AuthInput palette={palette} type="email" value={mailSettings.fromEmail} onChange={event => setMailSettings(value => ({
                ...value,
                fromEmail: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <AuthField label={t("admin.smtpReplyTo")} palette={palette}>
                  <AuthInput palette={palette} type="email" value={mailSettings.replyTo} onChange={event => setMailSettings(value => ({
                ...value,
                replyTo: event.target.value,
                verifiedAt: null
              }))} />
                </AuthField>
                <PolicyCheck checked={mailSettings.secure} label={t("admin.smtpSecure")} onToggle={() => setMailSettings(value => ({
              ...value,
              secure: !value.secure,
              verifiedAt: null
            }))} palette={palette} />
              </div> : null}
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <AuthInput palette={palette} type="email" value={mailTestEmail} placeholder={mailSettings.fromEmail || t("admin.smtpTestEmail")} onChange={event => setMailTestEmail(event.target.value)} aria-label={t("admin.smtpTestEmail")} />
              <ToolButton label={t("admin.testMail")} palette={palette} disabled={saving || !mailSettings.enabled || !(mailTestEmail || mailSettings.fromEmail).trim()} onClick={runMailTest}>
                <LocalIcon name="mail" size={17} />
              </ToolButton>
            </div>
            <SettingStatusLine icon={mailSettings.verifiedAt ? "tick" : "exclamation"} palette={palette} tone={mailSettings.verifiedAt ? "secure" : "risk"}>
              {mailSettings.verifiedAt ? t("admin.smtpVerified") : t("admin.smtpNeedsTest")}
            </SettingStatusLine>
            <SettingActionBar canReset={mailDirty || Boolean(undoActions.mailSettings)} canSave={mailDirty} onReset={mailDirty ? resetMailDraft : undoActions.mailSettings} onSave={commitMailSettings} palette={palette} resetLabel={mailDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
          </InlineConfigPanel>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="key" size={16} />} palette={palette} title={t("admin.oauthSettings")}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px"
      }}>
          <ToolButton label={t("admin.oauthSettings")} palette={palette} disabled={saving || !oauthSettings} onClick={() => setOauthConfigOpen(value => !value)}>
            <LocalIcon name="settings" size={17} />
          </ToolButton>
          <ToolButton label={t("admin.applyIcetowneBlogPreset")} palette={palette} disabled={saving || !oauthSettings} onClick={applyIcetowneBlogOAuthPreset}>
            <LocalIcon name="import" size={17} />
          </ToolButton>
          {authSettings?.oauthEnabled ? <ToolButton label={t("admin.disableOAuth")} palette={palette} disabled={saving} onClick={() => toggleAuthMethod("oauthEnabled")}>
              <LocalIcon name="cross" size={17} />
            </ToolButton> : null}
        </div>
        <MotionPresence show={showOAuthConfig} preset="surface">
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}>
            <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
              <PolicyCheck checked={oauthSettings?.providerProfile === "oidc"} label={t("admin.providerOidc")} onToggle={() => setOAuthProfile("oidc")} palette={palette} />
              <PolicyCheck checked={oauthSettings?.providerProfile === "icetowne-blog"} label={t("admin.providerIcetowneBlog")} onToggle={() => setOAuthProfile("icetowne-blog")} palette={palette} />
            </div>
            <InlineConfigPanel palette={palette}>
              <div className="icedr-r-grid-template-columns" style={{
              display: "grid",
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
              gap: "12px"
            } as React.CSSProperties}>
                <AuthField label={t("admin.oauthIssuer")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.issuerUrl ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  issuerUrl: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthClientId")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.clientId ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  clientId: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthAudience")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.audience ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  audience: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthScopes")} palette={palette}>
                  <AuthInput palette={palette} value={oauthSettings?.scopes ?? ""} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  scopes: event.target.value
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.systemBaseUrl")} palette={palette}>
                  <AuthInput palette={palette} value={oauthCallbackBaseUrl} onChange={event => setOauthSettings(value => value ? {
                  ...value,
                  redirectUri: buildLoginCallbackUrl(event.target.value)
                } : value)} />
                </AuthField>
                <AuthField label={t("admin.oauthSecret")} palette={palette}>
                  <AuthInput palette={palette} type="password" value={oauthSecret} placeholder={oauthSettings?.clientSecretConfigured ? t("admin.secretConfigured") : ""} onChange={event => setOauthSecret(event.target.value)} />
                </AuthField>
                <AuthField label={t("admin.oauthRedirectUri")} palette={palette}>
                  <div style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "8px",
                  width: "100%"
                }}>
                    <AuthInput palette={palette} readOnly value={oauthSettings?.redirectUri ?? ""} style={{
                    flex: "1 1 auto",
                    minWidth: "0px"
                  }} />
                    <ToolButton label={t("admin.copyOAuthRedirectUri")} palette={palette} onClick={() => copyOAuthCallback(oauthSettings?.redirectUri ?? "")}>
                      <LocalIcon name="copy" size={17} />
                    </ToolButton>
                  </div>
                </AuthField>
                <AuthField label={t("admin.oauthShareRedirectUri")} palette={palette}>
                  <div style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "8px",
                  width: "100%"
                }}>
                    <AuthInput palette={palette} readOnly value={oauthShareRedirectUri} style={{
                    flex: "1 1 auto",
                    minWidth: "0px"
                  }} />
                    <ToolButton label={t("admin.copyOAuthRedirectUri")} palette={palette} onClick={() => copyOAuthCallback(oauthShareRedirectUri)}>
                      <LocalIcon name="copy" size={17} />
                    </ToolButton>
                  </div>
                </AuthField>
              </div>
              <SettingActionBar canReset={oauthDirty || Boolean(undoActions.oauthSettings)} canSave={oauthDirty} onReset={oauthDirty ? resetOAuthDraft : undoActions.oauthSettings} onSave={commitOAuthSettings} palette={palette} resetLabel={oauthDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
            </InlineConfigPanel>
          </div>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="key" size={16} />} palette={palette} title={t("admin.passkeySettings")}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px"
      }}>
          <ToolButton label={t("admin.passkeySettings")} palette={palette} disabled={saving || !passkeySettings} onClick={() => setPasskeyConfigOpen(value => !value)}>
            <LocalIcon name="settings" size={17} />
          </ToolButton>
          {authSettings?.passkeyEnabled ? <ToolButton label={t("admin.disablePasskey")} palette={palette} disabled={saving} onClick={() => toggleAuthMethod("passkeyEnabled")}>
              <LocalIcon name="cross" size={17} />
            </ToolButton> : null}
        </div>
        <MotionPresence show={showPasskeyConfig} preset="surface">
          <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px"
        }}>
            <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(3, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
              <AuthField label={t("admin.rpName")} palette={palette}>
                <AuthInput palette={palette} value={passkeySettings?.rpName ?? ""} onChange={event => setPasskeySettings(value => value ? {
                ...value,
                rpName: event.target.value
              } : value)} />
              </AuthField>
              <AuthField label={t("admin.rpId")} palette={palette}>
                <AuthInput palette={palette} value={passkeySettings?.rpId ?? ""} onChange={event => setPasskeySettings(value => value ? {
                ...value,
                rpId: event.target.value
              } : value)} />
              </AuthField>
              <AuthField label={t("admin.origin")} palette={palette}>
                <AuthInput palette={palette} value={passkeySettings?.origin ?? ""} onChange={event => setPasskeySettings(value => value ? {
                ...value,
                origin: event.target.value
              } : value)} />
              </AuthField>
            </div>
            <SettingActionBar canReset={passkeyDirty || Boolean(undoActions.passkeySettings)} canSave={passkeyDirty} onReset={passkeyDirty ? resetPasskeyDraft : undoActions.passkeySettings} onSave={commitPasskeySettings} palette={palette} resetLabel={passkeyDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
            <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px"
          }}>
              <AuthInput palette={palette} value={passkeyName} onChange={event => setPasskeyName(event.target.value)} aria-label={t("admin.passkeyName")} />
              <ToolButton label={t("admin.registerPasskey")} palette={palette} disabled={saving} onClick={registerPasskey}>
                <LocalIcon name="key" size={17} />
              </ToolButton>
            </div>
            <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
              {passkeys.length === 0 ? <span style={{
              color: palette.subtle,
              fontSize: "12px"
            }}>{t("admin.noPasskeys")}</span> : null}
              {passkeys.map(passkey => <div key={passkey.id} style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "12px",
              borderRadius: "8px",
              background: palette.surface2,
              borderWidth: "1px",
              borderColor: palette.hairline
            }}>
                  <div style={{
                minWidth: "0px"
              }}>
                    <span className="icedr-truncate" style={{
                  color: palette.ink,
                  fontWeight: "650"
                }}>{passkey.name}</span>
                    <span className="icedr-truncate" style={{
                  color: palette.subtle,
                  fontSize: "12px"
                }}>{passkey.lastUsedAt ?? passkey.createdAt}</span>
                  </div>
                  <ToolButton label={t("admin.deletePasskey")} palette={palette} disabled={saving} onClick={() => removePasskey(passkey.id)}>
                    <LocalIcon name="trash" size={17} />
                  </ToolButton>
                </div>)}
            </div>
          </div>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="folder" size={16} />} palette={palette} title={t("admin.fileStorage")}>
        <SettingItem palette={palette} undoAction={!storageDirty ? undoActions.distributedStorage : undefined}>
          <RadioRow active={storageChoice} label={t("admin.objectFileStorage")} onClick={() => setStorageDraft(true)} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette}>
          <RadioRow active={!storageChoice} label={t("admin.localFileStorage")} onClick={() => setStorageDraft(false)} palette={palette} />
        </SettingItem>
        <InlineConfigPanel palette={palette}>
          <span style={{
          color: palette.subtle,
          fontSize: "12px"
        }}>
            {storageChoice ? t("admin.objectStorageHint") : t("admin.localStorageHint", {
            path: storageSettings?.localRoot ?? "data/local-files"
          })}
          </span>
          {storageChoice && storageSettings ? <>
              <div className="icedr-r-grid-template-columns" style={{
            display: "grid",
            "--r-grid-template-columns-base": "1fr",
            "--r-grid-template-columns-md": "repeat(2, minmax(0, 1fr))",
            gap: "12px"
          } as React.CSSProperties}>
                <AuthField label={t("admin.s3Endpoint")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.endpoint} onChange={event => setStorageSettings(value => value ? {
                ...value,
                endpoint: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3Region")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.region} onChange={event => setStorageSettings(value => value ? {
                ...value,
                region: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3Bucket")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.bucket} onChange={event => setStorageSettings(value => value ? {
                ...value,
                bucket: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3AccessKeyId")} palette={palette}>
                  <AuthInput palette={palette} value={storageSettings.accessKeyId} onChange={event => setStorageSettings(value => value ? {
                ...value,
                accessKeyId: event.target.value
              } : value)} />
                </AuthField>
                <AuthField label={t("admin.s3SecretAccessKey")} palette={palette}>
                  <AuthInput palette={palette} type="password" value={storageSecret} placeholder={storageSettings.secretAccessKeyConfigured ? t("admin.secretConfigured") : ""} onChange={event => setStorageSecret(event.target.value)} />
                </AuthField>
                <PolicyCheck checked={storageSettings.forcePathStyle} label={t("admin.s3ForcePathStyle")} onToggle={() => setStorageSettings(value => value ? {
              ...value,
              forcePathStyle: !value.forcePathStyle
            } : value)} palette={palette} />
              </div>
              <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            justifyContent: "flex-end"
          }}>
                <ToolButton label={t("admin.testObjectStorage")} palette={palette} disabled={saving || !canTestStorage} onClick={runStorageTest}>
                  <LocalIcon name="shield" size={17} />
                </ToolButton>
              </div>
            </> : null}
          {storageChoice ? <SettingStatusLine icon={storageDirty ? "info" : storageSettings?.objectStorageConfigured ? "tick" : "exclamation"} palette={palette} tone={storageDirty ? "neutral" : storageSettings?.objectStorageConfigured ? "secure" : "risk"}>
              {storageDirty ? t("admin.storageUnsavedChanges") : storageSettings?.objectStorageConfigured ? t("admin.objectStorageConfigured") : t("admin.objectStorageMissing")}
            </SettingStatusLine> : null}
          {storageChoice ? <SettingStatusLine icon="exclamation" palette={palette} tone="risk">
              {t("admin.storageSwitchWarning")}
            </SettingStatusLine> : null}
          <SettingActionBar canReset={storageDirty || Boolean(undoActions.distributedStorage)} canSave={storageDirty} onReset={storageDirty ? resetStorageDraft : undoActions.distributedStorage} onSave={commitStorageSettings} palette={palette} resetLabel={storageDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
        </InlineConfigPanel>
      </AdminSection>

      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      color: palette.muted,
      fontWeight: "760",
      paddingTop: "8px"
    }}>
        <LocalIcon name="link" size={17} color={palette.primaryHover} />
        <span>{t("admin.externalLinkPolicy")}</span>
      </div>

      <AdminSection icon={<LocalIcon name="earth" size={16} />} palette={palette} title={t("admin.anonymousPolicy")}>
        <SettingItem palette={palette} undoAction={anonymousPolicy === "blocked" ? undoActions.anonymousPolicy : undefined}>
          <RadioRow active={anonymousPolicy === "blocked"} label={t("admin.blockAnonymous")} onClick={() => commitWorkspaceForm("anonymousPolicy", {
          anonymousAccess: "blocked"
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={anonymousPolicy === "email-required" ? undoActions.anonymousPolicy : undefined}>
          <RadioRow active={anonymousPolicy === "email-required"} label={t("admin.emailRequiredAnonymous")} onClick={() => commitWorkspaceForm("anonymousPolicy", {
          anonymousAccess: "email-required"
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={anonymousPolicy === "public" ? undoActions.anonymousPolicy : undefined}>
          <RadioRow active={anonymousPolicy === "public"} label={t("admin.publicAnonymous")} onClick={() => commitWorkspaceForm("anonymousPolicy", {
          anonymousAccess: "public"
        })} palette={palette} tone="risk" />
        </SettingItem>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="user_check" size={16} />} palette={palette} title={t("admin.identityPolicy")}>
        <IdentityPolicyRow experience={buildAnonymousPolicyExperience(anonymousPolicy, policyFromWorkspaceSettings({
        workspaceId: workspaceId ?? "",
        anonymousAccess: anonymousPolicy,
        emailRule,
        allowedDomains: parseDomains(),
        defaultExpiresDays: Number(defaultExpiresDays) || defaultExternalSharePolicy.expiresValue,
        maxExpiresDays: Number(maxExpiresDays) || 30,
        allowPermanent,
        audit,
        updatedAt: ""
      }))} palette={palette} />
        <IdentityPolicyRow experience={buildIcaPolicyExperience(authSettings)} palette={palette} />
      </AdminSection>

      <AdminSection icon={<LocalIcon name="mention" size={16} />} palette={palette} title={t("admin.emailRules")}>
        <SettingItem palette={palette} undoAction={emailRule === "any" ? undoActions.emailRule : undefined}>
          <RadioRow active={emailRule === "any"} label={t("admin.anyEmail")} onClick={() => commitWorkspaceForm("emailRule", {
          emailRule: "any",
          allowedDomains: []
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={emailRule === "domains" && !domainDirty ? undoActions.emailRule : undefined}>
          <RadioRow active={emailRule === "domains"} label={t("admin.specifiedDomains")} onClick={() => setEmailRule("domains")} palette={palette} />
        </SettingItem>
        <MotionPresence show={emailRule === "domains"} preset="surface">
          <InlineConfigPanel palette={palette}>
            <TextArea value={domains} onChange={event => setDomains(event.target.value)} className="icedr-has-focus" style={{
            background: palette.surface2,
            borderColor: palette.hairline,
            color: palette.ink,
            minHeight: "84px",
            "--focus-border-color": palette.primary,
            "--focus-box-shadow": `0 0 0 1px ${palette.focusRing}`
          } as React.CSSProperties} />
            <SettingActionBar canReset={domainDirty || Boolean(undoActions.emailRule || undoActions.allowedDomains)} canSave={domainDirty} onReset={domainDirty ? resetDomainDraft : undoActions.emailRule ?? undoActions.allowedDomains} onSave={() => commitWorkspaceForm("emailRule", {
            emailRule: "domains",
            allowedDomains: parseDomains()
          })} palette={palette} resetLabel={domainDirty ? t("admin.revertChanges") : t("admin.undo")} saveLabel={t("admin.save")} saving={saving} />
          </InlineConfigPanel>
        </MotionPresence>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="calendar" size={16} />} palette={palette} title={t("admin.lifecycle")}>
        <div className="icedr-r-grid-template-columns" style={{
        display: "grid",
        "--r-grid-template-columns-base": "1fr",
        "--r-grid-template-columns-md": "160px 1fr",
        gap: "12px"
      } as React.CSSProperties}>
          <span style={{
          color: palette.subtle
        }}>{t("admin.defaultExpiry")}</span>
          <SettingItem palette={palette} undoAction={undoActions.defaultExpiresDays}>
            <div style={{
            alignItems: "center",
            display: "flex"
          }}><PolicyInput palette={palette} value={defaultExpiresDays} inputMode="numeric" onBlur={() => commitWorkspaceForm("defaultExpiresDays", {
              defaultExpiresDays: Math.max(1, Number(defaultExpiresDays) || 1)
            })} onChange={event => setDefaultExpiresDays(event.target.value.replace(/\D/g, ""))} /><span style={{
              color: palette.muted
            }}>{t("share.units.days")}</span></div>
          </SettingItem>
          <span style={{
          color: palette.subtle
        }}>{t("admin.maximumExpiry")}</span>
          <SettingItem palette={palette} undoAction={undoActions.maxExpiresDays}>
            <div style={{
            alignItems: "center",
            display: "flex"
          }}><PolicyInput palette={palette} value={maxExpiresDays} inputMode="numeric" onBlur={() => commitWorkspaceForm("maxExpiresDays", {
              maxExpiresDays: Math.max(1, Number(maxExpiresDays) || 1)
            })} onChange={event => setMaxExpiresDays(event.target.value.replace(/\D/g, ""))} /><span style={{
              color: palette.muted
            }}>{t("share.units.days")}</span></div>
          </SettingItem>
        </div>
        <SettingItem palette={palette} undoAction={undoActions.allowPermanent}>
          <PolicyCheck checked={allowPermanent} label={t("admin.allowPermanent")} onToggle={() => commitWorkspaceForm("allowPermanent", {
          allowPermanent: !allowPermanent
        })} palette={palette} />
        </SettingItem>
      </AdminSection>

      <AdminSection icon={<LocalIcon name="shield" size={16} />} palette={palette} title={t("admin.securityAudit")}>
        <SettingItem palette={palette} undoAction={undoActions.auditIp}>
          <PolicyCheck checked={audit.ip} label={t("admin.recordIp")} onToggle={() => commitWorkspaceForm("auditIp", {
          audit: {
            ...audit,
            ip: !audit.ip
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditUserAgent}>
          <PolicyCheck checked={audit.userAgent} label={t("admin.recordUserAgent")} onToggle={() => commitWorkspaceForm("auditUserAgent", {
          audit: {
            ...audit,
            userAgent: !audit.userAgent
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditDownloads}>
          <PolicyCheck checked={audit.downloads} label={t("admin.recordDownloads")} onToggle={() => commitWorkspaceForm("auditDownloads", {
          audit: {
            ...audit,
            downloads: !audit.downloads
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditAnomaly}>
          <PolicyCheck checked={audit.anomaly} label={t("admin.anomalyDetection")} onToggle={() => commitWorkspaceForm("auditAnomaly", {
          audit: {
            ...audit,
            anomaly: !audit.anomaly
          }
        })} palette={palette} />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditAlerts}>
          <PolicyCheck checked={audit.alerts} label={t("admin.riskAlerts")} onToggle={() => commitWorkspaceForm("auditAlerts", {
          audit: {
            ...audit,
            alerts: !audit.alerts
          }
        })} palette={palette} />
        </SettingItem>
      </AdminSection>

    </div>;
}
function AdminSection({
  children,
  icon,
  palette,
  title
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  palette: Palette;
  title: string;
}) {
  return <Surface palette={palette} style={{
    padding: "16px"
  }}>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        color: palette.muted,
        fontWeight: "700"
      }}>
          {icon}
          <span>{title}</span>
        </div>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}>{children}</div>
      </div>
    </Surface>;
}
function InlineConfigPanel({
  children,
  palette
}: {
  children: React.ReactNode;
  palette: Palette;
}) {
  return <div className="icedr-r-padding-inline-start" style={{
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    "--r-padding-inline-start-base": "20px",
    "--r-padding-inline-start-md": "28px",
    borderLeftWidth: "1px",
    borderColor: palette.hairline
  } as React.CSSProperties}>
      {children}
    </div>;
}
function SettingStatusLine({
  children,
  icon,
  palette,
  tone
}: {
  children: React.ReactNode;
  icon: LocalIconName;
  palette: Palette;
  tone: "neutral" | "risk" | "secure";
}) {
  const color = tone === "risk" ? palette.primaryHover : tone === "secure" ? palette.secure : palette.subtle;
  return <div style={{
    alignItems: "center",
    display: "flex",
    gap: "8px",
    color: color,
    fontSize: "12px",
    lineHeight: "1.5"
  }}>
      <LocalIcon name={icon} size={14} />
      <span style={{
      color: tone === "neutral" ? palette.subtle : color
    }}>{children}</span>
    </div>;
}
function SettingActionBar({
  canReset,
  canSave,
  onReset,
  onSave,
  palette,
  resetLabel,
  saveLabel,
  saving
}: {
  canReset: boolean;
  canSave: boolean;
  onReset?: () => void;
  onSave: () => void;
  palette: Palette;
  resetLabel: string;
  saveLabel: string;
  saving: boolean;
}) {
  return <div style={{
    alignItems: "center",
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end"
  }}>
      <ToolButton label={resetLabel} palette={palette} disabled={saving || !canReset || !onReset} onClick={onReset}>
        <LocalIcon name="refresh" size={16} />
      </ToolButton>
      <ToolButton label={saveLabel} palette={palette} disabled={saving || !canSave} onClick={onSave}>
        <LocalIcon name="save" size={16} />
      </ToolButton>
    </div>;
}
function SettingItem({
  children,
  palette,
  undoAction
}: {
  children: React.ReactNode;
  palette: Palette;
  undoAction?: () => void;
}) {
  return <div style={{
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    width: "100%"
  }}>
      <div style={{
      flex: "1 1 auto",
      minWidth: "0px"
    }}>
        {children}
      </div>
      {undoAction ? <UndoSettingButton palette={palette} onClick={undoAction} /> : null}
    </div>;
}
function UndoSettingButton({
  onClick,
  palette
}: {
  onClick: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  return <ToolButton label={t("admin.undo")} palette={palette} onClick={onClick}>
      <LocalIcon name="refresh" size={16} />
    </ToolButton>;
}
function RadioRow({
  active,
  label,
  onClick,
  palette,
  tone
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  palette: Palette;
  tone?: "risk";
}) {
  return <button {...buttonTypeAttr} aria-checked={active} onClick={onClick} role="radio" style={{
    textAlign: "left",
    width: "100%",
    color: tone === "risk" ? palette.primaryHover : palette.ink
  }}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "18px",
        height: "18px",
        borderRadius: "100%",
        borderWidth: "1px",
        borderColor: active ? palette.primary : palette.hairlineStrong
      }}>
          {active ? <div style={{
          width: "8px",
          height: "8px",
          borderRadius: "100%",
          background: palette.primaryHover
        }} /> : null}
        </div>
        <span>{label}</span>
      </div>
    </button>;
}
function buildAnonymousPolicyExperience(anonymousPolicy: AnonymousAccessPolicy, policy: ExternalSharePolicy): IdentityExperience {
  return {
    label: anonymousPolicy === "public" ? "Public visitor" : anonymousPolicy === "blocked" ? "Anonymous blocked" : "Email verified visitor",
    waitSeconds: formatPolicyWaitSeconds(policy),
    speedLabel: formatSpeedLimit(policy.speedValue > 0 ? {
      value: policy.speedValue,
      unit: policy.speedUnit
    } : null),
    sessionLabel: policy.downloadLimit || "No download limit"
  };
}
function buildIcaPolicyExperience(authSettings: AuthSettings | null): IdentityExperience {
  return {
    label: authSettings?.oauthConfigured ? "ICA OAuth visitor" : "ICA OAuth unavailable",
    waitSeconds: 0,
    speedLabel: "Policy limit",
    sessionLabel: authSettings?.oauthConfigured ? "OAuth session" : "Configuration required"
  };
}
function IdentityPolicyRow({
  experience,
  palette
}: {
  experience: IdentityExperience;
  palette: Palette;
}) {
  const t = useTranslations();
  return <div className="icedr-r-grid-template-columns" style={{
    display: "grid",
    "--r-grid-template-columns-base": "1fr",
    "--r-grid-template-columns-md": "180px repeat(3, minmax(0, 1fr))",
    gap: "8px",
    alignItems: "center",
    padding: "12px",
    borderRadius: "8px",
    background: palette.surface2,
    borderWidth: "1px",
    borderColor: palette.hairline
  } as React.CSSProperties}>
      <span style={{
      color: palette.ink,
      fontWeight: "600"
    }}>{experience.label}</span>
      <span style={{
      color: palette.subtle
    }}>{t("admin.waitValue", {
        seconds: experience.waitSeconds
      })}</span>
      <span style={{
      color: palette.subtle
    }}>{experience.speedLabel}</span>
      <span style={{
      color: palette.subtle
    }}>{experience.sessionLabel}</span>
    </div>;
}
function ShareSetup({
  collection,
  expiresLabel,
  palette,
  shareItems,
  totalSize
}: {
  collection: ShareCollection;
  expiresLabel: string;
  palette: Palette;
  shareItems: number;
  totalSize: string;
}) {
  const t = useTranslations();
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px",
    borderBottomWidth: "1px",
    borderColor: palette.hairline
  }}>
      <div style={{
      display: "flex",
      gap: "12px",
      alignItems: "flex-start",
      minWidth: "0px"
    }}>
        <ShareModeIcon mode={collection.mode} palette={palette} />
        <div style={{
        minWidth: "0px",
        flex: "1 1 auto"
      }}>
          <span className="icedr-truncate" style={{
          color: palette.ink,
          fontWeight: "600"
        }}>
            {collection.title}
          </span>
          <span style={{
          color: palette.subtle,
          fontSize: "12px",
          marginTop: "4px"
        }}>
            {t(`share.mode.${collection.mode}`)}
          </span>
        </div>
      </div>

      <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "8px"
    }}>
        <Metric label={t("share.items")} value={String(shareItems)} palette={palette} />
        <Metric label={t("share.totalSize")} value={totalSize} palette={palette} />
        <Metric label={t("share.expires")} value={expiresLabel} palette={palette} />
      </div>

      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px",
      color: palette.subtle,
      fontSize: "12px"
    }}>
        <LocalIcon name="shield" size={14} color={palette.secure} />
        <span style={{
        color: palette.muted
      }}>{t("share.adminManaged")}</span>
      </div>
    </div>;
}
function ShareCollectionPanel({
  collection,
  openSharePreview,
  palette,
  sourceItems
}: {
  collection: ShareCollection;
  openSharePreview: () => void;
  palette: Palette;
  sourceItems: DriveItem[];
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const listRef = useMotionStagger<HTMLDivElement>([collection.rootItems.map(item => item.id).join("|"), collection.mode]);
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "0px"
  }}>
      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "48px",
      paddingInline: "16px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        minWidth: "0px"
      }}>
          <LocalIcon name="user_group" size={16} color={palette.subtle} />
          <span className="icedr-truncate" style={{
          color: palette.muted,
          fontWeight: "600"
        }}>
            {t("share.collection")}
          </span>
        </div>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "4px"
      }}>
          <ToolButton label={t("share.openPreview")} palette={palette} onClick={openSharePreview}>
            <LocalIcon name="visible" size={17} />
          </ToolButton>
        </div>
      </div>

      <div ref={listRef} style={{
      display: "flex",
      flexDirection: "column",
      gap: "0px"
    }}>
        {collection.rootItems.map((item, index) => <div key={item.id} data-motion-row style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        paddingInline: "16px",
        paddingBlock: "12px",
        borderBottomWidth: "1px",
        borderColor: palette.hairline
      }}>
            <div style={{
          alignItems: "center",
          display: "flex",
          gap: "12px",
          minWidth: "0px"
        }}>
              <span style={{
            color: palette.tertiary,
            fontSize: "12px",
            width: "18px",
            textAlign: "right"
          }}>
                {index + 1}
              </span>
              <ItemIcon item={item} palette={palette} size={18} />
              <div style={{
            minWidth: "0px",
            flex: "1 1 auto"
          }}>
                <span className="icedr-truncate" style={{
              color: palette.ink,
              fontWeight: "500"
            }}>
                  {item.name}
                </span>
                <span style={{
              color: palette.subtle,
              fontSize: "12px"
            }}>
                  {t(`files.kind.${getItemKind(item)}`)}
                </span>
              </div>
            </div>
            <span style={{
          color: palette.subtle,
          fontSize: "12px",
          marginLeft: "12px",
          flexShrink: "0",
          whiteSpace: "nowrap"
        }}>
              {formatFileSize(sumDriveItemSizes([item], sourceItems), locale)}
            </span>
          </div>)}
      </div>

      <div style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      paddingInline: "16px",
      paddingBlock: "12px",
      color: palette.subtle,
      fontSize: "12px",
      borderTopWidth: "1px",
      borderColor: palette.hairline
    }}>
        <LocalIcon name="shield" size={14} />
        <span>{collection.mode === "multi-file" ? t("share.snapshotHint") : t("share.dynamicHint")}</span>
      </div>
    </div>;
}
function ShareCreateOptions({
  allowDownload,
  allowPreview,
  expiryDays,
  maxDays,
  palette,
  remark,
  setAllowDownload,
  setAllowPreview,
  setExpiryDays,
  setRemark
}: {
  allowDownload: boolean;
  allowPreview: boolean;
  expiryDays: string;
  maxDays: number;
  palette: Palette;
  remark: string;
  setAllowDownload: (value: boolean) => void;
  setAllowPreview: (value: boolean) => void;
  setExpiryDays: (value: string) => void;
  setRemark: (value: string) => void;
}) {
  const t = useTranslations();
  const overLimit = Number(expiryDays) > maxDays;
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "16px",
    borderBottomWidth: "1px",
    borderColor: palette.hairline
  }}>
      <span style={{
      color: palette.muted,
      fontWeight: "600"
    }}>
        {t("share.permissions")}
      </span>
      <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    }}>
        <PolicyCheck checked={allowDownload} label={t("share.allowDownload")} palette={palette} onToggle={() => setAllowDownload(!allowDownload)} />
        <PolicyCheck checked={allowPreview} label={t("share.allowPreview")} palette={palette} onToggle={() => setAllowPreview(!allowPreview)} />
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        color: palette.subtle,
        fontSize: "12px"
      }}>
          <LocalIcon name="lock" size={13} />
          <span>{t("share.previewBlockedHint")}</span>
        </div>
      </div>

      <div className="icedr-r-grid-template-columns" style={{
      display: "grid",
      "--r-grid-template-columns-base": "1fr",
      "--r-grid-template-columns-md": "160px minmax(0, 1fr)",
      gap: "12px",
      alignItems: "start"
    } as React.CSSProperties}>
        <span style={{
        color: palette.subtle
      }}>{t("share.expiry")}</span>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}>
          <div style={{
          alignItems: "center",
          display: "flex",
          gap: "8px"
        }}>
            <PolicyInput palette={palette} value={expiryDays} inputMode="numeric" onChange={event => setExpiryDays(event.target.value.replace(/\D/g, ""))} />
            <StatusPill palette={palette}>
              {t("share.units.days")}
            </StatusPill>
          </div>
          <span style={{
          color: overLimit ? palette.primaryHover : palette.subtle,
          fontSize: "12px"
        }}>
            {t("share.maximumAllowed", {
            count: maxDays
          })}
          </span>
        </div>
      </div>

      <div className="icedr-r-grid-template-columns" style={{
      display: "grid",
      "--r-grid-template-columns-base": "1fr",
      "--r-grid-template-columns-md": "160px minmax(0, 1fr)",
      gap: "12px",
      alignItems: "start"
    } as React.CSSProperties}>
        <span style={{
        color: palette.subtle
      }}>{t("share.remark")}</span>
        <TextArea value={remark} onChange={event => setRemark(event.target.value)} placeholder={t("share.optional")} className="icedr-has-placeholder icedr-has-focus" style={{
        minHeight: "78px",
        background: palette.surface2,
        borderColor: palette.hairline,
        color: palette.ink,
        "--placeholder-color": palette.tertiary,
        "--focus-border-color": palette.primary,
        "--focus-box-shadow": `0 0 0 1px ${palette.focusRing}`
      } as React.CSSProperties} />
      </div>
    </div>;
}
function PolicyCheck({
  checked,
  label,
  onToggle,
  palette
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  palette: Palette;
}) {
  return <button {...buttonTypeAttr} aria-pressed={checked} onClick={onToggle} className="icedr-has-hover icedr-has-active icedr-has-focus-visible" style={{
    textAlign: "left",
    width: "100%",
    color: palette.ink,
    borderRadius: "8px",
    paddingInline: "8px",
    paddingBlock: "6px",
    transition: "background-color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
    "--hover-bg": palette.surface2,
    "--hover-transform": "translateX(1px)",
    "--active-transform": "scale(0.99)",
    "--focus-visible-outline": "2px solid",
    "--focus-visible-outline-color": palette.focusRing,
    "--focus-visible-outline-offset": "2px"
  } as React.CSSProperties}>
      <div style={{
      alignItems: "center",
      display: "flex",
      gap: "8px"
    }}>
        <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "20px",
        height: "20px",
        borderRadius: "6px",
        borderWidth: "1px",
        borderColor: checked ? palette.primary : palette.hairlineStrong,
        background: checked ? palette.selected : "transparent",
        transition: "background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
        transform: checked ? "scale(1)" : "scale(0.96)"
      }}>
          {checked ? <div aria-hidden="true" style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: palette.primaryHover
        }}>
              <AnimatedCheckMark size={13} />
            </div> : null}
        </div>
        <span>{label}</span>
      </div>
    </button>;
}
function ShareCreatedPanel({
  openSharePreview,
  palette,
  shareUrl
}: {
  openSharePreview: () => void;
  palette: Palette;
  shareUrl: string;
}) {
  const t = useTranslations();
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const copyShareLink = async () => {
    await copyTextToClipboard(shareUrl);
    setFeedback(t("app.copied"));
  };
  return <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    padding: "20px"
  }}>
      <Surface palette={palette} style={{
      padding: "20px"
    }}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px"
      }}>
          <div style={{
          alignItems: "center",
          display: "flex",
          gap: "12px"
        }}>
            <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "40px",
            height: "40px",
            borderRadius: "8px",
            background: palette.selected,
            color: palette.primaryHover
          }}>
              <AnimatedCheckMark size={20} />
            </div>
            <div style={{
            minWidth: "0px"
          }}>
              <span style={{
              color: palette.ink,
              fontWeight: "700"
            }}>
                {t("share.createdTitle")}
              </span>
              <span style={{
              color: palette.subtle,
              fontSize: "12px"
            }}>
                {t("share.createdSubtitle")}
              </span>
            </div>
          </div>
          <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "12px",
          borderRadius: "8px",
          background: palette.surface2,
          borderWidth: "1px",
          borderColor: palette.hairline
        }}>
            <span className="icedr-truncate" style={{
            color: palette.muted
          }}>
              {shareUrl}
            </span>
            <ToolButton label={t("actions.copyLink")} palette={palette} onClick={copyShareLink}>
              <LocalIcon name="copy" size={16} />
            </ToolButton>
          </div>
          <div style={{
          alignItems: "center",
          display: "flex",
          gap: "8px"
        }}>
            <ToolButton label={t("share.openLink")} palette={palette} onClick={openSharePreview}>
              <LocalIcon name="visible" size={17} />
            </ToolButton>
            <ToolButton label={t("share.viewAccessRecords")} palette={palette} onClick={() => setFeedback(t("links.recordsFocused"))}>
              <LocalIcon name="shield" size={17} />
            </ToolButton>
          </div>
          {feedback ? <StatusPill palette={palette} tone="accent">
              {feedback}
            </StatusPill> : null}
        </div>
      </Surface>
    </div>;
}
function ExternalSharePreview({
  collection,
  expiresLabel,
  locale,
  palette,
  registeredShare,
  setThemeMode,
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
  sourceItems: DriveItem[];
  themeMode: ThemeMode;
  totalSize: string;
}) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<VisitorStage>("choose");
  const [visitorLevel, setVisitorLevel] = useState<VisitorLevel>("anonymous");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [accessItem, setAccessItem] = useState<DriveItem | null>(null);
  const [accessAction, setAccessAction] = useState<VisitorAccessAction>("download");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("email");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [accessSessionId, setAccessSessionId] = useState<string | null>(null);
  const [accessSession, setAccessSession] = useState<ShareAccessSession | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [icaConfigured, setIcaConfigured] = useState(false);
  const [preview, setPreview] = useState<{
    item: DriveItem;
    intent: PreviewIntentResponse | null;
  } | null>(null);
  const visibleItems = getVisibleRegisteredShareItems(registeredShare, folderId, sourceItems);
  const currentFolder = folderId ? findDriveItem(folderId, sourceItems) : undefined;
  const experience = getSharePolicyExperience(registeredShare, visitorLevel, accessSession);
  const verified = stage === "verified" || stage === "waiting" || stage === "download";
  const accessSessionRequired = Boolean(registeredShare.policy.allowedDomain || registeredShare.policy.downloadLimit || formatPolicyWaitSeconds(registeredShare.policy) > 0);
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
    void fetchIdentityConfig().then(config => setIcaConfigured(config.configured)).catch(() => setIcaConfigured(false));
  }, []);
  useEffect(() => {
    const sessionId = searchParams.get("shareAccessSession");
    if (!sessionId) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      const session: ShareAccessSession = {
        sessionId,
        shareToken: registeredShare.token,
        identityType: "ica",
        availableAt: new Date().toISOString(),
        waitSeconds: 0,
        downloadLimit: registeredShare.policy.downloadLimit,
        speedLimit: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      };
      setAccessSessionId(sessionId);
      setAccessSession(session);
      setVisitorLevel("ica");
      setRemaining(0);
      setStage("download");
    });
    return () => {
      cancelled = true;
    };
  }, [registeredShare.policy.downloadLimit, registeredShare.token, searchParams]);
  const sendCode = () => {
    if (!accessItem || !emailPattern.test(email)) return;
    setAuthBusy(true);
    void sendShareEmailCode(registeredShare.token, email).then(() => {
      setStage("code");
      setFeedback(t("share.codeSent"));
    }).catch(() => setFeedback(t("share.codeSendFailed"))).finally(() => setAuthBusy(false));
  };
  const verifyCode = () => {
    if (!accessItem || code.length !== 6) return;
    setAuthBusy(true);
    void verifyShareEmailCode(registeredShare.token, email, code).then(session => {
      setAccessSessionId(session.sessionId);
      setAccessSession(session);
      setVisitorLevel("email");
      setRemaining(session.waitSeconds);
      setStage("verified");
    }).catch(() => setFeedback(t("share.codeVerifyFailed"))).finally(() => setAuthBusy(false));
  };
  const goUp = () => setFolderId(getRegisteredShareParent(registeredShare, folderId, sourceItems));
  const requestVisitorAction = (item: DriveItem, action: VisitorAccessAction) => {
    if (action === "download" && !registeredShare.allowDownload) {
      setFeedback(t("share.downloadBlocked"));
      return;
    }
    if (action === "preview" && !registeredShare.allowPreview) {
      setFeedback(t("preview.unsupportedHint"));
      return;
    }
    setAccessItem(item);
    setAccessAction(action);
    setAuthOpen(true);
    if (stage === "download") return;
    setCode("");
    if (!accessSessionRequired) {
      setVisitorLevel("anonymous");
      setRemaining(0);
      setStage("download");
      return;
    }
    if (!accessSessionId) setAccessSession(null);
    setRemaining(experience.waitSeconds);
    setAuthMethod("email");
    setStage("email");
  };
  const authenticateAccount = (level: VisitorLevel = "ica") => {
    if (!accessItem) return;
    if (!icaConfigured || level !== "ica") {
      setFeedback(t("share.icaUnavailable"));
      return;
    }
    setAuthBusy(true);
    void startShareOAuth(registeredShare.token).then(response => {
      window.location.href = response.authorizationUrl;
    }).catch(() => setFeedback(t("share.icaUnavailable"))).finally(() => setAuthBusy(false));
  };
  const selectAuthMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    if (stage === "download") return;
    setStage(method === "email" ? "email" : "choose");
  };
  const continueToDownload = () => {
    const currentWait = remaining;
    setRemaining(currentWait);
    setStage(currentWait > 0 ? "waiting" : "download");
  };
  const completeVisitorAction = () => {
    if (!accessItem) return;
    const actionPromise = accessAction === "download" ? downloadSharedDriveItem(registeredShare.token, accessItem, accessSessionId ?? undefined).then(() => {
      setFeedback(t("app.downloaded"));
    }) : createSharedPreviewIntent(registeredShare.token, accessItem.id, accessSessionId ?? undefined).then(intent => {
      setPreview({
        item: accessItem,
        intent
      });
    });
    void actionPromise.then(() => setAuthOpen(false)).catch(() => {
      setFeedback(accessAction === "download" ? t("share.downloadFailed") : t("preview.notConfigured"));
    });
  };
  return <div style={{
    minHeight: "100vh"
  }}>
      <div className="icedr-r-padding-inline" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "56px",
      "--r-padding-inline-base": "16px",
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
          <div style={{
          width: "28px",
          height: "28px",
          borderRadius: "8px",
          background: palette.surface2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: palette.primaryHover
        }}>
            <LocalIcon name="link" size={17} />
          </div>
          <div style={{
          minWidth: "0px"
        }}>
            <span className="icedr-truncate" style={{
            color: palette.ink,
            fontWeight: "600"
          }}>
              ICEDR
            </span>
            <span className="icedr-truncate" style={{
            color: palette.subtle,
            fontSize: "12px"
          }}>
              {t("share.title")}
            </span>
          </div>
        </div>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "4px",
        flexShrink: "0"
      }}>
          <StatusPill palette={palette} tone={verified ? "accent" : "neutral"}>
            {verified ? t("share.verifiedAccess") : t("share.secureShare")}
          </StatusPill>
          <ThemeActions palette={palette} setThemeMode={setThemeMode} themeMode={themeMode} />
        </div>
      </div>

      <div className="icedr-r-padding-inline" style={{
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: "16px",
      maxWidth: "1180px",
      "--r-padding-inline-base": "12px",
      "--r-padding-inline-md": "24px",
      paddingBlock: "16px",
      minHeight: "calc(100vh - 56px)"
    } as React.CSSProperties}>
        <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        minWidth: "0px"
      }}>
          <Surface palette={palette} className="icedr-r-padding" style={{
          "--r-padding-base": "16px",
          "--r-padding-md": "20px"
        } as React.CSSProperties}>
            <div className="icedr-r-align-items icedr-r-flex-direction" style={{
            display: "flex",
            "--r-align-items-base": "flex-start",
            "--r-align-items-md": "center",
            justifyContent: "space-between",
            gap: "16px",
            "--r-flex-direction-base": "column",
            "--r-flex-direction-md": "row"
          } as React.CSSProperties}>
              <div style={{
              display: "flex",
              gap: "16px",
              minWidth: "0px",
              alignItems: "flex-start"
            }}>
                <div style={{
                width: "44px",
                height: "44px",
                borderRadius: "8px",
                background: palette.surface2,
                borderWidth: "1px",
                borderColor: palette.hairline,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: "0"
              }}>
                  <ShareModeIcon mode={collection.mode} palette={palette} />
                </div>
                <div style={{
                minWidth: "0px"
              }}>
                  <span className="icedr-truncate" style={{
                  color: palette.ink,
                  fontSize: "24px",
                  lineHeight: "1.2",
                  fontWeight: "600"
                }}>
                    {collection.title}
                  </span>
                  <span style={{
                  color: palette.subtle,
                  marginTop: "8px"
                }}>
                    {t("share.sharedBy", {
                    owner: collection.owner,
                    count: collection.rootItems.length
                  })}
                  </span>
                </div>
              </div>
              <div style={{
              alignItems: "center",
              display: "flex",
              gap: "8px",
              flexWrap: "wrap"
            }}>
                <StatusPill palette={palette}>
                  {collection.rootItems.length} {t("share.items")}
                </StatusPill>
                <StatusPill palette={palette}>
                  {totalSize}
                </StatusPill>
                <StatusPill palette={palette}>
                  {expiresLabel}
                </StatusPill>
              </div>
            </div>
          </Surface>

          <VisitorShareBrowser activeItemId={accessItem?.id ?? null} allowDownload={registeredShare.allowDownload} allowPreview={registeredShare.allowPreview} collectionTitle={collection.title} currentFolder={currentFolder} folderId={folderId} goUp={goUp} locale={locale} onDownloadItem={item => requestVisitorAction(item, "download")} onOpenFolder={setFolderId} onPreviewItem={item => requestVisitorAction(item, "preview")} palette={palette} registeredShare={registeredShare} sourceItems={sourceItems} visibleItems={visibleItems} visibleListRef={visibleListRef} />
        </div>

      </div>

      <ShareAuthDialog action={accessAction} accessExperience={experience} authMethod={authMethod} code={code} accessItem={accessItem} email={email} locale={locale} accountConfigured={icaConfigured} busy={authBusy} onAccountAuth={authenticateAccount} onClose={() => setAuthOpen(false)} onEmailChange={setEmail} onMethodChange={selectAuthMethod} onSendCode={sendCode} onVerifyCode={verifyCode} onContinue={continueToDownload} onComplete={completeVisitorAction} open={authOpen} palette={palette} remaining={remaining} setCode={setCode} sourceItems={sourceItems} stage={stage} />
      <SharePreviewDialog accessSessionId={accessSessionId} onClose={() => setPreview(null)} open={Boolean(preview)} palette={palette} preview={preview} locale={locale} shareToken={registeredShare.token} />
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
  visibleItems: DriveItem[];
  visibleListRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations();
  const timeZone = useTimeZone();
  return <Surface palette={palette} className="icedr-r-min-height" style={{
    overflow: "hidden",
    flex: "1 1 auto",
    "--r-min-height-base": "360px",
    "--r-min-height-lg": "0px"
  } as React.CSSProperties}>
      <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "52px",
      paddingInline: "16px",
      borderBottomWidth: "1px",
      borderColor: palette.hairline
    }}>
        <div style={{
        alignItems: "center",
        display: "flex",
        gap: "8px",
        minWidth: "0px"
      }}>
          {folderId ? <ToolButton label={t("app.up")} palette={palette} onClick={goUp}>
              <LocalIcon name="arrow_up" size={16} />
            </ToolButton> : null}
          <span className="icedr-truncate" style={{
          color: palette.muted,
          fontWeight: "600"
        }}>
            {currentFolder?.name ?? collectionTitle}
          </span>
        </div>
        <StatusPill palette={palette}>{visibleItems.length}</StatusPill>
      </div>

      {visibleItems.length === 0 ? <div style={{
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
        </div> : <div ref={visibleListRef} style={{
      display: "flex",
      flexDirection: "column",
      gap: "0px"
    }}>
          {visibleItems.map(item => {
        const isFolder = getItemKind(item) === "folder";
        const canOpen = isFolder && collectShareDescendants(item, sourceItems).some(child => registeredShare.allowedItemIds.includes(child.id));
        const isActive = activeItemId === item.id;
        return <div key={item.id} data-motion-row className="icedr-has-hover" style={{
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
          background: isActive ? palette.selected : "transparent",
          boxShadow: isActive ? `inset 2px 0 0 ${palette.primary}` : "none",
          transition: "background-color var(--motion-base) var(--motion-ease), box-shadow var(--motion-base) var(--motion-ease)",
          "--hover-bg": palette.surface2,
          "--hover-box-shadow": `inset 2px 0 0 ${palette.primary}`
        } as React.CSSProperties}>
                <div style={{
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

                <div style={{
            alignItems: "center",
            display: "flex",
            gap: "8px",
            marginLeft: "12px",
            flexShrink: "0"
          }}>
                  <span className="icedr-r-display" style={{
              color: palette.subtle,
              fontSize: "12px",
              "--r-display-base": "none",
              "--r-display-sm": "block"
            } as React.CSSProperties}>
                    {formatFileSize(sumDriveItemSizes([item], sourceItems), locale)}
                  </span>
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
          background: palette.canvas,
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
function ShareAuthDialog({
  accessExperience,
  accessItem,
  action,
  accountConfigured,
  authMethod,
  busy,
  code,
  email,
  locale,
  onAccountAuth,
  onClose,
  onComplete,
  onContinue,
  onEmailChange,
  onMethodChange,
  onSendCode,
  onVerifyCode,
  open,
  palette,
  remaining,
  setCode,
  sourceItems,
  stage
}: {
  accessExperience: AccessPolicyExperience;
  accessItem: DriveItem | null;
  action: VisitorAccessAction;
  accountConfigured: boolean;
  authMethod: AuthMethod;
  busy: boolean;
  code: string;
  email: string;
  locale: Locale;
  onAccountAuth: (level?: VisitorLevel) => void;
  onClose: () => void;
  onComplete: () => void;
  onContinue: () => void;
  onEmailChange: (value: string) => void;
  onMethodChange: (method: AuthMethod) => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  open: boolean;
  palette: Palette;
  remaining: number;
  setCode: (value: string) => void;
  sourceItems: DriveItem[];
  stage: VisitorStage;
}) {
  const t = useTranslations();
  const experience: AccessPolicyExperience = {
    ...accessExperience,
    waitSeconds: remaining
  };
  const canSendCode = Boolean(accessItem) && emailPattern.test(email) && !busy;
  const canVerifyCode = Boolean(accessItem) && code.length === 6 && !busy;
  const actionLabel = action === "download" ? t("actions.download") : t("share.openPreview");
  return <Modal.Backdrop isOpen={open} onOpenChange={nextOpen => !nextOpen && onClose()} style={{
        background: "rgba(0, 0, 0, 0.48)"
      }}>
        <Modal.Container placement="center">
          <Modal.Dialog style={{
          background: palette.canvas,
          color: palette.ink,
          borderWidth: "1px",
          borderColor: palette.hairlineStrong,
          borderRadius: "8px",
          maxWidth: "420px",
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
                  {accessItem ? <ItemIcon item={accessItem} palette={palette} size={18} /> : <LocalIcon name={action === "download" ? "download" : "visible"} size={18} color={palette.primaryHover} />}
                  <div style={{
                  minWidth: "0px"
                }}>
                    <Modal.Heading className="icedr-truncate" style={{
                      fontWeight: "600"
                    }}>
                        {accessItem?.name ?? actionLabel}
                    </Modal.Heading>
                    <span style={{
                    color: palette.subtle,
                    fontSize: "12px",
                    marginTop: "4px"
                  }}>
                      {accessItem ? formatFileSize(sumDriveItemSizes([accessItem], sourceItems), locale) : actionLabel}
                    </span>
                  </div>
                </div>
                <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
                  <LocalIcon name="cross" size={17} />
                </ToolButton>
              </div>
            </Modal.Header>

            <Modal.Body style={{
            padding: "16px"
          }}>
              <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px"
            }}>
                <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}>
                  <span style={{
                  color: palette.ink,
                  fontWeight: "650"
                }}>{t("share.visitorAccessTitle")}</span>
                  <AuthStatusNotice palette={palette} status={{
                  message: t("share.visitorAccessHint"),
                  tone: "info"
                }} />
                </div>
                <SegmentedToolGroup
                  ariaLabel={`${t("share.accountLogin")} / ${t("share.temporaryEmail")}`}
                  onChange={onMethodChange}
                  options={[{
                    icon: <LocalIcon name="import" size={17} />,
                    label: t("share.accountLogin"),
                    value: "account"
                  }, {
                    icon: <LocalIcon name="mail" size={17} />,
                    label: t("share.temporaryEmail"),
                    value: "email"
                  }]}
                  palette={palette}
                  value={authMethod}
                />

                <MotionPresence show={authMethod === "account" && stage === "choose"} preset="surface">
                  <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}>
                    <AuthStatusNotice palette={palette} status={{
                    message: accountConfigured ? t("share.icaConfigured") : t("share.icaUnavailable"),
                    tone: accountConfigured ? "success" : "error"
                  }} />
                    <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: "8px"
                  }}>
                      <AuthPrimaryButton icon="key" palette={palette} disabled={!accountConfigured || busy} busy={busy} onClick={() => onAccountAuth("ica")}>
                        {t("share.useIcaIdentity")}
                      </AuthPrimaryButton>
                    </div>
                  </div>
                </MotionPresence>

                <MotionPresence show={authMethod === "email" && stage === "email"} preset="surface">
                  <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}>
                    <AuthField label={t("share.emailPrompt")} palette={palette} required>
                      <AuthInput value={email} onChange={event => onEmailChange(event.target.value)} placeholder={t("share.emailPlaceholder")} type="email" palette={palette} autoComplete="email" />
                    </AuthField>
                    <AuthPrimaryButton icon="mail" palette={palette} disabled={!canSendCode} busy={busy} onClick={onSendCode}>
                      {busy ? t("auth.working") : t("share.sendCode")}
                    </AuthPrimaryButton>
                  </div>
                </MotionPresence>

                <MotionPresence show={authMethod === "email" && stage === "code"} preset="surface">
                  <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}>
                    <AuthField label={t("share.codePrompt")} palette={palette} required>
                      <AuthInput value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" palette={palette} autoComplete="one-time-code" />
                    </AuthField>
                    <AuthPrimaryButton icon="key" palette={palette} disabled={!canVerifyCode} busy={busy} onClick={onVerifyCode}>
                      {busy ? t("auth.working") : t("share.verifyCode")}
                    </AuthPrimaryButton>
                  </div>
                </MotionPresence>

                <MotionPresence show={stage === "verified"} preset="surface">
                  <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}>
                    <AuthStatusNotice palette={palette} status={{
                    message: t("share.verificationSucceeded", {
                      identity: experience.label
                    }),
                    tone: "success"
                  }} />
                    <span style={{
                    color: palette.subtle,
                    fontSize: "12px"
                  }}>
                      {experience.waitSeconds > 0 ? t("share.nextWait", {
                      seconds: experience.waitSeconds
                    }) : t("share.ready")}
                    </span>
                    <span style={{
                    color: palette.subtle,
                    fontSize: "12px"
                  }}>
                      {t("share.speedValue", {
                      speed: experience.speedLabel
                    })} / {experience.sessionLabel}
                    </span>
                    <AuthPrimaryButton icon="download" palette={palette} onClick={onContinue}>
                      {t("share.continue")}
                    </AuthPrimaryButton>
                  </div>
                </MotionPresence>

                <MotionPresence show={stage === "waiting"} preset="surface">
                  <AuthStatusNotice palette={palette} status={{
                  message: t("share.preparing", {
                    seconds: remaining
                  }),
                  tone: "info"
                }} />
                </MotionPresence>

                <MotionPresence show={stage === "download"} preset="surface">
                  <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}>
                    <AuthStatusNotice palette={palette} status={{
                    message: experience.speedLabel === "Unlimited" ? t("share.ready") : t("share.speedValue", {
                      speed: experience.speedLabel
                    }),
                    tone: "success"
                  }} />
                    <AuthPrimaryButton icon={action === "download" ? "download" : "visible"} palette={palette} onClick={onComplete}>
                      {actionLabel}
                    </AuthPrimaryButton>
                  </div>
                </MotionPresence>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>;
}
function ShareModeIcon({
  mode,
  palette
}: {
  mode: ShareMode;
  palette: Palette;
}) {
  if (mode === "folder") return <LocalIcon name="folder" size={20} color={palette.primaryHover} />;
  if (mode === "multi-file") return <LocalIcon name="user_group" size={20} color={palette.primaryHover} />;
  return <LocalIcon name="link" size={20} color={palette.primaryHover} />;
}
function PolicyInput({
  align = "center",
  palette,
  ...props
}: React.ComponentProps<typeof Input> & {
  align?: "center" | "left";
  palette: Palette;
}) {
  return <Input {...props} className="icedr-r-width icedr-has-placeholder icedr-has-hover icedr-has-focus" style={{
    height: "38px",
    "--r-width-base": "100%",
    "--r-width-md": "168px",
    textAlign: align,
    paddingInline: "16px",
    borderRadius: "8px",
    background: palette.surface2,
    borderWidth: "1px",
    borderColor: palette.hairline,
    color: palette.ink,
    fontWeight: "600",
    "--placeholder-color": palette.tertiary,
    transition: "background-color var(--motion-base) var(--motion-ease), border-color var(--motion-base) var(--motion-ease), box-shadow var(--motion-base) var(--motion-ease)",
    "--hover-border-color": palette.hairlineStrong,
    "--focus-border-color": palette.primary,
    "--focus-box-shadow": `0 0 0 1px ${palette.focusRing}`
  } as React.CSSProperties} />;
}
function Metric({
  label,
  value,
  palette
}: {
  label: string;
  value: string;
  palette: Palette;
}) {
  return <div className="icedr-r-border-right-width icedr-last-border-reset" style={{
    padding: "16px",
    "--r-border-right-width-base": "0px",
    "--r-border-right-width-md": "1px",
    borderColor: palette.hairline,
    "--last-border-right-width": "0px"
  } as React.CSSProperties}>
      <span style={{
      color: palette.subtle,
      fontSize: "12px"
    }}>
        {label}
      </span>
      <span className="icedr-truncate" style={{
      color: palette.ink,
      fontWeight: "600",
      marginTop: "4px"
    }}>
        {value}
      </span>
    </div>;
}

