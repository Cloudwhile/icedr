"use client";

import type { CSSProperties } from "react";
import { OAuthProviderMark } from "@/components/ui/oauth-provider-mark";
import type { OAuthProviderTemplate } from "@/extensions/oauth/provider-catalog";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type { OAuthSettings } from "@/lib/drive-api";
import {
  LocalIcon,
  StatusPill,
  ToolButton,
} from "@/views/drive/drive-primitives";

export function OAuthSummary({
  summary,
}: {
  summary: { active: number; configuredProviders: number; draft: number };
}) {
  const t = useTranslations();
  const items = [
    {
      label: t("admin.oauthConfiguredProviderCount"),
      tone: "neutral",
      value: summary.configuredProviders,
    },
    {
      label: t("admin.oauthActiveCount"),
      tone: "secure",
      value: summary.active,
    },
    {
      label: t("admin.oauthDraftCount"),
      tone: "risk",
      value: summary.draft,
    },
  ];

  return (
    <dl className="drive-oauth-summary">
      {items.map((item) => (
        <div data-tone={item.tone} key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OAuthProviderGroup({
  collapsed,
  onActivate,
  onCopy,
  onDeactivate,
  onDelete,
  onDuplicate,
  onEdit,
  onToggle,
  palette,
  providers,
  protectedActiveProviderId,
  savingKey,
  template,
}: {
  collapsed: boolean;
  onActivate: (provider: OAuthSettings) => void;
  onCopy: (value: string) => void;
  onDeactivate: (provider: OAuthSettings) => void;
  onDelete: (provider: OAuthSettings) => void;
  onDuplicate: (provider: OAuthSettings) => void;
  onEdit: (provider: OAuthSettings) => void;
  onToggle: () => void;
  palette: Palette;
  providers: OAuthSettings[];
  protectedActiveProviderId?: string;
  savingKey: string | null;
  template: OAuthProviderTemplate;
}) {
  const t = useTranslations();

  return (
    <section
      className="drive-oauth-provider-group"
      style={
        { "--oauth-provider-accent": template.accent } as CSSProperties
      }
    >
      <button
        aria-expanded={!collapsed}
        className="drive-oauth-provider-group-header"
        onClick={onToggle}
        type="button"
      >
        <OAuthProviderMark provider={template.key} />
        <span className="drive-oauth-provider-group-copy">
          <strong>{template.displayName}</strong>
        </span>
        <span className="drive-oauth-provider-count">
          {t("admin.oauthProviderConfigCount", { count: providers.length })}
        </span>
        <LocalIcon
          name={collapsed ? "arrow_right" : "arrow_down"}
          size={16}
        />
      </button>

      {!collapsed ? (
        <div className="drive-oauth-table-shell">
          <div className="drive-oauth-table drive-oauth-table-head">
            <span>{t("admin.oauthConfigName")}</span>
            <span>{t("admin.oauthClientId")}</span>
            <span>{t("admin.oauthRedirectUri")}</span>
            <span>{t("admin.oauthCreatedAt")}</span>
            <span>{t("admin.oauthStatus")}</span>
            <span>{t("admin.oauthActions")}</span>
          </div>
          {providers.length === 0 ? (
            <div className="drive-oauth-table-empty">
              {t("admin.oauthProviderEmpty")}
            </div>
          ) : (
            providers.map((provider) => (
              <OAuthProviderRow
                key={provider.id}
                onActivate={() => onActivate(provider)}
                onCopy={onCopy}
                onDeactivate={() => onDeactivate(provider)}
                onDelete={() => onDelete(provider)}
                onDuplicate={() => onDuplicate(provider)}
                onEdit={() => onEdit(provider)}
                palette={palette}
                protectedActive={protectedActiveProviderId === provider.id}
                provider={provider}
                savingKey={savingKey}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function OAuthProviderRow({
  onActivate,
  onCopy,
  onDeactivate,
  onDelete,
  onDuplicate,
  onEdit,
  palette,
  protectedActive,
  provider,
  savingKey,
}: {
  onActivate: () => void;
  onCopy: (value: string) => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  palette: Palette;
  protectedActive: boolean;
  provider: OAuthSettings;
  savingKey: string | null;
}) {
  const t = useTranslations();
  const profileLabel =
    provider.providerProfile === "oidc"
      ? "OIDC"
      : provider.providerProfile === "oauth2"
        ? "OAuth2"
        : t("admin.oauthCompatibilityMode");

  return (
    <div className="drive-oauth-table drive-oauth-table-row">
      <div
        className="drive-oauth-cell drive-oauth-config-name"
        data-label={t("admin.oauthConfigName")}
      >
        <strong className="icedr-truncate">{provider.displayName}</strong>
        <small>{profileLabel}</small>
      </div>
      <CopyCell
        label={t("admin.oauthClientId")}
        onCopy={() => onCopy(provider.clientId)}
        value={maskClientId(provider.clientId)}
      />
      <CopyCell
        label={t("admin.oauthRedirectUri")}
        onCopy={() => onCopy(provider.redirectUri)}
        value={provider.redirectUri || "--"}
      />
      <span
        className="drive-oauth-cell drive-oauth-muted"
        data-label={t("admin.oauthCreatedAt")}
      >
        {formatOAuthDate(provider.createdAt)}
      </span>
      <span
        className="drive-oauth-cell drive-oauth-status-cell"
        data-label={t("admin.oauthStatus")}
      >
        <StatusPill
          palette={palette}
          tone={
            provider.enabled
              ? "secure"
              : provider.configured
                ? "neutral"
                : "risk"
          }
        >
          {provider.enabled
            ? t("admin.oauthActive")
            : provider.configured
              ? t("admin.oauthInactive")
              : t("admin.oauthDraft")}
        </StatusPill>
      </span>
      <span
        className="drive-oauth-cell drive-oauth-row-actions"
        data-label={t("admin.oauthActions")}
      >
        <ToolButton
          label={t("actions.edit")}
          onClick={onEdit}
          palette={palette}
          size="sm"
          visual="surface"
        >
          <LocalIcon name="settings" size={16} />
        </ToolButton>
        <ToolButton
          label={t("actions.copy")}
          onClick={onDuplicate}
          palette={palette}
          size="sm"
          visual="surface"
        >
          <LocalIcon name="copy" size={16} />
        </ToolButton>
        {provider.enabled ? (
          <ToolButton
            disabled={protectedActive}
            isPending={savingKey === `deactivate:${provider.id}`}
            label={
              protectedActive
                ? t("admin.oauthLastActiveRequired")
                : t("admin.oauthDeactivate")
            }
            onClick={onDeactivate}
            palette={palette}
            size="sm"
            tone="danger"
            visual="surface"
          >
            <LocalIcon name="pause" size={16} />
          </ToolButton>
        ) : (
          <ToolButton
            disabled={!provider.configured}
            isPending={savingKey === `activate:${provider.id}`}
            label={t("admin.oauthActivate")}
            onClick={onActivate}
            palette={palette}
            size="sm"
            tone="success"
            visual="surface"
          >
            <LocalIcon name="tick" size={16} />
          </ToolButton>
        )}
        <ToolButton
          disabled={protectedActive}
          isPending={savingKey === `delete:${provider.id}`}
          label={
            protectedActive
              ? t("admin.oauthLastActiveRequired")
              : t("actions.deletePermanently")
          }
          onClick={onDelete}
          palette={palette}
          size="sm"
          tone="danger"
          visual="surface"
        >
          <LocalIcon name="trash" size={16} />
        </ToolButton>
      </span>
    </div>
  );
}

function CopyCell({
  label,
  onCopy,
  value,
}: {
  label: string;
  onCopy: () => void;
  value: string;
}) {
  const t = useTranslations();
  return (
    <span
      className="drive-oauth-cell drive-oauth-copy-cell"
      data-label={label}
    >
      <span className="icedr-truncate">{value}</span>
      <button aria-label={t("actions.copy")} onClick={onCopy} type="button">
        <LocalIcon name="copy" size={14} />
      </button>
    </span>
  );
}

function maskClientId(clientId: string) {
  const value = clientId.trim();
  if (!value) return "--";
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatOAuthDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "--";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
