"use client";

import { useMemo } from "react";
import { AppSelect } from "@/components/ui/app-select";
import type { AdminScope } from "@/features/admin/admin-scope";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import type { WorkspaceResponse } from "@/lib/drive-api";
import "./admin-scope-selector.css";

export type AdminScopeSelectorProps = {
  disabled?: boolean;
  onChange: (scope: AdminScope) => void;
  palette: Palette;
  scope: AdminScope;
  workspaces: ReadonlyArray<Pick<WorkspaceResponse, "id" | "name">>;
};

const allScopeValue = "scope:all";
const systemScopeValue = "scope:system";
const workspaceScopePrefix = "workspace:";

export function AdminScopeSelector({
  disabled,
  onChange,
  palette,
  scope,
  workspaces,
}: AdminScopeSelectorProps) {
  const t = useTranslations();
  const options = useMemo(
    () => [
      { label: t("admin.scopeAll"), value: allScopeValue },
      { label: t("admin.scopeSystem"), value: systemScopeValue },
      ...workspaces.map((workspace) => ({
        label: t("admin.scopeWorkspaceOption", { name: workspace.name }),
        value: `${workspaceScopePrefix}${workspace.id}`,
      })),
    ],
    [t, workspaces],
  );
  const requestedValue = scopeToValue(scope);
  const value = options.some((option) => option.value === requestedValue)
    ? requestedValue
    : allScopeValue;

  return (
    <label className="admin-scope-selector" data-kind={scope.kind}>
      <span>{t("admin.scopeLabel")}</span>
      <AppSelect
        aria-label={t("admin.scopeLabel")}
        disabled={disabled}
        options={options}
        palette={palette}
        value={value}
        onChange={(event) => onChange(valueToScope(event.target.value))}
      />
    </label>
  );
}

function scopeToValue(scope: AdminScope) {
  if (scope.kind === "workspace") {
    return `${workspaceScopePrefix}${scope.workspaceId}`;
  }
  return scope.kind === "system" ? systemScopeValue : allScopeValue;
}

function valueToScope(value: string): AdminScope {
  if (value === systemScopeValue) return { kind: "system" };
  if (value.startsWith(workspaceScopePrefix)) {
    const workspaceId = value.slice(workspaceScopePrefix.length).trim();
    if (workspaceId) return { kind: "workspace", workspaceId };
  }
  return { kind: "all" };
}
