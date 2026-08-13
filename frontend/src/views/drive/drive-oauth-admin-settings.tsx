"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUnsavedChangesSection } from "@/components/admin/use-unsaved-changes-section";
import { LdrsLoadingState } from "@/components/common/ui/loading-state";
import {
  OAuthProviderGroup,
  OAuthSummary,
} from "@/components/oauth/oauth-admin-parts";
import {
  OAuthProviderDialog,
  type OAuthEditorMode,
} from "@/components/oauth/oauth-provider-dialog";
import {
  AppDialogBody,
  AppDialogHeader,
  AppDialogShell,
  AppDialogTitle,
} from "@/components/ui/app-dialog-shell";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  showAppToast,
  type AppToastTone,
} from "@/components/ui/app-toast-store";
import {
  createOAuthDraft,
  getOAuthProviderTemplate,
  oauthProviderTemplates,
  toOAuthProviderInput,
  validateOAuthDraft,
  type OAuthProviderTemplate,
} from "@/extensions/oauth/provider-catalog";
import { copyTextToClipboard } from "@/features/file/actions";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  activateOAuthProvider,
  createOAuthProvider,
  deleteOAuthProvider,
  fetchAuthSettings,
  fetchOAuthProviders,
  getDriveApiErrorMessage,
  testOAuthProvider,
  updateAuthSettings,
  updateOAuthProvider,
  type AuthSettings,
  type OAuthConnectionTestResult,
  type OAuthProviderKey,
  type OAuthSettings,
} from "@/lib/drive-api";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

type OAuthStatusFilter = "all" | "active" | "configured" | "draft";
type OAuthConfirmation =
  | { kind: "clear-secret" }
  | { kind: "delete"; provider: OAuthSettings };
type OAuthEditorSnapshot = {
  draft: OAuthSettings;
  secret: string;
  secretCleared: boolean;
};

export function OAuthAdminSettingsPage({ palette }: { palette: Palette }) {
  const t = useTranslations();
  const systemBaseUrl = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    [],
  );
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<OAuthProviderKey>>(
    () => new Set(),
  );
  const [confirmation, setConfirmation] = useState<OAuthConfirmation | null>(
    null,
  );
  const [draft, setDraft] = useState<OAuthSettings | null>(null);
  const [enablePromptOpen, setEnablePromptOpen] = useState(false);
  const [editorBaseline, setEditorBaseline] =
    useState<OAuthEditorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<OAuthEditorMode>("create");
  const [providerFilter, setProviderFilter] = useState<
    OAuthProviderKey | "all"
  >("all");
  const [providers, setProviders] = useState<OAuthSettings[]>([]);
  const [query, setQuery] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [secretCleared, setSecretCleared] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OAuthStatusFilter>("all");
  const [testResult, setTestResult] = useState<OAuthConnectionTestResult | null>(
    null,
  );

  const showToast = useCallback(
    (message: string, tone: AppToastTone = "success") =>
      showAppToast({ title: message, tone }),
    [],
  );
  const refresh = useCallback(async (preferredId?: string) => {
    const [providerResponse, authResponse] = await Promise.all([
      fetchOAuthProviders(),
      fetchAuthSettings(),
    ]);
    setProviders(providerResponse.providers);
    setAuthSettings(authResponse);
    if (preferredId) {
      const next = providerResponse.providers.find(
        (provider) => provider.id === preferredId,
      );
      if (next) setDraft(next);
    }
    return providerResponse;
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      void refresh()
        .catch((error) => {
          if (!cancelled)
            showToast(
              getDriveApiErrorMessage(error, t, {
                fallbackKey: "admin.loadFailed",
                scope: "form",
              }),
              "error",
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, showToast, t]);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return oauthProviderTemplates
      .filter(
        (template) =>
          providerFilter === "all" || template.key === providerFilter,
      )
      .map((template) => ({
        template,
        rows: providers
          .filter((provider) => provider.providerKey === template.key)
          .filter((provider) => matchesStatus(provider, statusFilter))
          .filter((provider) => matchesQuery(provider, normalizedQuery)),
      }))
      .filter((group) => group.rows.length > 0 || providerFilter !== "all");
  }, [providerFilter, providers, query, statusFilter]);

  const summary = useMemo(
    () => ({
      active: providers.filter(
        (provider) => provider.enabled && provider.configured,
      ).length,
      configuredProviders: new Set(
        providers
          .filter((provider) => provider.configured)
          .map((provider) => provider.providerKey),
      ).size,
      draft: providers.filter((provider) => !provider.configured).length,
    }),
    [providers],
  );

  const resetEditor = () => {
    setEditorBaseline(null);
    setDraft(null);
    setSecret("");
    setSecretCleared(false);
    setShowSecret(false);
    setSavingKey(null);
    setTestResult(null);
  };
  const openCreate = (providerKey: OAuthProviderKey = "google") => {
    const nextDraft = createOAuthDraft(
      getOAuthProviderTemplate(providerKey),
      systemBaseUrl,
    );
    setModalMode("create");
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setEditorBaseline(createEditorSnapshot(nextDraft));
    setDraft(nextDraft);
  };
  const openEdit = (provider: OAuthSettings) => {
    setModalMode("edit");
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setEditorBaseline(createEditorSnapshot(provider));
    setDraft(cloneOAuthDraft(provider));
  };
  const openDuplicate = (provider: OAuthSettings) => {
    const nextDraft = {
      ...provider,
      allowedEmailDomains: [...(provider.allowedEmailDomains ?? [])],
      id: "",
      displayName: `${provider.displayName} ${t("actions.copy")}`,
      enabled: false,
      clientSecretConfigured: false,
      configured: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    setModalMode("duplicate");
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setEditorBaseline(createEditorSnapshot(nextDraft));
    setDraft(nextDraft);
  };
  const selectTemplate = (template: OAuthProviderTemplate) => {
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setDraft((current) => {
      const next = createOAuthDraft(template, systemBaseUrl);
      return current?.id
        ? {
            ...next,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
          }
        : next;
    });
  };
  const providerInput = (enabled: boolean) => {
    if (!draft) return null;
    return {
      ...toOAuthProviderInput(draft, secret, enabled),
      ...(secretCleared ? { clientSecret: "" } : {}),
    };
  };

  const testDraft = () => {
    const input = providerInput(false);
    if (!draft || !input) return;
    const validation = validateOAuthDraft(draft, secret);
    if (!validation.valid) {
      showToast(t(validation.errorKey), "error");
      return;
    }
    setSavingKey("test");
    setTestResult(null);
    void testOAuthProvider(input)
      .then((result) => {
        setTestResult(result);
        showToast(
          result.ok ? t("admin.oauthTestPassed") : t("admin.oauthTestFailed"),
          result.ok ? "success" : "error",
        );
      })
      .catch((error) =>
        showToast(
          getDriveApiErrorMessage(error, t, {
            fallbackKey: "admin.oauthTestFailed",
            scope: "form",
          }),
          "error",
        ),
      )
      .finally(() => setSavingKey(null));
  };

  const persistDraft = async (enabled: boolean) => {
    const nextEnabled =
      enabled || (modalMode === "edit" && draft?.enabled === true);
    const input = providerInput(nextEnabled);
    if (!draft || !input) throw new Error("OAuth editor is not open");
    const validation = validateOAuthDraft(draft, secret);
    if (nextEnabled && !validation.valid) {
      showToast(t(validation.errorKey), "error");
      throw new Error(validation.errorKey);
    }
    setSavingKey(enabled ? "activate" : "save");
    const request =
      modalMode === "edit"
        ? updateOAuthProvider(draft.id, input)
        : createOAuthProvider(input);
    try {
      const provider = await request;
      await refresh(provider.id);
      showToast(enabled ? t("admin.oauthActivated") : t("admin.saved"));
      resetEditor();
      if (enabled && authSettings && !authSettings.oauthEnabled) {
        setEnablePromptOpen(true);
      }
    } catch (error) {
      showToast(
          getDriveApiErrorMessage(error, t, {
            fallbackKey: "admin.saveFailed",
            scope: "form",
          }),
          "error",
        );
      throw error;
    } finally {
      setSavingKey(null);
    }
  };
  const saveDraft = (enabled: boolean) => {
    void persistDraft(enabled).catch(() => undefined);
  };
  const discardEditorDraft = () => {
    const baseline = editorBaseline;
    if (!baseline) return;
    setDraft(cloneOAuthDraft(baseline.draft));
    setSecret(baseline.secret);
    setSecretCleared(baseline.secretCleared);
    setShowSecret(false);
    setTestResult(null);
  };
  const editorDirty = isOAuthEditorDirty(
    draft,
    editorBaseline,
    secret,
    secretCleared,
  );

  useUnsavedChangesSection({
    id: "oauth-provider-editor",
    isDirty: editorDirty,
    onDiscard: discardEditorDraft,
    onSave: () => persistDraft(false),
  });

  const setProviderActive = (provider: OAuthSettings, enabled: boolean) => {
    const key = `${enabled ? "activate" : "deactivate"}:${provider.id}`;
    setSavingKey(key);
    const request = enabled
      ? activateOAuthProvider(provider.id)
      : updateOAuthProvider(provider.id, { enabled: false });
    void request
      .then((next) => refresh(next.id))
      .then(() => {
        showToast(
          enabled ? t("admin.oauthActivated") : t("admin.oauthDeactivated"),
        );
        if (enabled && authSettings && !authSettings.oauthEnabled)
          setEnablePromptOpen(true);
      })
      .catch((error) =>
        showToast(
          getDriveApiErrorMessage(error, t, {
            fallbackKey: "admin.saveFailed",
            scope: "form",
          }),
          "error",
        ),
      )
      .finally(() => setSavingKey(null));
  };

  const enableGlobalOAuth = () => {
    if (!authSettings) return;
    setSavingKey("global-auth");
    void updateAuthSettings({
      localEnabled: authSettings.localEnabled,
      oauthEnabled: true,
      passkeyEnabled: authSettings.passkeyEnabled,
      minimumAuthenticationMethods:
        authSettings.minimumAuthenticationMethods,
    })
      .then((next) => {
        setAuthSettings(next);
        setEnablePromptOpen(false);
        showToast(t("admin.oauthGlobalEnabled"));
      })
      .catch((error) =>
        showToast(
          getDriveApiErrorMessage(error, t, {
            fallbackKey: "admin.saveFailed",
            scope: "form",
          }),
          "error",
        ),
      )
      .finally(() => setSavingKey(null));
  };

  const removeProvider = (provider: OAuthSettings) => {
    setConfirmation({ kind: "delete", provider });
  };

  const protectedActiveProviderId =
    authSettings?.oauthEnabled &&
    !authSettings.localEnabled &&
    !authSettings.passkeyEnabled &&
    summary.active === 1
      ? providers.find((provider) => provider.enabled && provider.configured)?.id
      : undefined;

  const confirmSensitiveAction = () => {
    if (!confirmation) return;
    if (confirmation.kind === "clear-secret") {
      setSecret("");
      setSecretCleared(true);
      setTestResult(null);
      setDraft((current) =>
        current ? { ...current, clientSecretConfigured: false } : current,
      );
      setConfirmation(null);
      return;
    }
    const { provider } = confirmation;
    setSavingKey(`delete:${provider.id}`);
    void deleteOAuthProvider(provider.id)
      .then(() => refresh())
      .then(() => showToast(t("admin.oauthDeleted")))
      .catch((error) =>
        showToast(
          getDriveApiErrorMessage(error, t, {
            fallbackKey: "admin.saveFailed",
            scope: "form",
          }),
          "error",
        ),
      )
      .finally(() => {
        setSavingKey(null);
        setConfirmation(null);
      });
  };

  if (loading)
    return (
      <div className="admin-loading-panel">
        <LdrsLoadingState
          label={t("app.loading")}
          palette={palette}
          size={34}
        />
      </div>
    );

  return (
    <section
      className="drive-system-settings drive-oauth-admin"
      aria-label={t("admin.oauthSettings")}
    >
      <div className="drive-system-settings-main drive-oauth-admin-main">
        <h1 className="icedr-sr-only">{t("admin.oauthSettings")}</h1>
        <div className="drive-oauth-toolbar">
          <div className="drive-oauth-admin-overview">
            <div className="drive-oauth-overview-actions">
              <ToolButton
                label={t("admin.addOAuth")}
                palette={palette}
                onClick={() => openCreate()}
                tone="accent"
                visual="surface"
              >
                <LocalIcon name="plus" size={18} />
              </ToolButton>
              <StatusPill
                palette={palette}
                tone={authSettings?.oauthEnabled ? "secure" : "risk"}
              >
                {authSettings?.oauthEnabled
                  ? t("admin.oauthGlobalEnabled")
                  : t("admin.oauthGlobalDisabled")}
              </StatusPill>
              <StatusPill
                palette={palette}
                tone={summary.active > 0 ? "secure" : "risk"}
              >
                {summary.active > 0
                  ? t("admin.oauthActiveProviderCount", {
                      count: summary.active,
                    })
                  : t("admin.oauthNoActiveProvider")}
              </StatusPill>
              {authSettings &&
              !authSettings.oauthEnabled &&
              summary.active > 0 ? (
                <ToolButton
                  label={t("admin.oauthEnableGlobalTitle")}
                  onClick={() => setEnablePromptOpen(true)}
                  palette={palette}
                  size="sm"
                  tone="success"
                  visual="surface"
                >
                  <LocalIcon name="tick" size={16} />
                </ToolButton>
              ) : null}
            </div>
            <OAuthSummary summary={summary} />
          </div>
          <div className="drive-oauth-filterbar">
            <AppSelect
              aria-label={t("admin.oauthProvider")}
              onChange={(event) =>
                setProviderFilter(
                  event.target.value as OAuthProviderKey | "all",
                )
              }
              options={[
                { label: t("admin.oauthAllProviders"), value: "all" },
                ...oauthProviderTemplates.map((template) => ({
                  label: template.displayName,
                  value: template.key,
                })),
              ]}
              palette={palette}
              value={providerFilter}
            />
            <AppSelect
              aria-label={t("admin.oauthStatus")}
              onChange={(event) =>
                setStatusFilter(event.target.value as OAuthStatusFilter)
              }
              options={[
                { label: t("admin.oauthStatusAll"), value: "all" },
                { label: t("admin.oauthActive"), value: "active" },
                { label: t("settings.configured"), value: "configured" },
                { label: t("admin.oauthDraft"), value: "draft" },
              ]}
              palette={palette}
              value={statusFilter}
            />
            <div className="drive-oauth-search-field">
              <LocalIcon name="search" size={15} />
              <AppInput
                aria-label={t("admin.oauthSearch")}
                onChange={(event) => setQuery(event.target.value)}
                palette={palette}
                placeholder={t("admin.oauthSearchPlaceholder")}
                value={query}
              />
            </div>
            <ToolButton
              isPending={savingKey === "refresh"}
              label={t("actions.refresh")}
              palette={palette}
              onClick={() => {
                setSavingKey("refresh");
                void refresh().finally(() => setSavingKey(null));
              }}
              size="sm"
              visual="surface"
            >
              <LocalIcon name="refresh" size={16} />
            </ToolButton>
          </div>
        </div>
        <div className="drive-oauth-provider-groups">
          {filteredGroups.length === 0 ? (
            <div className="drive-oauth-empty">
              <LocalIcon name="key" size={18} />
              <span>{t("admin.oauthProviderEmpty")}</span>
            </div>
          ) : (
            filteredGroups.map(({ rows, template }) => (
              <OAuthProviderGroup
                collapsed={collapsedGroups.has(template.key)}
                key={template.key}
                onActivate={(provider) => setProviderActive(provider, true)}
                onCopy={(value) =>
                  void copyTextToClipboard(value).then(() =>
                    showToast(t("actions.copy")),
                  )
                }
                onDeactivate={(provider) => setProviderActive(provider, false)}
                onDelete={removeProvider}
                onDuplicate={openDuplicate}
                onEdit={openEdit}
                onToggle={() =>
                  setCollapsedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(template.key)) next.delete(template.key);
                    else next.add(template.key);
                    return next;
                  })
                }
                palette={palette}
                providers={rows}
                protectedActiveProviderId={protectedActiveProviderId}
                savingKey={savingKey}
                template={template}
              />
            ))
          )}
        </div>
      </div>

      {draft ? (
        <OAuthProviderDialog
          draft={draft}
          mode={modalMode}
          onClearSecret={() => setConfirmation({ kind: "clear-secret" })}
          onClose={resetEditor}
          onCopy={(value) =>
            void copyTextToClipboard(value).then(() =>
              showToast(t("actions.copy")),
            )
          }
          onDraftChange={(nextDraft) => {
            setDraft(nextDraft);
            setTestResult(null);
          }}
          onSave={saveDraft}
          onSecretChange={(value) => {
            setSecret(value);
            setSecretCleared(false);
            setTestResult(null);
          }}
          onSelectTemplate={selectTemplate}
          onShowSecretChange={setShowSecret}
          onTest={testDraft}
          palette={palette}
          savingKey={savingKey}
          secret={secret}
          showSecret={showSecret}
          testResult={testResult}
        />
      ) : null}
      <GlobalOAuthPrompt
        loading={savingKey === "global-auth"}
        onClose={() => setEnablePromptOpen(false)}
        onEnable={enableGlobalOAuth}
        open={enablePromptOpen}
        palette={palette}
      />
      <ConfirmationDialog
        confirmationValue={
          confirmation?.kind === "delete"
            ? confirmation.provider.displayName || confirmation.provider.id
            : undefined
        }
        confirmLabel={
          confirmation?.kind === "clear-secret"
            ? t("admin.oauthClearSecret")
            : t("actions.deletePermanently")
        }
        description={
          confirmation?.kind === "delete"
            ? t("admin.oauthDeleteConfirm", {
                name: confirmation.provider.displayName,
              })
            : t("admin.oauthClearSecretConfirm")
        }
        isPending={
          confirmation?.kind === "delete" &&
          savingKey === `delete:${confirmation.provider.id}`
        }
        onClose={() => setConfirmation(null)}
        onConfirm={confirmSensitiveAction}
        open={Boolean(confirmation)}
        palette={palette}
        title={
          confirmation?.kind === "clear-secret"
            ? t("admin.oauthClearSecret")
            : t("admin.oauthDeleteTitle")
        }
      />
    </section>
  );
}

function GlobalOAuthPrompt({
  loading,
  onClose,
  onEnable,
  open,
  palette,
}: {
  loading: boolean;
  onClose: () => void;
  onEnable: () => void;
  open: boolean;
  palette: Palette;
}) {
  const t = useTranslations();
  return (
    <AppDialogShell
      className="drive-oauth-global-dialog"
      onOpenChange={(next) => !next && onClose()}
      open={open}
      palette={palette}
      size="sm"
    >
      <AppDialogHeader>
        <AppDialogTitle>{t("admin.oauthEnableGlobalTitle")}</AppDialogTitle>
        <ToolButton
          label={t("actions.close")}
          onClick={onClose}
          palette={palette}
        >
          <LocalIcon name="cross" size={16} />
        </ToolButton>
      </AppDialogHeader>
      <AppDialogBody>
        <p>{t("admin.oauthEnableGlobalDescription")}</p>
        <footer>
          <ToolButton
            label={t("actions.cancel")}
            onClick={onClose}
            palette={palette}
            visual="surface"
          >
            <LocalIcon name="cross" size={17} />
          </ToolButton>
          <ToolButton
            isPending={loading}
            label={t("admin.oauthEnableGlobalTitle")}
            onClick={onEnable}
            palette={palette}
            tone="success"
            visual="surface"
          >
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </footer>
      </AppDialogBody>
    </AppDialogShell>
  );
}

function matchesStatus(provider: OAuthSettings, status: OAuthStatusFilter) {
  if (status === "active") return provider.enabled && provider.configured;
  if (status === "configured") return provider.configured;
  if (status === "draft") return !provider.configured;
  return true;
}
function matchesQuery(provider: OAuthSettings, query: string) {
  if (!query) return true;
  return [
    provider.displayName,
    provider.clientId,
    provider.issuerUrl,
    provider.redirectUri,
    ...(provider.allowedEmailDomains ?? []),
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(query));
}

function cloneOAuthDraft(draft: OAuthSettings): OAuthSettings {
  return {
    ...draft,
    allowedEmailDomains: [...(draft.allowedEmailDomains ?? [])],
  };
}

function createEditorSnapshot(draft: OAuthSettings): OAuthEditorSnapshot {
  return {
    draft: cloneOAuthDraft(draft),
    secret: "",
    secretCleared: false,
  };
}

function isOAuthEditorDirty(
  draft: OAuthSettings | null,
  baseline: OAuthEditorSnapshot | null,
  secret: string,
  secretCleared: boolean,
) {
  if (!draft || !baseline) return false;
  return (
    JSON.stringify(draft) !== JSON.stringify(baseline.draft) ||
    secret !== baseline.secret ||
    secretCleared !== baseline.secretCleared
  );
}
