"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useMemo, useState } from "react";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  createPasskeyStepUpOptions,
  reauthenticateWithPassword,
  reauthenticateWithRecoveryCode,
  verifyPasskeyStepUp,
  type AuthenticationMethodStatus,
  type AuthenticationStepUp,
} from "@/lib/drive-api";
import { getDriveApiErrorMessage } from "@/lib/drive-api-errors";
import { ActionButton } from "@/components/ui/action-button";
import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogShell,
  AppDialogTitle,
} from "@/components/ui/app-dialog-shell";
import { LocalIcon } from "@/components/ui/app-icon";
import { AppInput } from "@/components/ui/app-input";
import { ToolButton } from "@/components/ui/tool-button";
import {
  formatRecoveryCode,
  isValidPasswordLength,
  isValidRecoveryCode,
} from "@/features/auth/auth-input-validation";
import {
  assertPasskeyRequestContext,
  getPasskeyErrorNotice,
} from "@/features/auth/passkey-client-errors";
import "./security-dialogs.css";

type ReauthenticationMethod = "password" | "passkey" | "oauth" | "recovery";

export function SecurityReauthDialog({
  methods,
  onAuthenticated,
  onClose,
  onOAuthRedirect,
  open,
  palette,
  purpose,
}: {
  methods: AuthenticationMethodStatus["methods"] | null;
  onAuthenticated: (stepUp: AuthenticationStepUp) => void;
  onClose: () => void;
  onOAuthRedirect: () => Promise<void>;
  open: boolean;
  palette: Palette;
  purpose: string;
}) {
  const t = useTranslations();
  const availableMethods = useMemo(
    () => getAvailableMethods(methods),
    [methods],
  );
  const [selectedMethod, setSelectedMethod] = useState<ReauthenticationMethod | null>(
    () => availableMethods[0] ?? null,
  );
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const complete = (
    request: Promise<AuthenticationStepUp>,
    method: "default" | "passkey" = "default",
  ) => {
    setBusy(true);
    setError(null);
    void request
      .then(onAuthenticated)
      .catch((requestError) => {
        if (method === "passkey") {
          const notice = getPasskeyErrorNotice(
            requestError,
            t,
            "settings.reauthFailed",
          );
          if (notice) setError(notice.message);
          return;
        }
        setError(
          getDriveApiErrorMessage(requestError, t, {
            fallbackKey: "settings.reauthFailed",
            scope: "form",
          }),
        );
      })
      .finally(() => setBusy(false));
  };

  const submit = () => {
    if (busy || !selectedMethod) return;
    if (selectedMethod === "password") {
      if (!isValidPasswordLength(password)) {
        setError(t("auth.passwordLengthInvalid"));
        return;
      }
      complete(reauthenticateWithPassword(password));
      return;
    }
    if (selectedMethod === "recovery") {
      if (!isValidRecoveryCode(recoveryCode)) {
        setError(t("auth.recoveryCodeFormatInvalid"));
        return;
      }
      complete(reauthenticateWithRecoveryCode(formatRecoveryCode(recoveryCode)));
      return;
    }
    if (selectedMethod === "passkey") {
      complete(
        createPasskeyStepUpOptions().then((ceremony) => {
          assertPasskeyRequestContext(ceremony.options, ceremony.expectedOrigin);
          return startAuthentication({ optionsJSON: ceremony.options }).then(
            (response) =>
              verifyPasskeyStepUp({
                ceremonyId: ceremony.ceremonyId,
                response,
              }),
          );
        }),
        "passkey",
      );
      return;
    }
    setBusy(true);
    setError(null);
    void onOAuthRedirect()
      .catch((requestError) => {
        setError(
          getDriveApiErrorMessage(requestError, t, {
            fallbackKey: "settings.oauthReauthFailed",
            scope: "form",
          }),
        );
        setBusy(false);
      });
  };

  const submitDisabled =
    busy ||
    !selectedMethod ||
    (selectedMethod === "password" && !password) ||
    (selectedMethod === "recovery" && !recoveryCode.trim());

  return (
    <AppDialogShell
      className="icedr-security-reauth-dialog"
      onOpenChange={(nextOpen) => !nextOpen && close()}
      open={open}
      palette={palette}
      size="sm"
    >
      <AppDialogHeader className="icedr-security-dialog-header">
        <div className="icedr-security-dialog-heading">
          <LocalIcon name="shield" size={18} />
          <div>
            <AppDialogTitle>{t("settings.reauthTitle")}</AppDialogTitle>
            <span>{purpose}</span>
          </div>
        </div>
        <ToolButton
          disabled={busy}
          label={t("actions.close")}
          onClick={close}
          palette={palette}
        >
          <LocalIcon name="cross" size={16} />
        </ToolButton>
      </AppDialogHeader>
      <AppDialogBody>
        {availableMethods.length > 0 ? (
          <>
            <div
              aria-label={t("settings.reauthSelectMethod")}
              className="icedr-reauth-methods"
              role="tablist"
            >
              {availableMethods.map((method) => (
                <button
                  aria-selected={selectedMethod === method}
                  data-active={selectedMethod === method ? "true" : undefined}
                  disabled={busy}
                  key={method}
                  onClick={() => {
                    setSelectedMethod(method);
                    setError(null);
                  }}
                  role="tab"
                  type="button"
                >
                  <LocalIcon name={getMethodIcon(method)} size={16} />
                  <span>{t(getMethodLabelKey(method))}</span>
                </button>
              ))}
            </div>

            {selectedMethod === "password" ? (
              <label className="icedr-security-dialog-field">
                <span>{t("auth.password")}</span>
                <AppInput
                  autoComplete="current-password"
                  autoFocus
                  maxLength={128}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && submit()}
                  palette={palette}
                  type="password"
                  value={password}
                />
              </label>
            ) : null}

            {selectedMethod === "recovery" ? (
              <label className="icedr-security-dialog-field">
                <span>{t("auth.recoveryCode")}</span>
                <AppInput
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={32}
                  onChange={(event) => {
                    setRecoveryCode(formatRecoveryCode(event.target.value));
                    setError(null);
                  }}
                  onKeyDown={(event) => event.key === "Enter" && submit()}
                  palette={palette}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  value={recoveryCode}
                />
                <span>{t("settings.reauthRecoveryHint")}</span>
              </label>
            ) : null}

            {selectedMethod === "passkey" ? (
              <div className="icedr-security-dialog-method-copy">
                <LocalIcon name="key" size={18} />
                <span>{t("settings.reauthPasskeyHint")}</span>
              </div>
            ) : null}

            {selectedMethod === "oauth" ? (
              <div className="icedr-security-dialog-method-copy">
                <LocalIcon name="earth" size={18} />
                <span>{t("settings.reauthOAuthHint")}</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="icedr-security-dialog-unavailable">
            <LocalIcon name="exclamation" size={18} />
            <span>{t("settings.reauthUnavailable")}</span>
          </div>
        )}
        {error ? (
          <div className="icedr-security-dialog-error" role="alert">
            <LocalIcon name="exclamation" size={15} />
            <span>{error}</span>
          </div>
        ) : null}
      </AppDialogBody>
      <AppDialogFooter>
        <ActionButton
          disabled={submitDisabled}
          icon={<LocalIcon name="arrow_right" size={16} />}
          isPending={busy}
          onClick={submit}
          palette={palette}
          tone="primary"
        >
          {selectedMethod === "passkey"
            ? t("settings.reauthUsePasskey")
            : selectedMethod === "oauth"
              ? t("settings.reauthUseOAuth")
              : t("settings.reauthContinue")}
        </ActionButton>
      </AppDialogFooter>
    </AppDialogShell>
  );
}

function getAvailableMethods(
  methods: AuthenticationMethodStatus["methods"] | null,
): ReauthenticationMethod[] {
  if (!methods) return [];
  return [
    methods.password ? ("password" as const) : null,
    methods.passkey ? ("passkey" as const) : null,
    methods.oauth ? ("oauth" as const) : null,
    methods.recoveryCodes > 0 ? ("recovery" as const) : null,
  ].filter((method): method is ReauthenticationMethod => Boolean(method));
}

function getMethodIcon(method: ReauthenticationMethod) {
  if (method === "password") return "lock" as const;
  if (method === "passkey") return "key" as const;
  if (method === "oauth") return "earth" as const;
  return "shield" as const;
}

function getMethodLabelKey(method: ReauthenticationMethod) {
  if (method === "password") return "settings.authMethodPassword";
  if (method === "passkey") return "settings.authMethodPasskey";
  if (method === "oauth") return "settings.authMethodOAuth";
  return "settings.authMethodRecovery";
}
