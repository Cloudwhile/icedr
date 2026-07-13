"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "@/compat/navigation";
import type { Palette } from "@/features/file/model";
import { useLocale, useTranslations } from "@/i18n/react";
import {
  createPasskeyRegistrationOptions,
  deletePasskey,
  exchangeOAuthStepUpCode,
  fetchAuthenticationMethodStatus,
  fetchAuthSettings,
  fetchPasskeys,
  generateRecoveryCodes,
  renamePasskey,
  startOAuthStepUp,
  verifyPasskeyRegistration,
  type AuthenticationMethodStatus,
  type AuthenticationStepUp,
  type AuthSettings,
  type PasskeyRecord,
  type RecoveryCodeSet,
} from "@/lib/drive-api";
import { getDriveApiErrorMessage } from "@/lib/drive-api-errors";
import {
  assertPasskeyRequestContext,
  getPasskeyErrorNotice,
} from "@/features/auth/passkey-client-errors";
import { ActionButton } from "@/components/ui/action-button";
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogShell,
  AppDialogTitle,
} from "@/components/ui/app-dialog-shell";
import { AppInput } from "@/components/ui/app-input";
import { LocalIcon } from "@/components/ui/app-icon";
import { showAppToast } from "@/components/ui/app-toast-store";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ToolButton } from "@/components/ui/tool-button";
import { RecoveryCodesDialog } from "./recovery-codes-dialog";
import { SecurityReauthDialog } from "./security-reauth-dialog";
import {
  clearPendingSecurityAction,
  getPasskeyBindingState,
  passkeyRemovalViolatesPolicy,
  readPendingSecurityAction,
  storePendingSecurityAction,
  type PasskeySensitiveAction,
} from "./passkey-manager-state";
import "./passkey-manager.css";

export function PasskeyManager({
  initialMethodStatus = null,
  onMethodStatusChange,
  palette,
}: {
  initialMethodStatus?: AuthenticationMethodStatus | null;
  onMethodStatusChange?: (status: AuthenticationMethodStatus) => void;
  palette: Palette;
}) {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const oauthStepUpCode = searchParams.get("oauthStepUpCode") ?? "";
  const oauthExchangeStartedRef = useRef<string | null>(null);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PasskeyRecord | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [methodStatus, setMethodStatus] = useState<AuthenticationMethodStatus | null>(initialMethodStatus);
  const [name, setName] = useState("");
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [pendingAction, setPendingAction] = useState<PasskeySensitiveAction | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [recoveryCodeSet, setRecoveryCodeSet] = useState<RecoveryCodeSet | null>(null);
  const [recoveryConfirmOpen, setRecoveryConfirmOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PasskeyRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const applyMethodStatus = useCallback(
    (status: AuthenticationMethodStatus) => {
      setMethodStatus(status);
      onMethodStatusChange?.(status);
    },
    [onMethodStatusChange],
  );

  const refresh = useCallback(async () => {
    const [nextPasskeys, nextAuthSettings, nextMethodStatus] = await Promise.all([
      fetchPasskeys(),
      fetchAuthSettings(),
      fetchAuthenticationMethodStatus(),
    ]);
    setPasskeys(nextPasskeys);
    setAuthSettings(nextAuthSettings);
    applyMethodStatus(nextMethodStatus);
    setError(false);
  }, [applyMethodStatus]);

  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      void refresh()
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const bindingState = getPasskeyBindingState(passkeys, loading, error);
  const defaultName = useMemo(
    () =>
      t("settings.passkeyDefaultName", {
        date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(),
        ),
      }),
    [locale, t],
  );

  const completeSensitiveAction = useCallback(
    async (action: PasskeySensitiveAction, stepUp: AuthenticationStepUp) => {
      setSavingKey(getSensitiveActionKey(action));
      try {
        if (action.kind === "add-passkey") {
          const ceremony = await createPasskeyRegistrationOptions(stepUp.token);
          assertPasskeyRequestContext(ceremony.options, ceremony.expectedOrigin);
          const response = await startRegistration({
            optionsJSON: ceremony.options,
          });
          await verifyPasskeyRegistration({
            ceremonyId: ceremony.ceremonyId,
            name: action.name,
            response,
          });
          showAppToast({
            title: t("settings.passkeyAdded"),
            tone: "success",
          });
        } else if (action.kind === "delete-passkey") {
          await deletePasskey(action.passkeyId, stepUp.token);
          showAppToast({
            title: t("settings.passkeyRemoved"),
            tone: "success",
          });
        } else {
          const nextCodes = await generateRecoveryCodes(stepUp.token);
          setRecoveryCodeSet(nextCodes);
          showAppToast({
            title: t("settings.recoveryCodesGenerated"),
            tone: "success",
          });
        }
        setRegisterOpen(false);
        setDeleteTarget(null);
        await refresh();
      } catch (actionError) {
        if (action.kind === "add-passkey") {
          const notice = getPasskeyErrorNotice(
            actionError,
            t,
            "settings.passkeyAddFailed",
          );
          if (notice) {
            showAppToast({ title: notice.message, tone: notice.tone });
          }
          return;
        }
        showAppToast({
          title: getSensitiveActionError(action, actionError, t),
          tone: "error",
        });
      } finally {
        clearPendingSecurityAction();
        setPendingAction(null);
        setSavingKey(null);
      }
    },
    [refresh, t],
  );

  useEffect(() => {
    if (
      !oauthStepUpCode ||
      oauthExchangeStartedRef.current === oauthStepUpCode
    ) {
      return;
    }
    oauthExchangeStartedRef.current = oauthStepUpCode;
    const action = readPendingSecurityAction();
    if (!action) {
      clearOAuthStepUpQuery(router, searchParams);
      showAppToast({
        title: t("settings.reauthActionExpired"),
        tone: "error",
      });
      return;
    }
    void exchangeOAuthStepUpCode(oauthStepUpCode)
      .then((stepUp) => completeSensitiveAction(action, stepUp))
      .catch((exchangeError) => {
        clearPendingSecurityAction();
        setPendingAction(null);
        showAppToast({
          title: getDriveApiErrorMessage(exchangeError, t, {
            fallbackKey: "settings.oauthReauthFailed",
            scope: "form",
          }),
          tone: "error",
        });
      })
      .finally(() => {
        clearOAuthStepUpQuery(router, searchParams);
      });
  }, [completeSensitiveAction, oauthStepUpCode, router, searchParams, t]);

  const requestSensitiveAction = (action: PasskeySensitiveAction) => {
    setPendingAction(action);
    setReauthOpen(true);
  };

  const beginRegistration = () => {
    setName(defaultName);
    setRegisterOpen(true);
  };

  const requestRegistration = () => {
    const passkeyName = name.trim() || defaultName;
    setRegisterOpen(false);
    requestSensitiveAction({ kind: "add-passkey", name: passkeyName });
  };

  const confirmDeletion = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    requestSensitiveAction({ kind: "delete-passkey", passkeyId: target.id });
  };

  const requestRecoveryCodeGeneration = () => {
    if ((methodStatus?.methods.recoveryCodes ?? 0) > 0) {
      setRecoveryConfirmOpen(true);
      return;
    }
    requestSensitiveAction({ kind: "generate-recovery-codes" });
  };

  const saveRename = () => {
    if (!renameTarget || !renameValue.trim()) return;
    const target = renameTarget;
    const nextName = renameValue.trim();
    setSavingKey(`rename:${target.id}`);
    void renamePasskey(target.id, nextName)
      .then(() => refresh())
      .then(() => {
        setRenameTarget(null);
        showAppToast({
          title: t("settings.passkeyRenamed"),
          tone: "success",
        });
      })
      .catch((renameError) =>
        showAppToast({
          title: getDriveApiErrorMessage(renameError, t, {
            fallbackKey: "settings.passkeyRenameFailed",
            scope: "form",
          }),
          tone: "error",
        }),
      )
      .finally(() => setSavingKey(null));
  };

  const methodRows = buildAuthenticationMethodRows(methodStatus, t);

  return (
    <div className="drive-security-settings-stack">
      <section
        aria-label={t("settings.accountSecurityStatus")}
        className="drive-settings-section drive-security-overview"
      >
        <SecuritySectionHeader
          icon="shield"
          title={t("settings.accountSecurityStatus")}
          trailing={
            <StatusPill
              palette={palette}
              tone={methodStatus?.compliant ? "secure" : "risk"}
            >
              {methodStatus?.compliant
                ? t("settings.authPolicyCompliant")
                : t("settings.authPolicyActionRequired")}
            </StatusPill>
          }
        />
        <div
          className="drive-security-policy"
          data-tone={methodStatus?.compliant ? "secure" : "risk"}
        >
          <div className="drive-security-policy-counts">
            <span>
              <strong>{methodStatus?.methodCount ?? "--"}</strong>
              <small>{t("settings.authPolicyAvailable")}</small>
            </span>
            <span>
              <strong>{methodStatus?.minimumAuthenticationMethods ?? "--"}</strong>
              <small>{t("settings.authPolicyMinimum")}</small>
            </span>
          </div>
          <p>
            {methodStatus?.compliant
              ? t("settings.authPolicyCompliantHint")
              : t("settings.authPolicyRequiredHint", {
                  count: methodStatus?.minimumAuthenticationMethods ?? 1,
                })}
          </p>
        </div>
        <div className="drive-auth-method-list">
          {methodRows.map((method) => (
            <div className="drive-auth-method-row" key={method.key}>
              <span className="drive-auth-method-icon">
                <LocalIcon name={method.icon} size={16} />
              </span>
              <div>
                <strong>{method.label}</strong>
                <span>{method.detail}</span>
              </div>
              <span
                className="drive-auth-method-state"
                data-enabled={method.enabled ? "true" : undefined}
              >
                <LocalIcon name={method.enabled ? "tick" : "minus"} size={14} />
                <span>
                  {method.enabled
                    ? t("settings.authMethodAvailable")
                    : t("settings.authMethodUnavailable")}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label={t("settings.passkeyDevices")}
        className="drive-settings-section drive-passkey-manager"
      >
        <SecuritySectionHeader
          icon="key"
          title={t("settings.passkeyDevices")}
          trailing={
            <div className="drive-passkey-manager-actions">
              <ToolButton
                disabled={!authSettings?.passkeyConfigured || loading}
                label={
                  authSettings?.passkeyConfigured
                    ? t("settings.passkeyAdd")
                    : t("settings.passkeyServiceUnavailable")
                }
                onClick={beginRegistration}
                palette={palette}
                visual="surface"
              >
                <LocalIcon name="plus" size={16} />
              </ToolButton>
              <ToolButton
                isPending={savingKey === "refresh"}
                label={t("actions.refresh")}
                onClick={() => {
                  setSavingKey("refresh");
                  void refresh()
                    .catch(() => setError(true))
                    .finally(() => setSavingKey(null));
                }}
                palette={palette}
                visual="surface"
              >
                <LocalIcon name="refresh" size={16} />
              </ToolButton>
            </div>
          }
        />
        <div
          className="drive-passkey-manager-status"
          data-tone={
            bindingState === "bound"
              ? "secure"
              : bindingState === "error"
                ? "risk"
                : "neutral"
          }
        >
          <LocalIcon
            name={
              bindingState === "bound"
                ? "tick"
                : bindingState === "error"
                  ? "exclamation"
                  : "info"
            }
            size={15}
          />
          <span>{getPasskeyStatusLabel(bindingState, passkeys.length, t)}</span>
        </div>

        {passkeys.length > 0 ? (
          <div className="drive-passkey-table" role="table">
            <div className="drive-passkey-table-header" role="row">
              <span role="columnheader">{t("settings.passkeyDevice")}</span>
              <span role="columnheader">{t("settings.passkeyStorage")}</span>
              <span role="columnheader">{t("settings.passkeyActivity")}</span>
              <span aria-label={t("actions.more")} role="columnheader" />
            </div>
            <div className="drive-passkey-table-body" role="rowgroup">
              {passkeys.map((passkey) => {
                const removalBlocked = passkeyRemovalViolatesPolicy(
                  passkeys.length,
                  methodStatus,
                );
                return (
                  <div className="drive-passkey-row" key={passkey.id} role="row">
                    <div className="drive-passkey-device-cell" role="cell">
                      <span className="drive-passkey-row-icon" aria-hidden="true">
                        <LocalIcon name="laptop" size={17} />
                      </span>
                      <div className="drive-passkey-row-copy">
                        <strong>{passkey.name}</strong>
                        <span>{passkey.deviceName}</span>
                      </div>
                    </div>
                    <div className="drive-passkey-storage-cell" role="cell">
                      <strong>{getPasskeyStorageLabel(passkey, t)}</strong>
                      <span>{getTransportLabel(passkey.transports, t)}</span>
                    </div>
                    <div className="drive-passkey-activity-cell" role="cell">
                      <strong>
                        {passkey.lastUsedAt
                          ? formatPasskeyDate(passkey.lastUsedAt, locale)
                          : t("settings.passkeyNeverUsed")}
                      </strong>
                      <span>
                        {t("settings.passkeyCreated", {
                          date: formatPasskeyDate(passkey.createdAt, locale),
                        })}
                      </span>
                    </div>
                    <div className="drive-passkey-row-actions" role="cell">
                      <ToolButton
                        disabled={Boolean(savingKey)}
                        label={t("settings.passkeyRename")}
                        onClick={() => {
                          setRenameTarget(passkey);
                          setRenameValue(passkey.name);
                        }}
                        palette={palette}
                      >
                        <LocalIcon name="pencil" size={15} />
                      </ToolButton>
                      <ToolButton
                        disabled={removalBlocked}
                        isPending={savingKey === `delete:${passkey.id}`}
                        label={
                          removalBlocked
                            ? t("settings.passkeyLastRequired")
                            : t("settings.passkeyRemove")
                        }
                        onClick={() => setDeleteTarget(passkey)}
                        palette={palette}
                        tone="danger"
                      >
                        <LocalIcon name="trash" size={15} />
                      </ToolButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : !loading ? (
          <div className="drive-passkey-empty">
            <LocalIcon name="key" size={19} />
            <span>
              {authSettings?.passkeyConfigured
                ? t("settings.passkeyEmptyHint")
                : t("settings.passkeyServiceUnavailable")}
            </span>
          </div>
        ) : (
          <div className="drive-passkey-loading" aria-label={t("settings.passkeyLoading")} />
        )}
      </section>

      <section
        aria-label={t("settings.recoveryCodesTitle")}
        className="drive-settings-section drive-recovery-manager"
      >
        <SecuritySectionHeader
          icon="shield"
          title={t("settings.recoveryCodesTitle")}
          trailing={
            <ToolButton
              disabled={loading || !methodStatus}
              label={
                (methodStatus?.methods.recoveryCodes ?? 0) > 0
                  ? t("settings.recoveryCodesRegenerate")
                  : t("settings.recoveryCodesGenerate")
              }
              onClick={requestRecoveryCodeGeneration}
              palette={palette}
              tone={(methodStatus?.methods.recoveryCodes ?? 0) > 0 ? "danger" : "success"}
              visual="surface"
            >
              <LocalIcon
                name={(methodStatus?.methods.recoveryCodes ?? 0) > 0 ? "refresh" : "plus"}
                size={16}
              />
            </ToolButton>
          }
        />
        <div className="drive-recovery-manager-row">
          <div>
            <strong>
              {(methodStatus?.methods.recoveryCodes ?? 0) > 0
                ? t("settings.recoveryCodesRemaining", {
                    count: methodStatus?.methods.recoveryCodes ?? 0,
                  })
                : t("settings.recoveryCodesNotConfigured")}
            </strong>
            <span>{t("settings.recoveryCodesAccountHint")}</span>
          </div>
          <StatusPill
            palette={palette}
            tone={(methodStatus?.methods.recoveryCodes ?? 0) > 0 ? "secure" : "neutral"}
          >
            {(methodStatus?.methods.recoveryCodes ?? 0) > 0
              ? t("settings.authMethodAvailable")
              : t("settings.authMethodUnavailable")}
          </StatusPill>
        </div>
      </section>

      <AppDialogShell
        className="drive-passkey-dialog"
        onOpenChange={(open) => !open && setRegisterOpen(false)}
        open={registerOpen}
        palette={palette}
        size="sm"
      >
        <AppDialogHeader>
          <div className="drive-passkey-dialog-heading">
            <LocalIcon name="key" size={18} />
            <AppDialogTitle>{t("settings.passkeyAdd")}</AppDialogTitle>
          </div>
          <ToolButton
            disabled={Boolean(savingKey)}
            label={t("actions.close")}
            onClick={() => setRegisterOpen(false)}
            palette={palette}
          >
            <LocalIcon name="cross" size={16} />
          </ToolButton>
        </AppDialogHeader>
        <AppDialogBody>
          <label className="drive-passkey-name-field">
            <span>{t("admin.passkeyName")}</span>
            <AppInput
              autoComplete="off"
              autoFocus
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && requestRegistration()}
              palette={palette}
              value={name}
            />
          </label>
        </AppDialogBody>
        <AppDialogFooter>
          <ActionButton
            disabled={!name.trim()}
            icon={<LocalIcon name="arrow_right" size={16} />}
            onClick={requestRegistration}
            palette={palette}
            tone="primary"
          >
            {t("settings.passkeyContinue")}
          </ActionButton>
        </AppDialogFooter>
      </AppDialogShell>

      <AppDialogShell
        className="drive-passkey-dialog"
        onOpenChange={(open) => !open && setRenameTarget(null)}
        open={Boolean(renameTarget)}
        palette={palette}
        size="sm"
      >
        <AppDialogHeader>
          <div className="drive-passkey-dialog-heading">
            <LocalIcon name="pencil" size={18} />
            <AppDialogTitle>{t("settings.passkeyRename")}</AppDialogTitle>
          </div>
          <ToolButton
            disabled={Boolean(savingKey)}
            label={t("actions.close")}
            onClick={() => setRenameTarget(null)}
            palette={palette}
          >
            <LocalIcon name="cross" size={16} />
          </ToolButton>
        </AppDialogHeader>
        <AppDialogBody>
          <label className="drive-passkey-name-field">
            <span>{t("admin.passkeyName")}</span>
            <AppInput
              autoComplete="off"
              autoFocus
              maxLength={80}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && saveRename()}
              palette={palette}
              value={renameValue}
            />
          </label>
        </AppDialogBody>
        <AppDialogFooter>
          <ActionButton
            disabled={!renameValue.trim()}
            icon={<LocalIcon name="save" size={16} />}
            isPending={Boolean(renameTarget && savingKey === `rename:${renameTarget.id}`)}
            onClick={saveRename}
            palette={palette}
            tone="primary"
          >
            {t("actions.save")}
          </ActionButton>
        </AppDialogFooter>
      </AppDialogShell>

      <ConfirmationDialog
        confirmLabel={t("settings.passkeyRemove")}
        description={t("settings.passkeyRemoveConfirm", {
          name: deleteTarget?.name ?? "",
        })}
        isPending={Boolean(
          deleteTarget && savingKey === `delete:${deleteTarget.id}`,
        )}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeletion}
        open={Boolean(deleteTarget)}
        palette={palette}
        title={t("settings.passkeyRemove")}
      />

      <ConfirmationDialog
        confirmLabel={t("settings.recoveryCodesRegenerate")}
        description={t("settings.recoveryCodesRegenerateConfirm")}
        onClose={() => setRecoveryConfirmOpen(false)}
        onConfirm={() => {
          setRecoveryConfirmOpen(false);
          requestSensitiveAction({ kind: "generate-recovery-codes" });
        }}
        open={recoveryConfirmOpen}
        palette={palette}
        title={t("settings.recoveryCodesRegenerate")}
      />

      <SecurityReauthDialog
        key={pendingAction ? JSON.stringify(pendingAction) : "closed"}
        methods={methodStatus?.methods ?? null}
        onAuthenticated={(stepUp) => {
          const action = pendingAction;
          setReauthOpen(false);
          if (action) void completeSensitiveAction(action, stepUp);
        }}
        onClose={() => {
          setReauthOpen(false);
          setPendingAction(null);
        }}
        onOAuthRedirect={async () => {
          if (!pendingAction) return;
          storePendingSecurityAction(pendingAction);
          try {
            const response = await startOAuthStepUp();
            window.location.href = response.authorizationUrl;
          } catch (error) {
            clearPendingSecurityAction();
            throw error;
          }
        }}
        open={reauthOpen}
        palette={palette}
        purpose={getSensitiveActionPurpose(pendingAction, t)}
      />

      <RecoveryCodesDialog
        codeSet={recoveryCodeSet}
        onClose={() => setRecoveryCodeSet(null)}
        palette={palette}
      />
    </div>
  );
}

function SecuritySectionHeader({
  icon,
  title,
  trailing,
}: {
  icon: "key" | "shield";
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="drive-security-section-header">
      <div>
        <LocalIcon name={icon} size={16} />
        <span>{title}</span>
      </div>
      {trailing ? <div>{trailing}</div> : null}
    </header>
  );
}

function buildAuthenticationMethodRows(
  status: AuthenticationMethodStatus | null,
  t: ReturnType<typeof useTranslations>,
) {
  return [
    {
      detail: status?.methods.password
        ? t("settings.authMethodPasswordReady")
        : t("settings.authMethodPasswordMissing"),
      enabled: Boolean(status?.methods.password),
      icon: "lock" as const,
      key: "password",
      label: t("settings.authMethodPassword"),
    },
    {
      detail: status?.methods.oauth
        ? t("settings.authMethodOAuthReady")
        : t("settings.authMethodOAuthMissing"),
      enabled: Boolean(status?.methods.oauth),
      icon: "earth" as const,
      key: "oauth",
      label: t("settings.authMethodOAuth"),
    },
    {
      detail: status?.methods.passkey
        ? t("settings.authMethodPasskeyReady")
        : t("settings.authMethodPasskeyMissing"),
      enabled: Boolean(status?.methods.passkey),
      icon: "key" as const,
      key: "passkey",
      label: t("settings.authMethodPasskey"),
    },
  ];
}

function getPasskeyStatusLabel(
  bindingState: ReturnType<typeof getPasskeyBindingState>,
  count: number,
  t: ReturnType<typeof useTranslations>,
) {
  if (bindingState === "loading") return t("settings.passkeyLoading");
  if (bindingState === "error") return t("settings.passkeyLoadFailed");
  if (bindingState === "bound") {
    return t("settings.passkeyBoundCount", { count });
  }
  return t("settings.passkeyNotBound");
}

function getPasskeyStorageLabel(
  passkey: PasskeyRecord,
  t: ReturnType<typeof useTranslations>,
) {
  if (passkey.deviceType === "multiDevice" || passkey.backedUp) {
    return t("settings.passkeySynced");
  }
  return t("settings.passkeyDeviceBound");
}

function getTransportLabel(
  transports: string[],
  t: ReturnType<typeof useTranslations>,
) {
  if (transports.length === 0) return t("settings.passkeyTransportUnknown");
  return transports
    .map((transport) => {
      if (transport === "internal") return t("settings.passkeyTransportInternal");
      if (transport === "hybrid") return t("settings.passkeyTransportHybrid");
      if (transport === "usb") return t("settings.passkeyTransportUsb");
      if (transport === "nfc") return t("settings.passkeyTransportNfc");
      if (transport === "ble") return t("settings.passkeyTransportBle");
      return transport;
    })
    .join(" · ");
}

function getSensitiveActionPurpose(
  action: PasskeySensitiveAction | null,
  t: ReturnType<typeof useTranslations>,
) {
  if (action?.kind === "add-passkey") return t("settings.reauthPurposeAddPasskey");
  if (action?.kind === "delete-passkey") return t("settings.reauthPurposeDeletePasskey");
  if (action?.kind === "generate-recovery-codes") {
    return t("settings.reauthPurposeRecoveryCodes");
  }
  return t("settings.reauthPurposeSecurity");
}

function getSensitiveActionKey(action: PasskeySensitiveAction) {
  if (action.kind === "add-passkey") return "register";
  if (action.kind === "delete-passkey") return `delete:${action.passkeyId}`;
  return "recovery-codes";
}

function getSensitiveActionError(
  action: PasskeySensitiveAction,
  error: unknown,
  t: ReturnType<typeof useTranslations>,
) {
  const fallbackKey =
    action.kind === "add-passkey"
      ? "settings.passkeyAddFailed"
      : action.kind === "delete-passkey"
        ? "settings.passkeyRemoveFailed"
        : "settings.recoveryCodesGenerateFailed";
  return getDriveApiErrorMessage(error, t, { fallbackKey, scope: "form" });
}

function clearOAuthStepUpQuery(
  router: ReturnType<typeof useRouter>,
  searchParams: URLSearchParams,
) {
  const next = new URLSearchParams(searchParams);
  next.delete("oauthStepUpCode");
  next.set("tab", "security");
  router.replace(`/settings?${next.toString()}`);
}

function formatPasskeyDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
