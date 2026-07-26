"use client";

import type { FormEvent } from "react";
import { AppField } from "@/components/ui/app-field";
import { LocalIcon } from "@/components/ui/app-icon";
import { AppInput } from "@/components/ui/app-input";
import { SurfacePanel } from "@/components/ui/surface-panel";
import { ToolButton } from "@/components/ui/tool-button";
import type {
  SetupAccessNotice,
  SetupAccessPhase,
} from "@/features/setup/use-setup-access";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";

export function SetupAccessGate({
  busy,
  credential,
  notice,
  onAuthorize,
  onCredentialChange,
  onRetry,
  palette,
  phase,
}: {
  busy: boolean;
  credential: string;
  notice: SetupAccessNotice;
  onAuthorize: () => void;
  onCredentialChange: (value: string) => void;
  onRetry: () => void;
  palette: Palette;
  phase: Exclude<SetupAccessPhase, "authorized">;
}) {
  const t = useTranslations();
  const noticeMessage = resolveNoticeMessage(notice, t);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAuthorize();
  };

  return (
    <SurfacePanel
      aria-busy={busy}
      className="icedr-setup-access-panel"
      palette={palette}
    >
      <div className="icedr-setup-access-heading">
        <span
          className="icedr-setup-access-icon"
          style={{
            background: palette.selected,
            borderColor: palette.hairlineStrong,
            color: palette.primaryHover,
          }}
        >
          <LocalIcon name="lock" size={19} />
        </span>
        <div>
          <h1>{t("setup.accessTitle")}</h1>
        </div>
      </div>

      {phase === "loading" ? (
        <div className="icedr-setup-access-state" role="status">
          <LocalIcon name="refresh" size={17} />
          <span>{t("setup.accessChecking")}</span>
        </div>
      ) : phase === "unavailable" ? (
        <div className="icedr-setup-access-state" role="status">
          <span>{noticeMessage || t("setup.accessUnavailable")}</span>
          <ToolButton
            disabled={busy}
            isPending={busy}
            label={t("setup.accessRetry")}
            onClick={onRetry}
            palette={palette}
            tone="accent"
            visual="surface"
          >
            <LocalIcon name="refresh" size={17} />
          </ToolButton>
        </div>
      ) : (
        <form className="icedr-setup-access-form" onSubmit={submit}>
          <AppField
            errorText={noticeMessage || undefined}
            invalid={Boolean(noticeMessage)}
            label={t("setup.accessCredential")}
            palette={palette}
            required
          >
            <div className="icedr-setup-access-control">
              <AppInput
                autoCapitalize="none"
                autoComplete="off"
                disabled={busy}
                invalid={Boolean(noticeMessage)}
                onChange={(event) => onCredentialChange(event.target.value)}
                palette={palette}
                spellCheck={false}
                type="password"
                value={credential}
              />
              <ToolButton
                disabled={busy || !credential.trim()}
                isPending={busy}
                label={t("setup.accessContinue")}
                palette={palette}
                size="lg"
                tone="accent"
                type="submit"
                visual="surface"
              >
                <LocalIcon name="key" size={18} />
              </ToolButton>
            </div>
          </AppField>
        </form>
      )}
    </SurfacePanel>
  );
}

function resolveNoticeMessage(
  notice: SetupAccessNotice,
  translate: (key: string) => string,
) {
  if (notice === "expired") return translate("setup.accessExpired");
  if (notice === "invalid") return translate("setup.accessInvalid");
  if (notice === "status-failed") {
    return translate("setup.accessStatusFailed");
  }
  return "";
}
