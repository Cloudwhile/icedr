"use client";

import { Modal } from "@heroui/react";
import { MotionPresence } from "@/components/ui/motion";
import { SegmentedToolGroup } from "@/components/ui/segmented-tool-group";
import { isValidEmailAddress } from "@/features/auth/auth-input-validation";
import { formatFileSize, sumDriveItemSizes, type DriveItem, type Locale, type Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { AuthField, AuthInput, AuthPrimaryButton, AuthStatusNotice, type AuthNoticeStatus } from "./auth-form-primitives";
import { ItemIcon, LocalIcon, ToolButton } from "./drive-primitives";

type AccessPolicyExperience = {
  hasSpeedLimit: boolean;
  label: string;
  waitSeconds: number;
  speedLabel: string;
  sessionLabel: string;
};

type VisitorAccessAction = "download" | "preview";
type AuthMethod = "account" | "email";
type VisitorStage = "choose" | "email" | "code" | "verified" | "waiting" | "download";

export function ShareAuthDialog({
  accessExperience,
  accessItem,
  action,
  accountConfigured,
  authMethod,
  busy,
  code,
  email,
  emailStatus,
  locale,
  onAccountAuth,
  onChangeEmail,
  onCodeChange,
  onClose,
  onComplete,
  onContinue,
  onEmailChange,
  onMethodChange,
  onResendCode,
  onSendCode,
  onVerifyCode,
  open,
  palette,
  remaining,
  sendCooldownSeconds,
  sourceItems,
  stage,
  verifyCooldownSeconds,
}: {
  accessExperience: AccessPolicyExperience;
  accessItem: DriveItem | null;
  action: VisitorAccessAction;
  accountConfigured: boolean;
  authMethod: AuthMethod;
  busy: boolean;
  code: string;
  email: string;
  emailStatus: AuthNoticeStatus | null;
  locale: Locale;
  onAccountAuth: () => void;
  onChangeEmail: () => void;
  onCodeChange: (value: string) => void;
  onClose: () => void;
  onComplete: () => void;
  onContinue: () => void;
  onEmailChange: (value: string) => void;
  onMethodChange: (method: AuthMethod) => void;
  onResendCode: () => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  open: boolean;
  palette: Palette;
  remaining: number;
  sendCooldownSeconds: number;
  sourceItems: DriveItem[];
  stage: VisitorStage;
  verifyCooldownSeconds: number;
}) {
  const t = useTranslations();
  const experience: AccessPolicyExperience = {
    ...accessExperience,
    waitSeconds: remaining,
  };
  const canSendCode = isValidEmailAddress(email.trim()) && !busy && sendCooldownSeconds <= 0;
  const canVerifyCode = code.length === 6 && !busy && verifyCooldownSeconds <= 0;
  const showAuthMethodSelector = stage === "choose" || stage === "email" || stage === "code";
  const actionLabel = action === "download" ? t("actions.download") : t("share.openPreview");

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      style={{ background: "rgba(0, 0, 0, 0.48)" }}
    >
      <Modal.Container placement="center">
        <Modal.Dialog
          style={{
            background: palette.canvas,
            color: palette.ink,
            borderWidth: "1px",
            borderColor: palette.hairlineStrong,
            borderRadius: "8px",
            maxWidth: "420px",
            overflow: "hidden",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.48)",
          }}
        >
          <Modal.Header
            style={{
              borderBottomWidth: "1px",
              borderColor: palette.hairline,
              paddingInline: "16px",
              paddingBlock: "12px",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                width: "100%",
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "12px",
                  minWidth: "0px",
                }}
              >
                {accessItem ? (
                  <ItemIcon item={accessItem} palette={palette} size={18} />
                ) : (
                  <LocalIcon name={action === "download" ? "download" : "visible"} size={18} color={palette.primaryHover} />
                )}
                <div style={{ minWidth: "0px" }}>
                  <Modal.Heading className="icedr-truncate" style={{ fontWeight: "600" }}>
                    {accessItem?.name ?? actionLabel}
                  </Modal.Heading>
                  <span style={{ color: palette.subtle, fontSize: "12px", marginTop: "4px" }}>
                    {accessItem ? formatFileSize(sumDriveItemSizes([accessItem], sourceItems), locale) : actionLabel}
                  </span>
                </div>
              </div>
              <ToolButton label={t("app.close")} palette={palette} onClick={onClose}>
                <LocalIcon name="cross" size={17} />
              </ToolButton>
            </div>
          </Modal.Header>

          <Modal.Body style={{ padding: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ color: palette.ink, fontWeight: "650" }}>{t("share.visitorAccessTitle")}</span>
                <AuthStatusNotice
                  palette={palette}
                  status={{
                    message: t("share.visitorAccessHint"),
                    tone: "info",
                  }}
                />
              </div>

              {showAuthMethodSelector ? (
                <SegmentedToolGroup
                  ariaLabel={`${t("share.accountLogin")} / ${t("share.temporaryEmail")}`}
                  onChange={onMethodChange}
                  options={[
                    {
                      icon: <LocalIcon name="user_check" size={17} />,
                      label: t("share.accountLogin"),
                      value: "account",
                    },
                    {
                      icon: <LocalIcon name="mail" size={17} />,
                      label: t("share.temporaryEmail"),
                      value: "email",
                    },
                  ]}
                  palette={palette}
                  value={authMethod}
                />
              ) : null}

              {authMethod === "email" && emailStatus ? (
                <AuthStatusNotice palette={palette} status={emailStatus} />
              ) : null}

              <MotionPresence show={authMethod === "account" && stage === "choose"} preset="surface">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <AuthStatusNotice
                    palette={palette}
                    status={{
                      message: accountConfigured ? t("share.icaConfigured") : t("share.icaUnavailable"),
                      tone: accountConfigured ? "success" : "error",
                    }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
                    <AuthPrimaryButton
                      icon="key"
                      palette={palette}
                      disabled={busy}
                      busy={busy}
                      onClick={onAccountAuth}
                    >
                      {accountConfigured ? t("share.useIcaIdentity") : t("auth.login")}
                    </AuthPrimaryButton>
                  </div>
                </div>
              </MotionPresence>

              <MotionPresence show={authMethod === "email" && stage === "email"} preset="surface">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <AuthField label={t("share.emailPrompt")} palette={palette} required>
                    <AuthInput
                      autoComplete="email"
                      palette={palette}
                      placeholder={t("share.emailPlaceholder")}
                      type="email"
                      value={email}
                      onChange={(event) => onEmailChange(event.target.value)}
                    />
                  </AuthField>
                  <AuthPrimaryButton
                    icon="mail"
                    palette={palette}
                    disabled={!canSendCode}
                    busy={busy}
                    onClick={onSendCode}
                  >
                    {busy ? t("auth.working") : t("share.sendCode")}
                  </AuthPrimaryButton>
                </div>
              </MotionPresence>

              <MotionPresence show={authMethod === "email" && stage === "code"} preset="surface">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <AuthField label={t("share.codePrompt")} palette={palette} required>
                    <AuthInput
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      palette={palette}
                      placeholder="000000"
                      value={code}
                      onChange={(event) =>
                        onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                  </AuthField>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <ToolButton
                      label={t("auth.changeResetEmail")}
                      palette={palette}
                      disabled={busy}
                      onClick={onChangeEmail}
                      size="sm"
                      visual="surface"
                    >
                      <LocalIcon name="arrow_left" size={15} />
                    </ToolButton>
                    <ToolButton
                      label={t("auth.resendCode")}
                      palette={palette}
                      disabled={busy || sendCooldownSeconds > 0}
                      onClick={onResendCode}
                      size="sm"
                      visual="surface"
                    >
                      <LocalIcon name="refresh" size={15} />
                    </ToolButton>
                  </div>
                  <AuthPrimaryButton
                    icon="key"
                    palette={palette}
                    disabled={!canVerifyCode}
                    busy={busy}
                    onClick={onVerifyCode}
                  >
                    {busy ? t("auth.working") : t("share.verifyCode")}
                  </AuthPrimaryButton>
                </div>
              </MotionPresence>

              <MotionPresence show={stage === "verified"} preset="surface">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <AuthStatusNotice
                    palette={palette}
                    status={{
                      message: t("share.verificationSucceeded", {
                        identity: experience.label,
                      }),
                      tone: "success",
                    }}
                  />
                  <span style={{ color: palette.subtle, fontSize: "12px" }}>
                    {experience.waitSeconds > 0
                      ? t("share.nextWait", {
                          seconds: experience.waitSeconds,
                        })
                      : t("share.ready")}
                  </span>
                  <span style={{ color: palette.subtle, fontSize: "12px" }}>
                    {t("share.speedValue", {
                      speed: experience.speedLabel,
                    })}{" "}
                    / {experience.sessionLabel}
                  </span>
                  <AuthPrimaryButton icon="download" palette={palette} onClick={onContinue}>
                    {t("share.continue")}
                  </AuthPrimaryButton>
                </div>
              </MotionPresence>

              <MotionPresence show={stage === "waiting"} preset="surface">
                <AuthStatusNotice
                  palette={palette}
                  status={{
                    message: t("share.preparing", {
                      seconds: remaining,
                    }),
                    tone: "info",
                  }}
                />
              </MotionPresence>

              <MotionPresence show={stage === "download"} preset="surface">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <AuthStatusNotice
                    palette={palette}
                    status={{
                      message: !experience.hasSpeedLimit
                        ? t("share.ready")
                        : t("share.speedValue", {
                            speed: experience.speedLabel,
                          }),
                      tone: "success",
                    }}
                  />
                  <AuthPrimaryButton icon={action === "download" ? "download" : "visible"} palette={palette} onClick={onComplete}>
                    {actionLabel}
                  </AuthPrimaryButton>
                </div>
              </MotionPresence>
            </div>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
