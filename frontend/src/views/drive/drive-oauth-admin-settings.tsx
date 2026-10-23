"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedChangesSection } from "@/components/admin/use-unsaved-changes-section";
import {
  UnsavedChangesDialog,
  type UnsavedChangesDialogAction,
} from "@/components/admin/unsaved-changes-dialog";
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
import {
  cloneOAuthDraft,
  createEditorSnapshot,
  isOAuthEditorDirty,
  upsertOAuthProvider,
  type OAuthEditorSnapshot,
} from "@/components/oauth/oauth-editor-state";
import { LocalIcon, StatusPill, ToolButton } from "./drive-primitives";

type OAuthStatusFilter = "all" | "active" | "configured" | "draft";
type OAuthConfirmation =
  | { kind: "clear-secret" }
  | { kind: "delete"; provider: OAuthSettings };

export function OAuthAdminSettingsPage({
  locale,
  palette,
  timeZone,
}: {
  locale?: string;
  palette: Palette;
  timeZone?: string;
}) {
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
  const [editorCloseError, setEditorCloseError] = useState<string | null>(null);
  const [editorClosePending, setEditorClosePending] =
    useState<UnsavedChangesDialogAction | null>(null);
  const [editorClosePromptOpen, setEditorClosePromptOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<OAuthEditorMode>("create");
  const [providerFilter, setProviderFilter] = useState<
    OAuthProviderKey | "all"
  >("all");
  const [providers, setProviders] = useState<OAuthSettings[]>([]);
  const [query, setQuery] = useState("");
  const operationRef = useRef(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [secretCleared, setSecretCleared] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OAuthStatusFilter>("all");
  const [testResult, setTestResult] = useState<OAuthConnectionTestResult | null>(
    null,
  );
  const [validationErrorKey, setValidationErrorKey] = useState<string | null>(
    null,
  );

  const showToast = useCallback(
    (message: string, tone: AppToastTone) =>
      showAppToast({ title: message, tone }),
    [],
  );
  const copyOAuthValue = useCallback(
    (value: string) => {
      void copyTextToClipboard(value)
        .then(() => showToast(t("actions.copy"), "success"))
        .catch(() => showToast(t("errors.unknown"), "error"));
    },
    [showToast, t],
  );
  const refresh = useCallback(async () => {
    const [providerResult, authResult] = await Promise.allSettled([
      fetchOAuthProviders(),
      fetchAuthSettings(),
    ]);
    if (providerResult.status === "fulfilled") {
      setProviders(providerResult.value.providers);
    }
    if (authResult.status === "fulfilled") {
      setAuthSettings(authResult.value);
    }
    if (providerResult.status === "rejected") throw providerResult.reason;
    if (authResult.status === "rejected") throw authResult.reason;
    setLoadError(null);
    return providerResult.value;
  }, []);
  const reportLoadFailure = useCallback(
    (error: unknown) => {
      const message = getDriveApiErrorMessage(error, t, {
        fallbackKey: "admin.loadFailed",
        scope: "form",
      });
      setLoadError(message);
      return message;
    },
    [t],
  );
  const syncAfterMutation = useCallback(async () => {
    try {
      await refresh();
    } catch (error) {
      reportLoadFailure(error);
    }
  }, [refresh, reportLoadFailure]);

  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      void refresh()
        .catch((error) => {
          if (!cancelled) showToast(reportLoadFailure(error), "error");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, reportLoadFailure, showToast]);

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
  const hasResultFilters = statusFilter !== "all" || query.trim().length > 0;
  const resetProviderFilters = () => {
    setProviderFilter("all");
    setStatusFilter("all");
    setQuery("");
  };

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

  const beginOperation = (key: string) => {
    if (operationRef.current) return false;
    operationRef.current = true;
    setSavingKey(key);
    return true;
  };
  const endOperation = () => {
    operationRef.current = false;
    setSavingKey(null);
  };

  const resetEditor = () => {
    setEditorBaseline(null);
    setDraft(null);
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setValidationErrorKey(null);
    setEditorError(null);
    setEditorCloseError(null);
    setEditorClosePending(null);
    setEditorClosePromptOpen(false);
  };
  const openCreate = (providerKey: OAuthProviderKey = "google") => {
    if (operationRef.current) return;
    const nextDraft = createOAuthDraft(
      getOAuthProviderTemplate(providerKey),
      systemBaseUrl,
    );
    setModalMode("create");
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setValidationErrorKey(null);
    setEditorError(null);
    setEditorBaseline(createEditorSnapshot(nextDraft));
    setDraft(nextDraft);
  };
  const openEdit = (provider: OAuthSettings) => {
    if (operationRef.current) return;
    setModalMode("edit");
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setValidationErrorKey(null);
    setEditorError(null);
    setEditorBaseline(createEditorSnapshot(provider));
    setDraft(cloneOAuthDraft(provider));
  };
  const openDuplicate = (provider: OAuthSettings) => {
    if (operationRef.current) return;
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
    setValidationErrorKey(null);
    setEditorError(null);
    setEditorBaseline(createEditorSnapshot(nextDraft));
    setDraft(nextDraft);
  };
  const selectTemplate = (template: OAuthProviderTemplate) => {
    if (operationRef.current) return;
    setSecret("");
    setSecretCleared(false);
    setTestResult(null);
    setValidationErrorKey(null);
    setEditorError(null);
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
      ...(secretCleared && !secret.trim() ? { clientSecret: "" } : {}),
    };
  };

  const testDraft = () => {
    if (operationRef.current) return;
    const input = providerInput(false);
    if (!draft || !input) return;
    const validation = validateOAuthDraft(draft, secret);
    if (!validation.valid) {
      setValidationErrorKey(validation.errorKey);
      return;
    }
    setValidationErrorKey(null);
    setEditorError(null);
    if (!beginOperation("test")) return;
    setTestResult(null);
    void testOAuthProvider(input)
      .then((result) => {
        setTestResult(result);
      })
      .catch((error) => {
        const message = getDriveApiErrorMessage(error, t, {
          fallbackKey: "admin.oauthTestFailed",
          scope: "form",
        });
        setEditorError(message);
      })
      .finally(() => endOperation());
  };

  const persistDraft = async (enabled: boolean) => {
    if (operationRef.current) throw new Error("OAuth operation is pending");
    const nextEnabled =
      enabled || (modalMode === "edit" && draft?.enabled === true);
    const input = providerInput(nextEnabled);
    if (!draft || !input) throw new Error("OAuth editor is not open");
    const validation = validateOAuthDraft(draft, secret, {
      allowIncomplete: !nextEnabled,
    });
    if (!validation.valid) {
      setValidationErrorKey(validation.errorKey);
      throw new Error(validation.errorKey);
    }
    setValidationErrorKey(null);
    setEditorError(null);
    if (!beginOperation(enabled ? "activate" : "save")) {
      throw new Error("OAuth operation is pending");
    }
    try {
      const request =
        modalMode === "edit"
          ? updateOAuthProvider(draft.id, input)
          : createOAuthProvider(input);
      const provider = await request;
      setProviders((current) => upsertOAuthProvider(current, provider));
      showToast(enabled ? t("admin.oauthActivated") : t("admin.saved"), "success");
      resetEditor();
      if (enabled && authSettings && !authSettings.oauthEnabled) {
        setEnablePromptOpen(true);
      }
      await syncAfterMutation();
    } catch (error) {
      const message = getDriveApiErrorMessage(error, t, {
        fallbackKey: "admin.saveFailed",
        scope: "form",
      });
      setEditorError(message);
      throw error;
    } finally {
      endOperation();
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
    setTestResult(null);
    setValidationErrorKey(null);
    setEditorError(null);
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

  const requestEditorClose = () => {
    if (operationRef.current) return;
    if (!editorDirty) {
      resetEditor();
      return;
    }
    setEditorCloseError(null);
    setEditorClosePromptOpen(true);
  };
  const saveBeforeEditorClose = () => {
    setEditorCloseError(null);
    setEditorClosePending("save");
    void persistDraft(false)
      .catch(() => setEditorCloseError(t("admin.unsavedSaveFailed")))
      .finally(() => setEditorClosePending(null));
  };

  const setProviderActive = (provider: OAuthSettings, enabled: boolean) => {
    if (operationRef.current) return;
    const key = `${enabled ? "activate" : "deactivate"}:${provider.id}`;
    if (!beginOperation(key)) return;
    const request = enabled
      ? activateOAuthProvider(provider.id)
      : updateOAuthProvider(provider.id, { enabled: false });
    void request
      .then(async (next) => {
        setProviders((current) => upsertOAuthProvider(current, next));
        showToast(
          enabled ? t("admin.oauthActivated") : t("admin.oauthDeactivated"),
          "success",
        );
        if (enabled && authSettings && !authSettings.oauthEnabled)
          setEnablePromptOpen(true);
        await syncAfterMutation();
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
      .finally(() => endOperation());
  };

  const enableGlobalOAuth = () => {
    if (!authSettings || !beginOperation("global-auth")) return;
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
        showToast(t("admin.oauthGlobalEnabled"), "success");
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
      .finally(() => endOperation());
  };

  const removeProvider = (provider: OAuthSettings) => {
    if (operationRef.current) return;
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
    if (!confirmation || operationRef.current) return;
    if (confirmation.kind === "clear-secret") {
      setSecret("");
      setSecretCleared(true);
      setTestResult(null);
      setValidationErrorKey(null);
      setEditorError(null);
      setDraft((current) =>
        current ? { ...current, clientSecretConfigured: false } : current,
      );
      setConfirmation(null);
      return;
    }
    const { provider } = confirmation;
    if (operationRef.current) return;
    if (!beginOperation(`delete:${provider.id}`)) return;
    void deleteOAuthProvider(provider.id)
      .then(async () => {
        setProviders((current) =>
          current.filter((item) => item.id !== provider.id),
        );
        setConfirmation(null);
        showToast(t("admin.oauthDeleted"), "success");
        await syncAfterMutation();
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
      .finally(() => {
        endOperation();
      });
  };

  const refreshOAuthData = () => {
    if (operationRef.current) return;
    if (!beginOperation("refresh")) return;
    void refresh()
      .catch((error) => showToast(reportLoadFailure(error), "error"))
      .finally(() => endOperation());
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
        <h1 className="drive-oauth-page-title">{t("admin.oauthSettings")}</h1>
        {loadError ? (
          <div className="admin-inline-alert drive-oauth-load-error" role="alert">
            <span>
              <LocalIcon name="exclamation" size={16} />
              {loadError}
            </span>
            <ToolButton
              isPending={savingKey === "refresh"}
              label={t("app.errorBoundary.retry")}
              onClick={refreshOAuthData}
              palette={palette}
              visual="surface"
            >
              <LocalIcon name="refresh" size={16} />
            </ToolButton>
          </div>
        ) : null}
        <div className="drive-oauth-toolbar">
          <div className="drive-oauth-admin-overview">
            <div className="drive-oauth-overview-actions">
              <ToolButton showLabel
                disabled={savingKey !== null}
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
                <ToolButton showLabel
                  disabled={savingKey !== null}
                  label={t("admin.oauthEnableGlobalTitle")}
                  onClick={() => setEnablePromptOpen(true)}
                  palette={palette}
                  size="sm"
                  tone="success"
                  visual="surface"
                >
                  <LocalIcon name="power" size={16} />
                </ToolButton>
              ) : null}
            </div>
            <OAuthSummary summary={summary} />
          </div>
          <div className="drive-oauth-filterbar">
            <AppSelect
              aria-label={t("admin.oauthProvider")}
              disabled={savingKey !== null}
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
              disabled={savingKey !== null}
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
                disabled={savingKey !== null}
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
                refreshOAuthData();
              }}
              size="sm"
              visual="surface"
            >
              <LocalIcon name="refresh" size={16} />
            </ToolButton>
          </div>
        </div>
        <div className="drive-oauth-provider-groups">
          {loadError && providers.length === 0 ? null : filteredGroups.length === 0 ? (
            <div className="drive-oauth-empty">
              <LocalIcon name="key" size={18} />
              <span>{t("admin.oauthProviderEmpty")}</span>
              <ToolButton showLabel
                disabled={savingKey !== null}
                label={t(hasResultFilters ? "audit.resetFilters" : "admin.oauthAddProvider")}
                onClick={hasResultFilters ? resetProviderFilters : () => openCreate()}
                palette={palette}
                tone={hasResultFilters ? "neutral" : "accent"}
                visual="surface"
              >
                <LocalIcon name={hasResultFilters ? "cross" : "plus"} size={16} />
              </ToolButton>
            </div>
          ) : (
            filteredGroups.map(({ rows, template }) => (
              <OAuthProviderGroup
                collapsed={collapsedGroups.has(template.key)}
                key={template.key}
                locale={locale}
                onActivate={(provider) => setProviderActive(provider, true)}
                onCopy={copyOAuthValue}
                onCreate={() => openCreate(template.key)}
                onDeactivate={(provider) => setProviderActive(provider, false)}
                onDelete={removeProvider}
                onDuplicate={openDuplicate}
                onEdit={openEdit}
                onResetFilters={hasResultFilters ? resetProviderFilters : undefined}
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
                timeZone={timeZone}
              />
            ))
          )}
        </div>
      </div>

      {draft ? (
        <OAuthProviderDialog
          draft={draft}
          errorMessage={editorError}
          mode={modalMode}
          onClearSecret={() => setConfirmation({ kind: "clear-secret" })}
          onClose={requestEditorClose}
          onCopy={copyOAuthValue}
          onDraftChange={(nextDraft) => {
            setDraft(nextDraft);
            setTestResult(null);
            setValidationErrorKey(null);
            setEditorError(null);
          }}
          onSave={saveDraft}
          onSecretChange={(value) => {
            setSecret(value);
            setTestResult(null);
            setValidationErrorKey(null);
            setEditorError(null);
          }}
          onSelectTemplate={selectTemplate}
          onTest={testDraft}
          palette={palette}
          savingKey={savingKey}
          secret={secret}
          testResult={testResult}
          validationErrorKey={validationErrorKey}
        />
      ) : null}
      <UnsavedChangesDialog
        error={editorCloseError}
        labels={{
          cancel: t("admin.unsavedCancel"),
          description: t("admin.unsavedDescription"),
          discard: t("admin.unsavedDiscard"),
          save: t("admin.unsavedSave"),
          saveFailed: t("admin.unsavedSaveFailed"),
          title: t("admin.unsavedTitle"),
        }}
        onCancel={() => setEditorClosePromptOpen(false)}
        onDiscard={resetEditor}
        onSave={saveBeforeEditorClose}
        open={editorClosePromptOpen}
        palette={palette}
        pendingAction={editorClosePending}
      />
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
          <ToolButton showLabel
            label={t("actions.cancel")}
            onClick={onClose}
            palette={palette}
            visual="surface"
          >
            <LocalIcon name="cross" size={17} />
          </ToolButton>
          <ToolButton showLabel
            isPending={loading}
            label={t("admin.oauthEnableGlobalTitle")}
            onClick={onEnable}
            palette={palette}
            tone="accent"
            visual="solid"
          >
            <LocalIcon name="power" size={17} />
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
