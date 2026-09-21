"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AppInput } from "@/components/ui/app-input";
import { LocalIcon } from "@/components/ui/app-icon";
import { AppSelect } from "@/components/ui/app-select";
import { ToolButton } from "@/components/ui/tool-button";
import type { AdminScope } from "@/features/admin/admin-scope";
import { storageIntegrityStatusTextColor } from "@/features/admin/storage-integrity-colors";
import { formatFileSize, type Locale, type Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import {
  fetchStorageIntegrityTargetVersions,
  searchStorageIntegrityTargets,
  type StorageIntegrityTargetCandidate,
  type StorageIntegrityTargetVersion,
  type StorageIntegrityTarget,
} from "@/lib/drive-api";
import "./admin-storage-integrity-target.css";

export function AdminStorageIntegrityTarget({
  locale,
  onChange,
  palette,
  scope,
  value,
}: {
  locale: Locale;
  onChange: (target: StorageIntegrityTarget) => void;
  palette: Palette;
  scope: AdminScope;
  value: StorageIntegrityTarget;
}) {
  const t = useTranslations();
  const workspaceId = scope.kind === "workspace" ? scope.workspaceId : null;
  const scopeKey = workspaceId ? `workspace:${workspaceId}` : "all";
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<{
    error: boolean;
    items: StorageIntegrityTargetCandidate[];
    loading: boolean;
    scopeKey: string;
    searched: boolean;
  }>({ error: false, items: [], loading: false, scopeKey, searched: false });
  const [selectedState, setSelectedState] = useState<{
    node: StorageIntegrityTargetCandidate | null;
    scopeKey: string;
  }>({ node: null, scopeKey });
  const [versionState, setVersionState] = useState<{
    error: boolean;
    items: StorageIntegrityTargetVersion[];
    loading: boolean;
    nodeId: string | null;
  }>({ error: false, items: [], loading: false, nodeId: null });
  const searchControllerRef = useRef<AbortController | null>(null);
  const versionControllerRef = useRef<AbortController | null>(null);
  const visibleSearch = searchState.scopeKey === scopeKey ? searchState : null;
  const selectedNode =
    selectedState.scopeKey === scopeKey &&
    selectedState.node?.id === value.nodeId
      ? selectedState.node
      : null;
  const visibleVersions =
    versionState.nodeId === value.nodeId ? versionState : null;

  useEffect(
    () => () => {
      searchControllerRef.current?.abort();
      versionControllerRef.current?.abort();
    },
    [scopeKey],
  );

  const runSearch = async () => {
    if (!workspaceId) return;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearchState({
      error: false,
      items: visibleSearch?.items ?? [],
      loading: true,
      scopeKey,
      searched: true,
    });
    try {
      const page = await searchStorageIntegrityTargets(
        workspaceId,
        query,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setSearchState({
        error: false,
        items: page.items,
        loading: false,
        scopeKey,
        searched: true,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      setSearchState({
        error: true,
        items: [],
        loading: false,
        scopeKey,
        searched: true,
      });
    }
  };

  const searchOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void runSearch();
  };

  const selectNode = async (node: StorageIntegrityTargetCandidate) => {
    if (!workspaceId) return;
    versionControllerRef.current?.abort();
    const controller = new AbortController();
    versionControllerRef.current = controller;
    setSelectedState({ node, scopeKey });
    setVersionState({
      error: false,
      items: [],
      loading: true,
      nodeId: node.id,
    });
    onChange({ nodeId: node.id });
    try {
      const versions = await fetchStorageIntegrityTargetVersions(
        workspaceId,
        node.id,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setVersionState({
        error: false,
        items: versions,
        loading: false,
        nodeId: node.id,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      setVersionState({
        error: true,
        items: [],
        loading: false,
        nodeId: node.id,
      });
    }
  };

  const clear = () => {
    versionControllerRef.current?.abort();
    setSelectedState({ node: null, scopeKey });
    setVersionState({ error: false, items: [], loading: false, nodeId: null });
    onChange({});
  };

  return (
    <div className="admin-integrity-target">
      <div className="admin-integrity-target-heading">
        <div>
          <strong>{t("storageIntegrity.target")}</strong>
          <span>{t("storageIntegrity.targetHint")}</span>
        </div>
        {selectedNode ? (
          <ToolButton
            label={t("storageIntegrity.clearTarget")}
            onClick={clear}
            palette={palette}
          >
            <LocalIcon name="cross" size={15} />
          </ToolButton>
        ) : null}
      </div>

      <div className="admin-integrity-target-search" role="search">
        <AppInput
          aria-label={t("storageIntegrity.targetSearch")}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={searchOnEnter}
          palette={palette}
          placeholder={t("storageIntegrity.targetSearchPlaceholder")}
          value={query}
        />
        <ToolButton
          isPending={visibleSearch?.loading}
          label={t("storageIntegrity.searchFiles")}
          onClick={() => void runSearch()}
          palette={palette}
          type="button"
          visual="surface"
        >
          <LocalIcon name="search" size={16} />
        </ToolButton>
      </div>

      <div className="admin-integrity-target-status" aria-live="polite">
        {visibleSearch?.error ? (
          <span role="alert">{t("storageIntegrity.targetSearchFailed")}</span>
        ) : visibleSearch?.searched && !visibleSearch.loading && visibleSearch.items.length === 0 ? (
          <span>{t("storageIntegrity.targetNoResults")}</span>
        ) : null}
      </div>

      {visibleSearch?.items.length ? (
        <div className="admin-integrity-target-results">
          {visibleSearch.items.map((item) => (
            <button
              aria-label={item.name}
              aria-describedby={`integrity-target-${item.id}`}
              data-selected={selectedNode?.id === item.id ? "true" : undefined}
              key={item.id}
              onClick={() => void selectNode(item)}
              type="button"
            >
              <span><LocalIcon name="file" size={15} /></span>
              <span>
                <strong title={item.name}>{item.name}</strong>
                <small title={item.path}>{item.path}</small>
                <small id={`integrity-target-${item.id}`} title={item.id}>{item.id}</small>
              </span>
              <span className="admin-integrity-target-meta">
                <small
                  data-status={item.integrityStatus}
                  style={{
                    color: storageIntegrityStatusTextColor(
                      palette,
                      item.integrityStatus,
                    ),
                  }}
                >
                  {t(`storageIntegrity.count.${item.integrityStatus}`)}
                </small>
                <small>{formatFileSize(item.sizeBytes, locale)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {selectedNode ? (
        <div className="admin-integrity-target-selection">
          <span className="admin-integrity-target-selected-icon">
            <LocalIcon name="tick" size={15} />
          </span>
          <span>
            <strong title={selectedNode.name}>{selectedNode.name}</strong>
            <code title={selectedNode.id}>{selectedNode.id}</code>
          </span>
          <label>
            <span>{t("storageIntegrity.targetVersion")}</span>
            <AppSelect
              aria-label={t("storageIntegrity.targetVersion")}
              disabled={visibleVersions?.loading}
              onChange={(event) =>
                onChange({
                  nodeId: selectedNode.id,
                  ...(event.target.value
                    ? { versionId: event.target.value }
                    : {}),
                })
              }
              options={[
                {
                  label: t("storageIntegrity.currentObject"),
                  value: "",
                },
                ...(visibleVersions?.items ?? []).map((version) => ({
                  label: t("storageIntegrity.versionOption", {
                    number: version.versionNumber,
                    size: formatFileSize(version.sizeBytes, locale),
                    status: t(
                      `storageIntegrity.count.${version.integrityStatus}`,
                    ),
                  }),
                  value: version.id,
                })),
              ]}
              palette={palette}
              value={value.versionId ?? ""}
            />
          </label>
          {visibleVersions?.error ? (
            <span role="alert">{t("storageIntegrity.versionsLoadFailed")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
