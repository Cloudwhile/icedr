"use client";

import { TextArea } from "@heroui/react";
import { useRouter } from "@/compat/navigation";
import { useTranslations } from "@/i18n/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MotionPresence } from "@/components/ui/motion";
import { useUnsavedChangesSection } from "@/components/admin/use-unsaved-changes-section";
import {
  showAppToast,
  type AppToastTone,
} from "@/components/ui/app-toast-store";
import { palettes, type Palette, type ThemeMode } from "@/features/file/model";
import {
  defaultExternalSharePolicy,
  policyFromWorkspaceSettings,
} from "@/features/share/policy";
import {
  fetchAuthSettings,
  fetchWorkspaceShareSettings,
  updateWorkspaceShareSettings,
  type AuthSettings,
  type WorkspaceShareSettings,
} from "@/lib/drive-api";
import { ThemeActions } from "./drive-shell";
import { LocalIcon, ToolButton } from "./drive-primitives";
import {
  AdminSection,
  IdentityPolicyRow,
  InlineConfigPanel,
  PolicyCheck,
  PolicyInput,
  RadioRow,
  SettingActionBar,
  SettingItem,
  SettingStatusLine,
} from "./external-share-admin-primitives";
import {
  buildAnonymousPolicyExperience,
  buildOAuthPolicyExperience,
  type AnonymousAccessPolicy,
} from "./external-share-admin-policy";

type WorkspaceShareForm = Omit<
  WorkspaceShareSettings,
  "workspaceId" | "updatedAt"
>;
type UndoActions = Record<string, () => void>;

function workspaceSettingsToForm(
  settings: WorkspaceShareSettings,
): WorkspaceShareForm {
  return {
    anonymousAccess: settings.anonymousAccess,
    emailRule: settings.emailRule,
    allowedDomains: settings.allowedDomains,
    defaultExpiresDays: settings.defaultExpiresDays,
    maxExpiresDays: settings.maxExpiresDays,
    allowPermanent: settings.allowPermanent,
    audit: settings.audit,
  };
}

function settingChanged<T>(left: T, right: T) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function ExternalShareAdminSettingsPage({
  embedded = false,
  setThemeMode,
  themeMode,
  workspaceId = null,
}: {
  embedded?: boolean;
  setThemeMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  themeMode: ThemeMode;
  workspaceId?: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const palette = palettes[themeMode];

  if (embedded) {
    return (
      <div
        className="external-share-admin-embedded"
        style={{
          background: "transparent",
          color: palette.ink,
          fontSize: "14px",
          letterSpacing: "0px",
        }}
      >
        <div className="external-share-admin-embedded-inner">
          {workspaceId ? (
            <GuardedExternalShareAdminSettingsPanel
              compact
              key={workspaceId}
              palette={palette}
              workspaceId={workspaceId}
            />
          ) : (
            <WorkspaceScopeRequired />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "transparent",
        color: palette.ink,
        fontSize: "14px",
        height: "100dvh",
        letterSpacing: "0px",
        minHeight: "100dvh",
        overflow: "hidden",
      }}
    >
      <div
        className="icedr-r-padding-inline"
        style={
          {
            "--r-padding-inline-base": "12px",
            "--r-padding-inline-md": "24px",
            alignItems: "center",
            borderBottomWidth: "1px",
            borderColor: palette.hairline,
            display: "flex",
            height: "56px",
            justifyContent: "space-between",
          } as React.CSSProperties
        }
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "12px",
            minWidth: "0px",
          }}
        >
          <ToolButton
            label={t("app.up")}
            palette={palette}
            onClick={() => router.push("/")}
          >
            <LocalIcon name="arrow_left" size={17} />
          </ToolButton>
          <LocalIcon name="link" size={18} color={palette.secure} />
          <div style={{ minWidth: "0px" }}>
            <span
              className="icedr-truncate"
              style={{ color: palette.ink, fontWeight: "600" }}
            >
              {t("admin.externalLinkPolicy")}
            </span>
            <span
              className="icedr-truncate"
              style={{ color: palette.subtle, fontSize: "12px" }}
            >
              {t("admin.externalLinkPolicySubtitle")}
            </span>
          </div>
        </div>
        <ThemeActions
          palette={palette}
          setThemeMode={setThemeMode}
          themeMode={themeMode}
        />
      </div>

      <div
        className="icedr-r-padding-inline"
        style={
          {
            "--r-padding-inline-base": "12px",
            "--r-padding-inline-md": "24px",
            WebkitOverflowScrolling: "touch",
            height: "calc(100dvh - 56px)",
            minHeight: "0px",
            overflowY: "auto",
            overscrollBehaviorY: "contain",
            paddingBlock: "20px",
          } as React.CSSProperties
        }
      >
        <div style={{ maxWidth: "1180px" }}>
          {workspaceId ? (
            <ExternalShareAdminSettingsPanel
              key={workspaceId}
              palette={palette}
              workspaceId={workspaceId}
            />
          ) : (
            <WorkspaceScopeRequired />
          )}
        </div>
      </div>
    </div>
  );
}

export function ExternalShareAdminSettingsPanel({
  compact = false,
  guardUnsavedChanges = false,
  palette,
  workspaceId,
}: {
  compact?: boolean;
  guardUnsavedChanges?: boolean;
  palette: Palette;
  workspaceId: string;
}) {
  const t = useTranslations();
  const [anonymousPolicy, setAnonymousPolicy] =
    useState<AnonymousAccessPolicy>("email-required");
  const [emailRule, setEmailRule] = useState<"any" | "domains">("any");
  const [allowPermanent, setAllowPermanent] = useState(false);
  const [audit, setAudit] = useState({
    anomaly: true,
    alerts: true,
    downloads: true,
    ip: true,
    userAgent: true,
  });
  const [defaultExpiresDays, setDefaultExpiresDays] = useState("7");
  const [maxExpiresDays, setMaxExpiresDays] = useState("30");
  const [domains, setDomains] = useState("");
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [undoActions, setUndoActions] = useState<UndoActions>({});
  const [savedWorkspaceSnapshot, setSavedWorkspaceSnapshot] =
    useState<WorkspaceShareForm | null>(null);
  const savedWorkspaceRef = useRef<WorkspaceShareForm | null>(null);

  const showToast = useCallback(
    (message: string, tone: AppToastTone = "success") => {
      showAppToast({ title: message, tone });
    },
    [],
  );

  const applyWorkspaceShareSettings = useCallback(
    (settings: WorkspaceShareSettings) => {
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
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchWorkspaceShareSettings(workspaceId),
      fetchAuthSettings(),
    ])
      .then(([shareSettings, auth]) => {
        if (cancelled) return;
        applyWorkspaceShareSettings(shareSettings);
        setAuthSettings(auth);
      })
      .catch(() => {
        if (!cancelled) showToast(t("admin.loadFailed"), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [applyWorkspaceShareSettings, showToast, t, workspaceId]);

  const parseDomainsValue = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/^@/, ""));
  const parseDomains = () => parseDomainsValue(domains);

  const clearUndoAction = (key: string) =>
    setUndoActions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  const setUndoAction = (key: string, action: () => void) => {
    setUndoActions((current) => ({ ...current, [key]: action }));
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

  const currentWorkspaceForm = (
    overrides: Partial<WorkspaceShareForm> = {},
  ): WorkspaceShareForm => ({
    anonymousAccess: anonymousPolicy,
    audit,
    allowPermanent,
    allowedDomains: parseDomains(),
    defaultExpiresDays: Math.max(1, Number(defaultExpiresDays) || 1),
    emailRule,
    maxExpiresDays: Math.max(1, Number(maxExpiresDays) || 1),
    ...overrides,
  });

  const saveWorkspaceForm = (
    key: string,
    next: WorkspaceShareForm,
    previous: WorkspaceShareForm,
    recordUndo = true,
  ) => {
    if (saving || !workspaceId || !settingChanged(previous, next)) return;
    applyWorkspaceForm(next);
    setSaving(true);
    void updateWorkspaceShareSettings(workspaceId, next)
      .then((settings) => {
        const saved = workspaceSettingsToForm(settings);
        savedWorkspaceRef.current = saved;
        setSavedWorkspaceSnapshot(saved);
        applyWorkspaceForm(saved);
        if (recordUndo)
          setUndoAction(key, () =>
            saveWorkspaceForm(key, previous, saved, false),
          );
        else clearUndoAction(key);
        showToast(t("admin.saved"));
      })
      .catch(() => {
        applyWorkspaceForm(previous);
        showToast(t("admin.saveFailed"), "error");
      })
      .finally(() => setSaving(false));
  };

  const commitWorkspaceForm = (
    key: string,
    overrides: Partial<WorkspaceShareForm> = {},
  ) => {
    const previous = savedWorkspaceRef.current ?? currentWorkspaceForm();
    const next = currentWorkspaceForm(overrides);
    saveWorkspaceForm(key, next, previous);
  };

  const savedWorkspace = savedWorkspaceSnapshot;
  const domainDirty = Boolean(
    savedWorkspace &&
    (savedWorkspace.emailRule !== emailRule ||
      settingChanged(savedWorkspace.allowedDomains, parseDomains())),
  );
  const resetDomainDraft = () => {
    if (!savedWorkspaceSnapshot) return;
    setEmailRule(savedWorkspaceSnapshot.emailRule);
    setDomains(savedWorkspaceSnapshot.allowedDomains.join("\n"));
  };
  const saveDomainDraft = async () => {
    const previous = savedWorkspaceRef.current;
    if (!previous || !domainDirty || saving) return;
    const next = currentWorkspaceForm({
      allowedDomains: parseDomains(),
      emailRule: "domains",
    });
    setSaving(true);
    try {
      const settings = await updateWorkspaceShareSettings(workspaceId, next);
      applyWorkspaceShareSettings(settings);
      setUndoAction("emailRule", () =>
        saveWorkspaceForm("emailRule", previous, next, false),
      );
      showToast(t("admin.saved"));
    } catch (error) {
      applyWorkspaceForm(previous);
      showToast(t("admin.saveFailed"), "error");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="external-share-admin-settings-panel"
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      {guardUnsavedChanges ? (
        <ExternalShareDomainGuard
          id={`external-share-domains:${workspaceId}`}
          isDirty={domainDirty}
          onDiscard={resetDomainDraft}
          onSave={saveDomainDraft}
        />
      ) : null}
      {!compact ? (
        <>
          <div
            className="external-share-admin-kicker"
            style={{
              alignItems: "center",
              color: palette.subtle,
              display: "flex",
              fontSize: "12px",
              gap: "8px",
            }}
          >
            <LocalIcon name="link" size={14} color={palette.secure} />
            <span>{t("admin.externalShareBreadcrumb")}</span>
          </div>

          <div className="external-share-admin-summary">
            <SettingStatusLine icon="info" palette={palette} tone="neutral">
              {t("admin.externalSharePolicySummary")}
            </SettingStatusLine>
          </div>
        </>
      ) : null}

      <AdminSection
        className="external-share-section-anonymous"
        description={t("admin.anonymousPolicyDescription")}
        icon={<LocalIcon name="earth" size={16} />}
        palette={palette}
        title={t("admin.anonymousPolicy")}
      >
        <SettingItem
          palette={palette}
          undoAction={
            anonymousPolicy === "blocked"
              ? undoActions.anonymousPolicy
              : undefined
          }
        >
          <RadioRow
            active={anonymousPolicy === "blocked"}
            label={t("admin.blockAnonymous")}
            onClick={() =>
              commitWorkspaceForm("anonymousPolicy", {
                anonymousAccess: "blocked",
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem
          palette={palette}
          undoAction={
            anonymousPolicy === "email-required"
              ? undoActions.anonymousPolicy
              : undefined
          }
        >
          <RadioRow
            active={anonymousPolicy === "email-required"}
            label={t("admin.emailRequiredAnonymous")}
            onClick={() =>
              commitWorkspaceForm("anonymousPolicy", {
                anonymousAccess: "email-required",
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem
          palette={palette}
          undoAction={
            anonymousPolicy === "public"
              ? undoActions.anonymousPolicy
              : undefined
          }
        >
          <RadioRow
            active={anonymousPolicy === "public"}
            label={t("admin.publicAnonymous")}
            onClick={() =>
              commitWorkspaceForm("anonymousPolicy", {
                anonymousAccess: "public",
              })
            }
            palette={palette}
            tone="risk"
          />
        </SettingItem>
      </AdminSection>

      <AdminSection
        className="external-share-section-identity"
        description={t("admin.identityPolicyDescription")}
        icon={<LocalIcon name="user_check" size={16} />}
        palette={palette}
        title={t("admin.identityPolicy")}
      >
        <IdentityPolicyRow
          experience={buildAnonymousPolicyExperience(
            anonymousPolicy,
            policyFromWorkspaceSettings({
              workspaceId: workspaceId ?? "",
              anonymousAccess: anonymousPolicy,
              emailRule,
              allowedDomains: parseDomains(),
              defaultExpiresDays:
                Number(defaultExpiresDays) ||
                defaultExternalSharePolicy.expiresValue,
              maxExpiresDays: Number(maxExpiresDays) || 30,
              allowPermanent,
              audit,
              updatedAt: "",
            }),
            t,
          )}
          palette={palette}
        />
        <IdentityPolicyRow
          experience={buildOAuthPolicyExperience(authSettings, t)}
          palette={palette}
        />
      </AdminSection>

      <AdminSection
        className="external-share-section-email"
        description={t("admin.emailRulesDescription")}
        icon={<LocalIcon name="mention" size={16} />}
        palette={palette}
        title={t("admin.emailRules")}
      >
        <SettingItem
          palette={palette}
          undoAction={emailRule === "any" ? undoActions.emailRule : undefined}
        >
          <RadioRow
            active={emailRule === "any"}
            label={t("admin.anyEmail")}
            onClick={() =>
              commitWorkspaceForm("emailRule", {
                allowedDomains: [],
                emailRule: "any",
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem
          palette={palette}
          undoAction={
            emailRule === "domains" && !domainDirty
              ? undoActions.emailRule
              : undefined
          }
        >
          <RadioRow
            active={emailRule === "domains"}
            label={t("admin.specifiedDomains")}
            onClick={() => setEmailRule("domains")}
            palette={palette}
          />
        </SettingItem>
        <MotionPresence show={emailRule === "domains"} preset="surface">
          <InlineConfigPanel palette={palette}>
            <TextArea
              aria-label={t("admin.specifiedDomains")}
              className="icedr-has-focus"
              value={domains}
              onChange={(event) => setDomains(event.target.value)}
              style={
                {
                  "--focus-border-color": palette.primary,
                  "--focus-box-shadow": `0 0 0 1px ${palette.focusRing}`,
                  background: "transparent",
                  borderColor: palette.hairline,
                  color: palette.ink,
                  minHeight: "84px",
                } as React.CSSProperties
              }
            />
            <SettingActionBar
              canReset={
                domainDirty ||
                Boolean(undoActions.emailRule || undoActions.allowedDomains)
              }
              canSave={domainDirty}
              onReset={
                domainDirty
                  ? resetDomainDraft
                  : (undoActions.emailRule ?? undoActions.allowedDomains)
              }
              onSave={() => void saveDomainDraft()}
              palette={palette}
              resetLabel={
                domainDirty ? t("admin.revertChanges") : t("admin.undo")
              }
              saveLabel={t("admin.save")}
              saving={saving}
            />
          </InlineConfigPanel>
        </MotionPresence>
      </AdminSection>

      <AdminSection
        className="external-share-section-lifecycle"
        description={t("admin.lifecycleDescription")}
        icon={<LocalIcon name="calendar" size={16} />}
        palette={palette}
        title={t("admin.lifecycle")}
      >
        <div
          className="icedr-r-grid-template-columns"
          style={
            {
              "--r-grid-template-columns-base": "1fr",
              "--r-grid-template-columns-md": "160px 1fr",
              display: "grid",
              gap: "12px",
            } as React.CSSProperties
          }
        >
          <span style={{ color: palette.subtle }}>
            {t("admin.defaultExpiry")}
          </span>
          <SettingItem
            palette={palette}
            undoAction={undoActions.defaultExpiresDays}
          >
            <div style={{ alignItems: "center", display: "flex" }}>
              <PolicyInput
                inputMode="numeric"
                palette={palette}
                value={defaultExpiresDays}
                onBlur={() =>
                  commitWorkspaceForm("defaultExpiresDays", {
                    defaultExpiresDays: Math.max(
                      1,
                      Number(defaultExpiresDays) || 1,
                    ),
                  })
                }
                onChange={(event) =>
                  setDefaultExpiresDays(event.target.value.replace(/\D/g, ""))
                }
              />
              <span style={{ color: palette.muted }}>
                {t("share.units.days")}
              </span>
            </div>
          </SettingItem>
          <span style={{ color: palette.subtle }}>
            {t("admin.maximumExpiry")}
          </span>
          <SettingItem
            palette={palette}
            undoAction={undoActions.maxExpiresDays}
          >
            <div style={{ alignItems: "center", display: "flex" }}>
              <PolicyInput
                inputMode="numeric"
                palette={palette}
                value={maxExpiresDays}
                onBlur={() =>
                  commitWorkspaceForm("maxExpiresDays", {
                    maxExpiresDays: Math.max(1, Number(maxExpiresDays) || 1),
                  })
                }
                onChange={(event) =>
                  setMaxExpiresDays(event.target.value.replace(/\D/g, ""))
                }
              />
              <span style={{ color: palette.muted }}>
                {t("share.units.days")}
              </span>
            </div>
          </SettingItem>
        </div>
        <SettingItem palette={palette} undoAction={undoActions.allowPermanent}>
          <PolicyCheck
            checked={allowPermanent}
            label={t("admin.allowPermanent")}
            onToggle={() =>
              commitWorkspaceForm("allowPermanent", {
                allowPermanent: !allowPermanent,
              })
            }
            palette={palette}
          />
        </SettingItem>
      </AdminSection>

      <AdminSection
        className="external-share-section-audit"
        description={t("admin.securityAuditDescription")}
        icon={<LocalIcon name="shield" size={16} />}
        palette={palette}
        title={t("admin.securityAudit")}
      >
        <SettingItem palette={palette} undoAction={undoActions.auditIp}>
          <PolicyCheck
            checked={audit.ip}
            label={t("admin.recordIp")}
            onToggle={() =>
              commitWorkspaceForm("auditIp", {
                audit: { ...audit, ip: !audit.ip },
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditUserAgent}>
          <PolicyCheck
            checked={audit.userAgent}
            label={t("admin.recordUserAgent")}
            onToggle={() =>
              commitWorkspaceForm("auditUserAgent", {
                audit: { ...audit, userAgent: !audit.userAgent },
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditDownloads}>
          <PolicyCheck
            checked={audit.downloads}
            label={t("admin.recordDownloads")}
            onToggle={() =>
              commitWorkspaceForm("auditDownloads", {
                audit: { ...audit, downloads: !audit.downloads },
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditAnomaly}>
          <PolicyCheck
            checked={audit.anomaly}
            label={t("admin.anomalyDetection")}
            onToggle={() =>
              commitWorkspaceForm("auditAnomaly", {
                audit: { ...audit, anomaly: !audit.anomaly },
              })
            }
            palette={palette}
          />
        </SettingItem>
        <SettingItem palette={palette} undoAction={undoActions.auditAlerts}>
          <PolicyCheck
            checked={audit.alerts}
            label={t("admin.riskAlerts")}
            onToggle={() =>
              commitWorkspaceForm("auditAlerts", {
                audit: { ...audit, alerts: !audit.alerts },
              })
            }
            palette={palette}
          />
        </SettingItem>
      </AdminSection>
    </div>
  );
}

function GuardedExternalShareAdminSettingsPanel({
  compact,
  palette,
  workspaceId,
}: {
  compact?: boolean;
  palette: Palette;
  workspaceId: string;
}) {
  return (
    <ExternalShareAdminSettingsPanel
      compact={compact}
      guardUnsavedChanges
      palette={palette}
      workspaceId={workspaceId}
    />
  );
}

function ExternalShareDomainGuard({
  id,
  isDirty,
  onDiscard,
  onSave,
}: {
  id: string;
  isDirty: boolean;
  onDiscard: () => void;
  onSave: () => Promise<void>;
}) {
  useUnsavedChangesSection({ id, isDirty, onDiscard, onSave });
  return null;
}

function WorkspaceScopeRequired() {
  const t = useTranslations();
  return (
    <div className="admin-inline-alert" role="alert">
      <span>
        <LocalIcon name="info" size={16} />
        {t("admin.externalShareWorkspaceScopeRequired")}
      </span>
    </div>
  );
}
