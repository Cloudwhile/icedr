"use client";

import type { CSSProperties, ReactNode } from "react";
import { AppField } from "@/components/ui/app-field";
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogShell,
  AppDialogTitle,
} from "@/components/ui/app-dialog-shell";
import { AppInput } from "@/components/ui/app-input";
import { OAuthProviderMark } from "@/components/ui/oauth-provider-mark";
import {
  getOAuthProviderTemplate,
  oauthProviderTemplates,
  type OAuthProviderTemplate,
} from "@/extensions/oauth/provider-catalog";
import type { LocalIconName, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type {
  OAuthConnectionCheck,
  OAuthConnectionTestResult,
  OAuthSettings,
} from "@/lib/drive-api";
import { LocalIcon, ToolButton } from "@/views/drive/drive-primitives";

export type OAuthEditorMode = "create" | "edit" | "duplicate";

type OAuthProviderDialogProps = {
  draft: OAuthSettings;
  mode: OAuthEditorMode;
  onClearSecret: () => void;
  onClose: () => void;
  onCopy: (value: string) => void;
  onDraftChange: (value: OAuthSettings) => void;
  onSave: (enabled: boolean) => void;
  onSecretChange: (value: string) => void;
  onSelectTemplate: (template: OAuthProviderTemplate) => void;
  onShowSecretChange: (value: boolean) => void;
  onTest: () => void;
  palette: Palette;
  savingKey: string | null;
  secret: string;
  showSecret: boolean;
  testResult: OAuthConnectionTestResult | null;
};

export function OAuthProviderDialog({
  draft,
  mode,
  onClearSecret,
  onClose,
  onCopy,
  onDraftChange,
  onSave,
  onSecretChange,
  onSelectTemplate,
  onShowSecretChange,
  onTest,
  palette,
  savingKey,
  secret,
  showSecret,
  testResult,
}: OAuthProviderDialogProps) {
  const t = useTranslations();
  const template = getOAuthProviderTemplate(draft.providerKey);
  const titleKey =
    mode === "edit" ? "admin.oauthEditProvider" : "admin.oauthAddProvider";
  const busy = savingKey !== null;

  return (
    <AppDialogShell
      className="drive-oauth-dialog"
      containerClassName="drive-oauth-dialog-container"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      open
      palette={palette}
      scroll="inside"
      size="lg"
      style={{
        maxHeight: "calc(100dvh - 32px)",
        maxWidth: "1040px",
        padding: 0,
        width: "100%",
      }}
    >
      <AppDialogHeader className="drive-oauth-dialog-header">
        <div className="drive-oauth-dialog-title-row">
          <div className="drive-oauth-dialog-heading">
            <AppDialogTitle>{t(titleKey)}</AppDialogTitle>
            <span className="drive-oauth-dialog-context">
              <OAuthProviderMark provider={template.key} />
              <span>
                <strong>{template.displayName}</strong>
                <small>{formatOAuthProfile(template, t)}</small>
              </span>
            </span>
          </div>
          <ToolButton
            disabled={busy}
            label={t("actions.close")}
            onClick={onClose}
            palette={palette}
            size="sm"
            visual="surface"
          >
            <LocalIcon name="cross" size={16} />
          </ToolButton>
        </div>
      </AppDialogHeader>

      <AppDialogBody
        aria-busy={busy ? true : undefined}
        className="drive-oauth-dialog-body"
      >
        <div className="drive-oauth-dialog-layout">
          <section
            aria-labelledby="oauth-provider-template-heading"
            className="drive-oauth-template-panel"
          >
            <h3
              className="drive-oauth-dialog-section-title"
              id="oauth-provider-template-heading"
            >
              {t("admin.oauthSelectSupportedProvider")}
            </h3>
            <div className="drive-oauth-template-grid">
              {oauthProviderTemplates.map((item) => {
                const active = draft.providerKey === item.key;
                return (
                  <button
                    aria-pressed={active}
                    className="drive-oauth-template-option"
                    data-active={active ? "true" : undefined}
                    disabled={busy}
                    key={item.key}
                    onClick={() => onSelectTemplate(item)}
                    style={
                      { "--oauth-provider-accent": item.accent } as CSSProperties
                    }
                    type="button"
                  >
                    <OAuthProviderMark provider={item.key} />
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>{formatOAuthProfile(item, t)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="oauth-provider-config-heading"
            className="drive-oauth-form-panel"
          >
            <div className="drive-oauth-form-heading">
              <h3
                className="drive-oauth-dialog-section-title"
                id="oauth-provider-config-heading"
              >
                {t("admin.oauthBasicConfigFor", {
                  provider: template.displayName,
                })}
              </h3>
              {template.docsUrl ? (
                <a
                  className="drive-oauth-doc-link"
                  href={template.docsUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>
                    {t("admin.oauthProviderDocs", {
                      provider: template.displayName,
                    })}
                  </span>
                  <LocalIcon name="arrow_right" size={13} />
                </a>
              ) : null}
            </div>

            <div className="drive-oauth-form-columns">
              <div className="drive-oauth-form-column">
                <OAuthInputField
                  label={t("admin.oauthConfigName")}
                  palette={palette}
                >
                  <AppInput
                    disabled={busy}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        displayName: event.target.value,
                      })
                    }
                    palette={palette}
                    value={draft.displayName}
                  />
                </OAuthInputField>
                <OAuthInputField
                  label={t("admin.oauthClientId")}
                  palette={palette}
                >
                  <AppInput
                    disabled={busy}
                    onChange={(event) =>
                      onDraftChange({ ...draft, clientId: event.target.value })
                    }
                    palette={palette}
                    value={draft.clientId}
                  />
                </OAuthInputField>
                <OAuthInputField
                  label={t("admin.oauthSecret")}
                  palette={palette}
                >
                  <div className="drive-oauth-copy-field">
                    <AppInput
                      disabled={busy}
                      onChange={(event) => onSecretChange(event.target.value)}
                      palette={palette}
                      placeholder={
                        draft.clientSecretConfigured
                          ? t("admin.secretConfigured")
                          : ""
                      }
                      type={showSecret ? "text" : "password"}
                      value={secret}
                    />
                    <ToolButton
                      disabled={busy}
                      label={
                        showSecret
                          ? t("admin.oauthHideSecret")
                          : t("admin.oauthShowSecret")
                      }
                      onClick={() => onShowSecretChange(!showSecret)}
                      palette={palette}
                      size="sm"
                    >
                      <LocalIcon
                        name={showSecret ? "lock" : "visible"}
                        size={16}
                      />
                    </ToolButton>
                    {draft.clientSecretConfigured ? (
                      <ToolButton
                        disabled={busy}
                        label={t("admin.oauthClearSecret")}
                        onClick={onClearSecret}
                        palette={palette}
                        size="sm"
                        tone="danger"
                      >
                        <LocalIcon name="trash" size={16} />
                      </ToolButton>
                    ) : null}
                  </div>
                </OAuthInputField>
              </div>

              <div className="drive-oauth-form-column">
                {draft.providerProfile === "oauth2" ? (
                  <>
                    <OAuthInputField
                      label={t("admin.oauthAuthorizationUrl")}
                      palette={palette}
                    >
                      <AppInput
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            authorizationUrl: event.target.value,
                          })
                        }
                        palette={palette}
                        value={draft.authorizationUrl}
                      />
                    </OAuthInputField>
                    <OAuthInputField
                      label={t("admin.oauthTokenUrl")}
                      palette={palette}
                    >
                      <AppInput
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            tokenUrl: event.target.value,
                          })
                        }
                        palette={palette}
                        value={draft.tokenUrl}
                      />
                    </OAuthInputField>
                    <OAuthInputField
                      label={t("admin.oauthUserinfoUrl")}
                      palette={palette}
                    >
                      <AppInput
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            userinfoUrl: event.target.value,
                          })
                        }
                        palette={palette}
                        value={draft.userinfoUrl}
                      />
                    </OAuthInputField>
                  </>
                ) : (
                  <OAuthInputField
                    label={t("admin.oauthIssuerDiscoveryUrl")}
                    palette={palette}
                  >
                    <AppInput
                      disabled={busy}
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          issuerUrl: event.target.value,
                        })
                      }
                      palette={palette}
                      value={draft.issuerUrl}
                    />
                  </OAuthInputField>
                )}
              </div>
            </div>

            <details className="drive-oauth-advanced">
              <summary>
                <LocalIcon name="settings" size={15} />
                <span>{t("admin.oauthAdvancedSettings")}</span>
              </summary>
              <div className="drive-oauth-advanced-body">
                <div className="drive-oauth-form-columns">
                  <div className="drive-oauth-form-column">
                    <OAuthInputField
                      label={t("admin.oauthRedirectUri")}
                      palette={palette}
                    >
                      <div className="drive-oauth-copy-field">
                        <AppInput
                          disabled={busy}
                          onChange={(event) =>
                            onDraftChange({
                              ...draft,
                              redirectUri: event.target.value,
                            })
                          }
                          palette={palette}
                          value={draft.redirectUri}
                        />
                        <ToolButton
                          disabled={!draft.redirectUri}
                          label={t("admin.copyOAuthRedirectUri")}
                          onClick={() => onCopy(draft.redirectUri)}
                          palette={palette}
                          size="sm"
                        >
                          <LocalIcon name="copy" size={16} />
                        </ToolButton>
                      </div>
                    </OAuthInputField>
                    <OAuthInputField
                      label={t("admin.oauthScopes")}
                      palette={palette}
                    >
                      <AppInput
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            scopes: event.target.value,
                          })
                        }
                        palette={palette}
                        value={draft.scopes}
                      />
                    </OAuthInputField>
                    <OAuthInputField
                      label={t("admin.oauthAudience")}
                      palette={palette}
                    >
                      <AppInput
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            audience: event.target.value,
                          })
                        }
                        palette={palette}
                        value={draft.audience}
                      />
                    </OAuthInputField>
                  </div>

                  <div className="drive-oauth-form-column">
                    <span className="drive-oauth-policy-title">
                      {t("admin.oauthSecurityPolicy")}
                    </span>
                    <OAuthPolicyToggle
                      checked={draft.allowSignup !== false}
                      disabled={busy}
                      label={t("admin.oauthAllowSignup")}
                      onChange={(checked) =>
                        onDraftChange({ ...draft, allowSignup: checked })
                      }
                    />
                    <OAuthPolicyToggle
                      checked={draft.linkByVerifiedEmail === true}
                      disabled={busy}
                      label={t("admin.oauthLinkVerifiedEmail")}
                      onChange={(checked) =>
                        onDraftChange({
                          ...draft,
                          linkByVerifiedEmail: checked,
                        })
                      }
                    />
                    <OAuthPolicyToggle
                      checked={draft.requireVerifiedEmail === true}
                      disabled={busy}
                      label={t("admin.oauthRequireVerifiedEmail")}
                      onChange={(checked) =>
                        onDraftChange({
                          ...draft,
                          requireVerifiedEmail: checked,
                        })
                      }
                    />
                    <OAuthInputField
                      label={t("admin.oauthAllowedDomains")}
                      palette={palette}
                    >
                      <AppInput
                        disabled={busy}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            allowedEmailDomains: parseDomains(
                              event.target.value,
                            ),
                          })
                        }
                        palette={palette}
                        placeholder={t("admin.oauthAllowedDomainsPlaceholder")}
                        value={(draft.allowedEmailDomains ?? []).join(", ")}
                      />
                    </OAuthInputField>
                  </div>
                </div>
              </div>
            </details>

            {testResult ? <OAuthTestResult result={testResult} /> : null}
          </section>
        </div>
      </AppDialogBody>

      <AppDialogFooter className="drive-oauth-dialog-actions">
        <ToolAction
          className="drive-oauth-dialog-action-cancel"
          disabled={busy}
          icon="cross"
          label={t("actions.cancel")}
          onClick={onClose}
          palette={palette}
        />
        <div className="drive-oauth-dialog-actions-primary">
          <ToolAction
            disabled={busy}
            icon="refresh"
            isPending={savingKey === "test"}
            label={t("admin.oauthTestConnection")}
            onClick={onTest}
            palette={palette}
          />
          <ToolAction
            disabled={busy}
            icon="save"
            isPending={savingKey === "save"}
            label={
              mode === "edit"
                ? t("admin.oauthSaveChanges")
                : t("admin.oauthSaveDraft")
            }
            onClick={() => onSave(false)}
            palette={palette}
          />
          <ToolAction
            className="drive-oauth-dialog-action-activate"
            disabled={busy}
            icon="tick"
            isPending={savingKey === "activate"}
            label={t("admin.oauthSaveAndActivate")}
            onClick={() => onSave(true)}
            palette={palette}
            tone="success"
          />
        </div>
      </AppDialogFooter>
    </AppDialogShell>
  );
}

function OAuthTestResult({ result }: { result: OAuthConnectionTestResult }) {
  const t = useTranslations();
  return (
    <div
      className="drive-oauth-test-result"
      data-tone={result.ok ? "secure" : "risk"}
    >
      <header>
        <LocalIcon
          name={result.ok ? "tick" : "exclamation"}
          size={16}
        />
        <strong>
          {result.ok
            ? t("admin.oauthTestPassed")
            : t("admin.oauthTestFailed")}
        </strong>
      </header>
      <div>
        {result.checks.map((check) => (
          <span data-ok={check.ok ? "true" : "false"} key={check.key}>
            <LocalIcon name={check.ok ? "tick" : "cross"} size={14} />
            <span>{t(getOAuthCheckLabelKey(check))}</span>
            {check.status ? <small>HTTP {check.status}</small> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function getOAuthCheckLabelKey(check: OAuthConnectionCheck) {
  if (check.key === "authorization") return "admin.oauthCheckAuthorization";
  if (check.key === "token") return "admin.oauthCheckToken";
  if (check.key === "userinfo") return "admin.oauthCheckUserinfo";
  if (check.key === "issuer") return "admin.oauthCheckIssuer";
  return "admin.oauthCheckDiscovery";
}

function OAuthInputField({
  children,
  label,
  palette,
}: {
  children: ReactNode;
  label: string;
  palette: Palette;
}) {
  return (
    <AppField label={label} palette={palette}>
      {children}
    </AppField>
  );
}

function OAuthPolicyToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="drive-oauth-policy-toggle">
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function ToolAction({
  className,
  disabled,
  icon,
  isPending,
  label,
  onClick,
  palette,
  tone,
}: {
  className?: string;
  disabled?: boolean;
  icon: LocalIconName;
  isPending?: boolean;
  label: string;
  onClick: () => void;
  palette: Palette;
  tone?: "success";
}) {
  return (
    <ToolButton
      className={className}
      disabled={disabled && !isPending}
      isPending={isPending}
      label={label}
      onClick={onClick}
      palette={palette}
      size="sm"
      tone={tone}
      visual="surface"
    >
      <LocalIcon name={icon} size={16} />
    </ToolButton>
  );
}

function parseDomains(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean),
    ),
  ).slice(0, 32);
}

function formatOAuthProfile(
  template: OAuthProviderTemplate,
  t: ReturnType<typeof useTranslations>,
) {
  if (template.profile === "oauth2") return "OAuth2";
  if (template.profile === "icetowne-blog")
    return t("admin.oauthCompatibilityMode");
  return "OIDC";
}
