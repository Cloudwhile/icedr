"use client";

import { Modal } from "@heroui/react";
import { MotionPresence } from "@/components/ui/motion";
import { formatFileSize, sumDriveItemSizes, type DriveItem, type Locale, type Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { AuthPrimaryButton, AuthStatusNotice } from "./auth-form-primitives";
import { ItemIcon, LocalIcon, ToolButton } from "./drive-primitives";

type AccessPolicyExperience = {
  hasSpeedLimit: boolean;
  label: string;
  waitSeconds: number;
  speedLabel: string;
  sessionLabel: string;
};

type VisitorAccessAction = "download" | "preview";
type VisitorStage = "choose" | "verified" | "waiting" | "download";

export function ShareAuthDialog({
  accessExperience,
  accessItem,
  action,
  accountConfigured,
  busy,
  locale,
  onAccountAuth,
  onClose,
  onComplete,
  onContinue,
  open,
  palette,
  remaining,
  sourceItems,
  stage,
}: {
  accessExperience: AccessPolicyExperience;
  accessItem: DriveItem | null;
  action: VisitorAccessAction;
  accountConfigured: boolean;
  busy: boolean;
  locale: Locale;
  onAccountAuth: () => void;
  onClose: () => void;
  onComplete: () => void;
  onContinue: () => void;
  open: boolean;
  palette: Palette;
  remaining: number;
  sourceItems: DriveItem[];
  stage: VisitorStage;
}) {
  const t = useTranslations();
  const experience: AccessPolicyExperience = {
    ...accessExperience,
    waitSeconds: remaining,
  };
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

              <MotionPresence show={stage === "choose"} preset="surface">
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
                      disabled={!accountConfigured || busy}
                      busy={busy}
                      onClick={onAccountAuth}
                    >
                      {t("share.useIcaIdentity")}
                    </AuthPrimaryButton>
                  </div>
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
