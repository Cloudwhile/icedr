"use client";

import {
  useMemo,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { EChart, type EChartOption } from "@/components/ui/e-chart";
import { useTranslations } from "@/i18n/react";
import type {
  FilePolicySettings,
  StorageUsageBreakdown,
} from "@/lib/drive-api";
import {
  formatFileSize,
  getIntlLocale,
  type Locale,
  type Palette,
} from "@/features/file/model";
import { LocalIcon, ToolButton } from "./drive-primitives";
import {
  formatSystemDate,
  normalizeQuotaInput,
  quotaUnits,
  type QuotaDraftState,
  type QuotaUnit,
} from "./drive-system-settings-helpers";

export function StoragePolicySection({
  defaultUserQuotaDraft,
  locale,
  onDefaultUserQuotaUnitChange,
  onDefaultUserQuotaValueChange,
  onQuotaUnitChange,
  onQuotaValueChange,
  onRefreshUsage,
  onSaveQuota,
  onSaveUserQuota,
  onUserQuotaDraftChange,
  onUserQuotaEmailChange,
  onUserQuotaUnitChange,
  palette,
  quotaDraft,
  savingKey,
  storagePolicyRows,
  usageBreakdown,
  usageRows,
  userQuotaDraft,
  userQuotaEmail,
  userQuotaUnit,
}: {
  defaultUserQuotaDraft: QuotaDraftState;
  locale: Locale;
  onDefaultUserQuotaUnitChange: (unit: QuotaUnit) => void;
  onDefaultUserQuotaValueChange: (value: string) => void;
  onQuotaUnitChange: (unit: QuotaUnit) => void;
  onQuotaValueChange: (value: string) => void;
  onRefreshUsage: () => void;
  onSaveQuota: () => void;
  onSaveUserQuota: () => void;
  onUserQuotaDraftChange: (value: string) => void;
  onUserQuotaEmailChange: (value: string) => void;
  onUserQuotaUnitChange: (unit: QuotaUnit) => void;
  palette: Palette;
  quotaDraft: QuotaDraftState;
  savingKey: string | null;
  storagePolicyRows: Array<{ label: string; value: string }>;
  usageBreakdown: StorageUsageBreakdown | null;
  usageRows: Array<{ label: string; value: string }>;
  userQuotaDraft: string;
  userQuotaEmail: string;
  userQuotaUnit: QuotaUnit;
}) {
  const t = useTranslations();
  return (
    <SettingsBlock
      actions={
        <BlockActions>
          <ToolButton
            isPending={savingKey === "usage"}
            label={t("app.refresh")}
            palette={palette}
            onClick={onRefreshUsage}
            visual="surface"
          >
            <LocalIcon name="refresh" size={17} />
          </ToolButton>
          <ToolButton
            isPending={savingKey === "user-quota"}
            label={t("settings.userQuota")}
            palette={palette}
            onClick={onSaveUserQuota}
            visual="surface"
          >
            <LocalIcon name="user_check" size={17} />
          </ToolButton>
          <ToolButton
            isPending={savingKey === "quota"}
            label={t("admin.save")}
            palette={palette}
            onClick={onSaveQuota}
            visual="surface"
          >
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </BlockActions>
      }
      id="storage-policy"
      icon="file"
      palette={palette}
      subtitle={t("settings.storagePolicySubtitle")}
      title={t("settings.storagePolicy")}
    >
      <div className="drive-system-control-grid drive-system-quota-grid">
        <QuotaField
          label={t("settings.storagePolicyQuota")}
          onUnitChange={onQuotaUnitChange}
          onValueChange={onQuotaValueChange}
          palette={palette}
          unit={quotaDraft.unit}
          value={quotaDraft.value}
        />
        <QuotaField
          label={t("settings.defaultUserQuota")}
          onUnitChange={onDefaultUserQuotaUnitChange}
          onValueChange={onDefaultUserQuotaValueChange}
          palette={palette}
          unit={defaultUserQuotaDraft.unit}
          value={defaultUserQuotaDraft.value}
        />
        <SettingsField label={t("settings.userQuotaEmail")}>
          <AppInput
            inputMode="email"
            palette={palette}
            value={userQuotaEmail}
            onChange={(event) => onUserQuotaEmailChange(event.target.value)}
          />
        </SettingsField>
        <QuotaField
          label={t("settings.userQuota")}
          onUnitChange={onUserQuotaUnitChange}
          onValueChange={onUserQuotaDraftChange}
          palette={palette}
          unit={userQuotaUnit}
          value={userQuotaDraft}
        />
      </div>
      <div className="drive-system-policy-strip">
        {storagePolicyRows.map((row) => (
          <SettingsFact key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
      <div className="drive-system-usage-grid">
        {usageRows.map((row) => (
          <div className="drive-settings-fact" key={row.label}>
            <span className="drive-settings-label">{row.label}</span>
            <span className="drive-settings-value icedr-truncate">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {usageBreakdown ? (
        <div className="drive-system-breakdown-grid">
          <UsageBreakdownList
            items={usageBreakdown.byUser}
            locale={locale}
            title={t("settings.usageByUser")}
          />
          <UsageBreakdownList
            items={usageBreakdown.byDirectory}
            locale={locale}
            title={t("settings.usageByDirectory")}
          />
          <UsageBreakdownList
            items={usageBreakdown.byType}
            locale={locale}
            title={t("settings.usageByType")}
          />
          <UsageTrendSummary
            locale={locale}
            palette={palette}
            points={usageBreakdown.trend}
            title={t("settings.usageTrend")}
          />
        </div>
      ) : null}
    </SettingsBlock>
  );
}

export function LifecyclePolicySection({
  locale,
  onPolicyChange,
  onSavePolicy,
  palette,
  policy,
  savingKey,
}: {
  locale: Locale;
  onPolicyChange: Dispatch<SetStateAction<FilePolicySettings>>;
  onSavePolicy: () => void;
  palette: Palette;
  policy: FilePolicySettings;
  savingKey: string | null;
}) {
  const t = useTranslations();
  return (
    <SettingsBlock
      actions={
        <BlockActions>
          <ToolButton
            isPending={savingKey === "policy"}
            label={t("admin.save")}
            palette={palette}
            onClick={onSavePolicy}
            visual="surface"
          >
            <LocalIcon name="tick" size={17} />
          </ToolButton>
        </BlockActions>
      }
      id="lifecycle-policy"
      icon="trash"
      palette={palette}
      subtitle={t("settings.lifecyclePolicySubtitle")}
      title={t("settings.lifecyclePolicy")}
    >
      <div className="drive-system-control-grid">
        <SettingsSelectRow
          label={t("settings.trashRetentionDays")}
          onChange={(value) =>
            onPolicyChange((current) => ({
              ...current,
              trashRetentionDays: Number(value),
            }))
          }
          options={["7", "30", "90", "180", "365"]}
          palette={palette}
          value={String(policy.trashRetentionDays)}
        />
        <SettingsSelectRow
          label={t("settings.versionRetentionCount")}
          onChange={(value) =>
            onPolicyChange((current) => ({
              ...current,
              versionRetentionCount: Number(value),
            }))
          }
          options={["5", "10", "20", "50", "100"]}
          palette={palette}
          value={String(policy.versionRetentionCount)}
        />
        <SettingsSelectRow
          label={t("settings.versionRetentionDays")}
          onChange={(value) =>
            onPolicyChange((current) => ({
              ...current,
              versionRetentionDays: Number(value),
            }))
          }
          options={["30", "90", "180", "365", "730"]}
          palette={palette}
          value={String(policy.versionRetentionDays)}
        />
      </div>
      <div className="drive-system-fact-grid">
        <SettingsFact
          label={t("settings.lastUpdated")}
          value={formatSystemDate(policy.updatedAt, locale)}
        />
      </div>
    </SettingsBlock>
  );
}

function SettingsBlock({
  actions,
  children,
  icon,
  id,
  palette,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  icon: ComponentProps<typeof LocalIcon>["name"];
  id: string;
  palette: Palette;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="drive-system-settings-block" id={id}>
      <header className="drive-system-settings-block-header">
        <span className="drive-system-settings-block-title">
          <LocalIcon name={icon} size={17} color={palette.primaryHover} />
          <span className="drive-system-settings-block-heading">
            <span>{title}</span>
            {subtitle ? <small>{subtitle}</small> : null}
          </span>
        </span>
        {actions}
      </header>
      {children}
    </section>
  );
}

function SettingsField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="drive-settings-field">
      <span className="drive-settings-label">{label}</span>
      {children}
    </label>
  );
}

function QuotaField({
  label,
  onUnitChange,
  onValueChange,
  palette,
  unit,
  value,
}: {
  label: string;
  onUnitChange: (unit: QuotaUnit) => void;
  onValueChange: (value: string) => void;
  palette: Palette;
  unit: QuotaUnit;
  value: string;
}) {
  const t = useTranslations();
  const unitOptions = quotaUnits.map((quotaUnit) => ({
    label: t(quotaUnit.key),
    value: quotaUnit.value,
  }));
  return (
    <SettingsField label={label}>
      <div className="drive-quota-field">
        <AppInput
          inputMode="decimal"
          palette={palette}
          placeholder={t("settings.unlimitedQuota")}
          value={value}
          onChange={(event) =>
            onValueChange(normalizeQuotaInput(event.target.value))
          }
        />
        <AppSelect
          aria-label={`${label} ${t("settings.quotaUnit")}`}
          onChange={(event) => onUnitChange(event.target.value as QuotaUnit)}
          options={unitOptions}
          palette={palette}
          value={unit}
        />
      </div>
    </SettingsField>
  );
}

function SettingsSelectRow({
  label,
  onChange,
  options = ["true", "false"],
  palette,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options?: string[];
  palette: Palette;
  value: string;
}) {
  const t = useTranslations();
  const mappedOptions = options.map((option) => ({
    label:
      option === "true"
        ? t("setup.toggleEnabled")
        : option === "false"
          ? t("setup.toggleDisabled")
          : option,
    value: option,
  }));
  return (
    <div className="drive-settings-option-row">
      <span className="drive-settings-label">{label}</span>
      <AppSelect
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        options={mappedOptions}
        palette={palette}
        value={value}
      />
    </div>
  );
}

function SettingsFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="drive-settings-fact">
      <span className="drive-settings-label">{label}</span>
      <span className="drive-settings-value icedr-truncate">{value}</span>
    </div>
  );
}

export function SettingsSideCard({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ComponentProps<typeof LocalIcon>["name"];
  title: string;
}) {
  return (
    <section className="drive-system-side-card">
      <header className="drive-system-side-card-header">
        <LocalIcon name={icon} size={16} />
        <span className="icedr-truncate">{title}</span>
      </header>
      <div className="drive-system-side-card-body">{children}</div>
    </section>
  );
}

export function SettingsSideRow({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "secure";
  value: string;
}) {
  return (
    <div className="drive-system-side-row">
      <span>{label}</span>
      <span data-tone={tone} className="icedr-truncate">
        {value}
      </span>
    </div>
  );
}

function UsageBreakdownList({
  items,
  locale,
  title,
}: {
  items: Array<{ bytes: number; count: number; id: string; label: string }>;
  locale: Locale;
  title: string;
}) {
  return (
    <div className="drive-system-breakdown-panel">
      <span>{title}</span>
      {items.slice(0, 5).map((item) => (
        <div key={item.id}>
          <span className="icedr-truncate">{item.label}</span>
          <span>{formatFileSize(item.bytes, locale)}</span>
        </div>
      ))}
      {items.length === 0 ? (
        <div>
          <span>--</span>
          <span>--</span>
        </div>
      ) : null}
    </div>
  );
}

function UsageTrendSummary({
  locale,
  palette,
  points,
  title,
}: {
  locale: Locale;
  palette: Palette;
  points: Array<{ bytes: number; count: number; date: string }>;
  title: string;
}) {
  const t = useTranslations();
  const totalBytes = points.reduce((sum, point) => sum + point.bytes, 0);
  const totalCount = points.reduce((sum, point) => sum + point.count, 0);
  const trendOption = useMemo(
    () => buildSystemUsageTrendOption(points, palette, locale, t),
    [locale, palette, points, t],
  );

  return (
    <div className="drive-system-breakdown-panel drive-system-trend-panel">
      <span>{title}</span>
      <EChart
        ariaLabel={title}
        className="drive-system-trend-echart"
        option={trendOption}
      />
      <div>
        <span>{points[0]?.date ?? "--"}</span>
        <span>{points.at(-1)?.date ?? "--"}</span>
      </div>
      <div>
        <span>{totalCount}</span>
        <span>{formatFileSize(totalBytes, locale)}</span>
      </div>
    </div>
  );
}

function buildSystemUsageTrendOption(
  points: Array<{ bytes: number; count: number; date: string }>,
  palette: Palette,
  locale: Locale,
  t: ReturnType<typeof useTranslations>,
): EChartOption {
  const dateFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "2-digit",
    day: "2-digit",
  });
  const normalizedPoints =
    points.length > 0 ? points : [{ bytes: 0, count: 0, date: "--" }];
  const labels = normalizedPoints.map((point) => {
    const date = new Date(`${point.date}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
      ? point.date
      : dateFormatter.format(date);
  });

  return {
    animationDuration: 460,
    animationEasing: "cubicOut",
    backgroundColor: "transparent",
    grid: { bottom: 18, containLabel: false, left: 8, right: 8, top: 10 },
    series: [
      {
        areaStyle: {
          color: {
            colorStops: [
              { color: "rgba(94, 106, 210, 0.18)", offset: 0 },
              { color: "rgba(94, 106, 210, 0.02)", offset: 1 },
            ],
            type: "linear",
            x: 0,
            x2: 0,
            y: 0,
            y2: 1,
          },
        },
        data: normalizedPoints.map((point) => ({
          count: point.count,
          date: point.date,
          value: point.bytes,
        })),
        itemStyle: { color: palette.primary },
        lineStyle: { color: palette.primary, width: 2.5 },
        showSymbol: true,
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        type: "line",
      },
    ],
    tooltip: {
      backgroundColor: palette.surface1,
      borderColor: palette.hairline,
      borderWidth: 1,
      confine: true,
      formatter: (params: unknown) => {
        const item = Array.isArray(params) ? params[0] : params;
        const data =
          typeof item === "object" && item && "data" in item
            ? (
                item as {
                  data?: { count?: number; date?: string; value?: number };
                }
              ).data
            : undefined;
        const bytes = data?.value ?? 0;
        const count = data?.count ?? 0;
        return `${data?.date ?? "--"}<br/>${formatFileSize(bytes, locale)}<br/>${t("settings.fileCount")}: ${count}`;
      },
      textStyle: { color: palette.ink, fontSize: 12, fontWeight: 700 },
      trigger: "axis",
    },
    xAxis: {
      axisLabel: { color: palette.subtle, fontSize: 10, fontWeight: 700 },
      axisLine: { show: false },
      axisTick: { show: false },
      data: labels,
      splitLine: { show: false },
      type: "category",
    },
    yAxis: {
      axisLabel: { show: false },
      min: 0,
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.14)" } },
      type: "value",
    },
  };
}

function BlockActions({ children }: { children: ReactNode }) {
  return <div className="drive-system-settings-actions">{children}</div>;
}
