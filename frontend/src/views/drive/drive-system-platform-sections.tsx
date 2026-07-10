"use client";

import {
  SystemBlockActions,
  SystemConfigBlock,
} from "@/components/admin/system-config-block";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type { MailSettings, StorageSettings } from "@/lib/drive-api";
import { AuthField, AuthInput } from "./auth-form-primitives";
import { LocalIcon, ToolButton } from "./drive-primitives";
import {
  InlineConfigPanel,
  PolicyCheck,
  RadioRow,
  SettingStatusLine,
} from "./external-share-admin-primitives";

export function PlatformDeliverySection({
  mail,
  mailDirty,
  mailPassword,
  mailTestEmail,
  onMailChange,
  onPasswordChange,
  onSave,
  onTest,
  onTestEmailChange,
  palette,
  savingKey,
}: {
  mail: MailSettings;
  mailDirty: boolean;
  mailPassword: string;
  mailTestEmail: string;
  onMailChange: (patch: Partial<MailSettings>) => void;
  onPasswordChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onTestEmailChange: (value: string) => void;
  palette: Palette;
  savingKey: string | null;
}) {
  const t = useTranslations();
  return (
    <SystemConfigBlock
      actions={
        <SystemBlockActions>
          <ToolButton
            disabled={
              !mail.enabled || !(mailTestEmail || mail.fromEmail).trim()
            }
            isPending={savingKey === "mail-test"}
            label={t("admin.testMail")}
            palette={palette}
            onClick={onTest}
            visual="surface"
          >
            <LocalIcon name="mail" size={17} />
          </ToolButton>
          <ToolButton
            disabled={!mailDirty}
            isPending={savingKey === "mail"}
            label={t("admin.save")}
            palette={palette}
            onClick={onSave}
            visual="surface"
          >
            <LocalIcon name="save" size={17} />
          </ToolButton>
        </SystemBlockActions>
      }
      description={t("settings.mailSettingsSubtitle")}
      icon="mail"
      id="mail-settings"
      palette={palette}
      title={t("admin.mailSettings")}
    >
      <PolicyCheck
        checked={mail.enabled}
        label={t("admin.smtpEnabled")}
        onToggle={() => onMailChange({ enabled: !mail.enabled })}
        palette={palette}
      />
      <div className="drive-system-control-grid">
        <AuthField label={t("admin.smtpHost")} palette={palette}>
          <AuthInput
            palette={palette}
            value={mail.host}
            onChange={(event) => onMailChange({ host: event.target.value })}
          />
        </AuthField>
        <AuthField label={t("admin.smtpPort")} palette={palette}>
          <AuthInput
            inputMode="numeric"
            palette={palette}
            value={String(mail.port)}
            onChange={(event) =>
              onMailChange({
                port: Math.max(
                  1,
                  Number(event.target.value.replace(/\D/g, "")) || 1,
                ),
              })
            }
          />
        </AuthField>
        <AuthField label={t("admin.smtpUsername")} palette={palette}>
          <AuthInput
            palette={palette}
            value={mail.username}
            onChange={(event) => onMailChange({ username: event.target.value })}
          />
        </AuthField>
        <AuthField label={t("admin.smtpPassword")} palette={palette}>
          <AuthInput
            palette={palette}
            placeholder={
              mail.passwordConfigured ? t("admin.secretConfigured") : ""
            }
            type="password"
            value={mailPassword}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </AuthField>
        <AuthField label={t("admin.smtpFromName")} palette={palette}>
          <AuthInput
            palette={palette}
            value={mail.fromName}
            onChange={(event) => onMailChange({ fromName: event.target.value })}
          />
        </AuthField>
        <AuthField label={t("admin.smtpFromEmail")} palette={palette}>
          <AuthInput
            palette={palette}
            type="email"
            value={mail.fromEmail}
            onChange={(event) =>
              onMailChange({ fromEmail: event.target.value })
            }
          />
        </AuthField>
        <AuthField label={t("admin.smtpReplyTo")} palette={palette}>
          <AuthInput
            palette={palette}
            type="email"
            value={mail.replyTo}
            onChange={(event) => onMailChange({ replyTo: event.target.value })}
          />
        </AuthField>
        <AuthField label={t("admin.smtpTestEmail")} palette={palette}>
          <AuthInput
            palette={palette}
            placeholder={mail.fromEmail || t("admin.smtpTestEmail")}
            type="email"
            value={mailTestEmail}
            onChange={(event) => onTestEmailChange(event.target.value)}
          />
        </AuthField>
      </div>
      <PolicyCheck
        checked={mail.secure}
        label={t("admin.smtpSecure")}
        onToggle={() => onMailChange({ secure: !mail.secure })}
        palette={palette}
      />
      <SettingStatusLine
        icon={mail.verifiedAt ? "tick" : "exclamation"}
        palette={palette}
        tone={mail.verifiedAt ? "secure" : "risk"}
      >
        {mail.verifiedAt ? t("admin.smtpVerified") : t("admin.smtpNeedsTest")}
      </SettingStatusLine>
    </SystemConfigBlock>
  );
}

export function PlatformStorageSection({
  canTestStorage,
  onChoiceChange,
  onDraftChange,
  onSave,
  onSecretChange,
  onTest,
  palette,
  savingKey,
  storageChoice,
  storageDirty,
  storageDraft,
  storageSecret,
}: {
  canTestStorage: boolean;
  onChoiceChange: (value: boolean) => void;
  onDraftChange: (patch: Partial<StorageSettings>) => void;
  onSave: () => void;
  onSecretChange: (value: string) => void;
  onTest: () => void;
  palette: Palette;
  savingKey: string | null;
  storageChoice: boolean;
  storageDirty: boolean;
  storageDraft: StorageSettings;
  storageSecret: string;
}) {
  const t = useTranslations();

  return (
    <SystemConfigBlock
      actions={
        <SystemBlockActions>
          <ToolButton
            disabled={!canTestStorage}
            isPending={savingKey === "storage-test"}
            label={t("admin.testObjectStorage")}
            palette={palette}
            onClick={onTest}
            visual="surface"
          >
            <LocalIcon name="shield" size={17} />
          </ToolButton>
          <ToolButton
            disabled={!storageDirty}
            isPending={savingKey === "storage-backend"}
            label={t("admin.save")}
            palette={palette}
            onClick={onSave}
            visual="surface"
          >
            <LocalIcon name="save" size={17} />
          </ToolButton>
        </SystemBlockActions>
      }
      description={t("settings.storageBackendSubtitle")}
      icon="folder"
      id="storage-backend"
      palette={palette}
      title={t("admin.fileStorage")}
    >
      <div className="drive-system-control-grid">
        <RadioRow
          active={storageChoice}
          label={t("admin.objectFileStorage")}
          onClick={() => onChoiceChange(true)}
          palette={palette}
        />
        <RadioRow
          active={!storageChoice}
          label={t("admin.localFileStorage")}
          onClick={() => onChoiceChange(false)}
          palette={palette}
        />
      </div>
      <SettingStatusLine icon="info" palette={palette} tone="neutral">
        {storageChoice
          ? t("admin.objectStorageHint")
          : t("admin.localStorageHint", {
              path: storageDraft.localRoot || "data/local-files",
            })}
      </SettingStatusLine>
      {storageChoice ? (
        <InlineConfigPanel palette={palette}>
          <div className="drive-system-control-grid">
            <AuthField label={t("admin.s3Endpoint")} palette={palette}>
              <AuthInput
                palette={palette}
                value={storageDraft.endpoint}
                onChange={(event) =>
                  onDraftChange({ endpoint: event.target.value })
                }
              />
            </AuthField>
            <AuthField label={t("admin.s3Region")} palette={palette}>
              <AuthInput
                palette={palette}
                value={storageDraft.region}
                onChange={(event) =>
                  onDraftChange({ region: event.target.value })
                }
              />
            </AuthField>
            <AuthField label={t("admin.s3Bucket")} palette={palette}>
              <AuthInput
                palette={palette}
                value={storageDraft.bucket}
                onChange={(event) =>
                  onDraftChange({ bucket: event.target.value })
                }
              />
            </AuthField>
            <AuthField label={t("admin.s3AccessKeyId")} palette={palette}>
              <AuthInput
                palette={palette}
                value={storageDraft.accessKeyId}
                onChange={(event) =>
                  onDraftChange({ accessKeyId: event.target.value })
                }
              />
            </AuthField>
            <AuthField label={t("admin.s3SecretAccessKey")} palette={palette}>
              <AuthInput
                palette={palette}
                placeholder={
                  storageDraft.secretAccessKeyConfigured
                    ? t("admin.secretConfigured")
                    : ""
                }
                type="password"
                value={storageSecret}
                onChange={(event) => onSecretChange(event.target.value)}
              />
            </AuthField>
            <PolicyCheck
              checked={storageDraft.forcePathStyle}
              label={t("admin.s3ForcePathStyle")}
              onToggle={() =>
                onDraftChange({ forcePathStyle: !storageDraft.forcePathStyle })
              }
              palette={palette}
            />
          </div>
          <SettingStatusLine
            icon={
              storageDirty
                ? "info"
                : storageDraft.objectStorageConfigured
                  ? "tick"
                  : "exclamation"
            }
            palette={palette}
            tone={
              storageDirty
                ? "neutral"
                : storageDraft.objectStorageConfigured
                  ? "secure"
                  : "risk"
            }
          >
            {storageDirty
              ? t("admin.storageUnsavedChanges")
              : storageDraft.objectStorageConfigured
                ? t("admin.objectStorageConfigured")
                : t("admin.objectStorageMissing")}
          </SettingStatusLine>
          <SettingStatusLine icon="info" palette={palette} tone="neutral">
            {t("admin.storageSwitchWarning")}
          </SettingStatusLine>
        </InlineConfigPanel>
      ) : null}
    </SystemConfigBlock>
  );
}
