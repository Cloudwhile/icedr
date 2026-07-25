"use client";

import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "@/compat/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { LoadingSpinner } from "@/components/common/ui/loading-state";
import { useMotionStagger } from "@/components/ui/motion";
import { ShareScopePicker } from "@/components/ui/share-scope-picker";
import { copyTextToClipboard, createShareUrl } from "@/features/file/actions";
import {
  findDriveItem,
  formatFileSize,
  getItemKind,
  sumDriveItemSizes,
  type DriveItem,
  type Locale,
  type LocalIconName,
  type Palette,
  type ThemeMode,
} from "@/features/file/model";
import {
  buildShareMemberScope,
  type FolderShareVisibility,
} from "@/features/share/member-scope";
import {
  collectShareDescendants,
  createRegisteredShare,
  type RegisteredShare,
  type RegisteredShareMode,
  type ShareSelectionInput,
} from "@/features/share/registry";
import { policyFromWorkspaceSettings } from "@/features/share/policy";
import { useLocale, useTranslations } from "@/i18n/react";
import type { WorkspaceShareSettings } from "@/lib/drive-api";
import { AnimatedCheckMark, ItemIcon, LocalIcon, StatusPill, ToolButton } from "./drive-primitives";
import "./styles/drive-share-dialog.css";

const buttonTypeAttr = { type: "button" as const };

type ShareCollection = {
  allowedIds: Set<string>;
  dynamicRootId: string | null;
  folderRoot: DriveItem | null;
  isValid: boolean;
  itemCount: number;
  mode: RegisteredShareMode;
  owner: string;
  rootItems: DriveItem[];
  selection: ShareSelectionInput | null;
  title: string;
  totalSizeBytes: number | null;
};

export type DriveShareDialogProps = {
  currentDirectoryItems: DriveItem[];
  currentFolder?: DriveItem;
  onClose: () => void;
  onShareCreated?: (share: RegisteredShare) => void;
  open: boolean;
  palette: Palette;
  policyLoadError?: string | null;
  rootTitle: string;
  selectedItems: DriveItem[];
  sourceItems: DriveItem[];
  themeMode: ThemeMode;
  workspaceId?: string;
  workspaceSettings?: WorkspaceShareSettings | null;
};

export function DriveShareDialog(props: DriveShareDialogProps) {
  if (!props.open) return null;

  return (
    <DriveShareDialogContent
      key={getFolderShareRootId(props) ?? "non-folder"}
      {...props}
    />
  );
}

function DriveShareDialogContent({
  currentDirectoryItems,
  currentFolder,
  onClose,
  onShareCreated,
  open,
  palette,
  policyLoadError,
  rootTitle,
  selectedItems,
  sourceItems,
  themeMode,
  workspaceId,
  workspaceSettings,
}: DriveShareDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowPreview, setAllowPreview] = useState(true);
  const [created, setCreated] = useState(false);
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expiryDaysInput, setExpiryDaysInput] = useState<string | null>(null);
  const [folderVisibility, setFolderVisibility] =
    useState<FolderShareVisibility>("entire-folder");
  const [remark, setRemark] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const policy = useMemo(() => policyFromWorkspaceSettings(workspaceSettings), [workspaceSettings]);
  const maxExpiresDays = workspaceSettings?.maxExpiresDays ?? 30;
  const collection = useMemo(
    () =>
      buildShareCollection({
        currentDirectoryItems,
        currentFolder,
        folderVisibility,
        rootTitle,
        selectedMemberIds,
        selectedItems,
        sourceItems,
      }),
    [
      currentDirectoryItems,
      currentFolder,
      folderVisibility,
      rootTitle,
      selectedItems,
      selectedMemberIds,
      sourceItems,
    ],
  );
  const totalSize = formatFileSize(collection.totalSizeBytes, locale);
  const expiresLabel = t("share.expiryValue", {
    count: policy.expiresValue,
    unit: t(`share.units.${policy.expiresUnit}`),
  });
  const shareUrl = createdShareUrl ?? (createdToken ? createShareUrl(createdToken) : "");
  const routeShareUrl = createdToken ? `/share/s/${encodeURIComponent(createdToken)}` : "";
  const expiryDays = expiryDaysInput ?? String(policy.expiresValue);

  const closeShareDialog = useCallback(() => {
    setAllowDownload(true);
    setAllowPreview(true);
    setCreated(false);
    setCreatedShareUrl(null);
    setCreatedToken(null);
    setCreateFeedback(null);
    setCreating(false);
    setExpiryDaysInput(null);
    setFolderVisibility("entire-folder");
    setRemark("");
    setSelectedMemberIds([]);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!createFeedback) return;
    const timer = window.setTimeout(() => setCreateFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [createFeedback]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) closeShareDialog();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeShareDialog, creating, open]);

  const createShare = () => {
    if (creating || !collection.isValid || !collection.selection) return;
    setCreating(true);
    setCreateFeedback(null);
    const expires = Math.min(Math.max(Number(expiryDays) || policy.expiresValue, 1), maxExpiresDays);
    const record: RegisteredShare = {
      allowDownload,
      allowPreview,
      allowedItemIds: Array.from(collection.allowedIds),
      createdAt: new Date().toISOString(),
      dynamicRootId: collection.dynamicRootId,
      expiresDays: expires,
      mode: collection.mode,
      owner: collection.owner,
      policy,
      remark: remark.trim(),
      rootItemIds: collection.rootItems.map((item) => item.id),
      selection: collection.selection,
      title: collection.title,
      token: "",
      workspaceId,
    };

    void createRegisteredShare(record)
      .then((createdShare) => {
        onShareCreated?.(createdShare);
        setCreatedToken(createdShare.token);
        setCreatedShareUrl(resolveCreatedShareUrl(createdShare.token, createdShare.url));
        setCreated(true);
      })
      .catch(() => setCreateFeedback(t("share.createFailed")))
      .finally(() => setCreating(false));
  };

  return (
    <Fragment>
      {open ? (
      <div className="drive-share-dialog-layer" data-theme={themeMode} style={dialogVariables(palette)}>
        <button
          {...buttonTypeAttr}
          aria-label={t("app.close")}
          className="drive-share-dialog-scrim"
          disabled={creating}
          onClick={() => {
            if (!creating) closeShareDialog();
          }}
        />
        <section
          aria-labelledby="drive-share-dialog-title"
          aria-modal="true"
          className="drive-share-dialog"
          data-created={created ? "true" : undefined}
          role="dialog"
        >
          <header className="drive-share-dialog-header">
            <span className="drive-share-dialog-heading-icon" aria-hidden="true">
              <LocalIcon name="share2" size={18} />
            </span>
            <span className="drive-share-dialog-heading-copy">
              <span id="drive-share-dialog-title" className="drive-share-dialog-title icedr-truncate">
                {created ? t("share.createdTitle") : t("share.createTitle")}
              </span>
              <span className="drive-share-dialog-subtitle icedr-truncate">
                {created ? shareUrl : t("share.policyApplied")}
              </span>
            </span>
            <button
              {...buttonTypeAttr}
              aria-label={t("app.close")}
              className="drive-share-dialog-close"
              disabled={creating}
              onClick={() => {
                if (!creating) closeShareDialog();
              }}
            >
              <LocalIcon name="cross" size={16} />
            </button>
          </header>

          {created ? (
            <ShareCreatedPanel
              onCopyFeedback={setCreateFeedback}
              onOpenShare={() => router.push(routeShareUrl)}
              palette={palette}
              shareUrl={shareUrl}
            />
          ) : (
            <div className="drive-share-dialog-body">
              <ShareTargetSummary
                collection={collection}
                expiresLabel={expiresLabel}
                palette={palette}
                shareItems={collection.itemCount}
                totalSize={totalSize}
              />
              {policyLoadError ? (
                <div className="drive-share-dialog-notice">
                  <StatusPill palette={palette} tone="risk">
                    {policyLoadError}
                  </StatusPill>
                </div>
              ) : null}
              <ShareOptions
                allowDownload={allowDownload}
                allowPreview={allowPreview}
                expiryDays={expiryDays}
                maxDays={maxExpiresDays}
                onToggleDownload={() => setAllowDownload((value) => !value)}
                onTogglePreview={() => setAllowPreview((value) => !value)}
                palette={palette}
                remark={remark}
                setExpiryDays={setExpiryDaysInput}
                setRemark={setRemark}
              />
              {collection.folderRoot ? (
                <section className="drive-share-scope">
                  <span className="drive-share-section-label">{t("share.visibleScope")}</span>
                  <ShareScopePicker
                    mode={folderVisibility}
                    onModeChange={(nextMode) => {
                      setFolderVisibility(nextMode);
                      if (nextMode === "selected-items") setSelectedMemberIds([]);
                    }}
                    onSelectedIdsChange={setSelectedMemberIds}
                    palette={palette}
                    rootFolder={collection.folderRoot}
                    selectedIds={selectedMemberIds}
                    sourceItems={sourceItems}
                  />
                  {!collection.isValid ? (
                    <span className="drive-share-scope-error">{t("share.selectAtLeastOneItem")}</span>
                  ) : null}
                </section>
              ) : (
                <ShareCollectionList collection={collection} locale={locale} palette={palette} sourceItems={sourceItems} />
              )}
            </div>
          )}

          {createFeedback ? (
            <div className="drive-share-dialog-feedback">
              <StatusPill palette={palette} tone={created ? "accent" : "risk"}>
                {createFeedback}
              </StatusPill>
            </div>
          ) : null}

          <footer className="drive-share-dialog-footer">
            {created ? (
              <>
                <ToolButton label={t("actions.copyLink")} onClick={() => void copyShareLink(shareUrl, t, setCreateFeedback)} palette={palette}>
                  <LocalIcon name="copy" size={17} />
                </ToolButton>
                <ActionButton icon={<LocalIcon name="visible" size={17} />} onClick={() => router.push(routeShareUrl)} palette={palette} tone="primary">
                  {t("share.openLink")}
                </ActionButton>
              </>
            ) : (
              <>
                <ToolButton
                  disabled={creating}
                  label={t("share.cancel")}
                  onClick={() => {
                    if (!creating) closeShareDialog();
                  }}
                  palette={palette}
                >
                  <LocalIcon name="cross" size={17} />
                </ToolButton>
                <ActionButton
                  disabled={creating || !collection.isValid}
                  icon={creating ? <LoadingSpinner palette={palette} size={14} /> : <LocalIcon name="link" size={17} />}
                  onClick={createShare}
                  palette={palette}
                  tone="primary"
                >
                  {creating ? t("share.creating") : t("share.createLink")}
                </ActionButton>
              </>
            )}
          </footer>
        </section>
      </div>
      ) : null}
    </Fragment>
  );
}

function ShareTargetSummary({
  collection,
  expiresLabel,
  palette,
  shareItems,
  totalSize,
}: {
  collection: ShareCollection;
  expiresLabel: string;
  palette: Palette;
  shareItems: number;
  totalSize: string;
}) {
  const t = useTranslations();
  const primaryItem = collection.rootItems[0];
  return (
    <section className="drive-share-target">
      <div className="drive-share-target-file">
        {primaryItem ? (
          <ItemIcon item={primaryItem} palette={palette} size={28} />
        ) : (
          <LocalIcon name={getShareModeIcon(collection.mode)} size={28} />
        )}
        <span className="drive-share-target-copy">
          <span className="drive-share-target-name icedr-truncate">{collection.title}</span>
          <span className="drive-share-target-meta icedr-truncate">
            {t(`share.mode.${collection.mode}`)} · {totalSize}
          </span>
        </span>
      </div>
      <div className="drive-share-metrics" aria-label={t("share.quickFacts")}>
        <Metric label={t("share.items")} value={String(shareItems)} />
        <Metric label={t("share.totalSize")} value={totalSize} />
        <Metric label={t("share.expires")} value={expiresLabel} />
      </div>
    </section>
  );
}

function ShareOptions({
  allowDownload,
  allowPreview,
  expiryDays,
  maxDays,
  onToggleDownload,
  onTogglePreview,
  palette,
  remark,
  setExpiryDays,
  setRemark,
}: {
  allowDownload: boolean;
  allowPreview: boolean;
  expiryDays: string;
  maxDays: number;
  onToggleDownload: () => void;
  onTogglePreview: () => void;
  palette: Palette;
  remark: string;
  setExpiryDays: (value: string) => void;
  setRemark: (value: string) => void;
}) {
  const t = useTranslations();
  const overLimit = Number(expiryDays) > maxDays;
  return (
    <section className="drive-share-options">
      <span className="drive-share-section-label">{t("share.permissions")}</span>
      <div className="drive-share-option-grid">
        <ShareOptionToggle
          checked={allowPreview}
          icon="visible"
          label={t("share.allowPreview")}
          onToggle={onTogglePreview}
          palette={palette}
        />
        <ShareOptionToggle
          checked={allowDownload}
          icon="download"
          label={t("share.allowDownload")}
          onToggle={onToggleDownload}
          palette={palette}
        />
      </div>

      <div className="drive-share-form-grid">
        <label className="drive-share-field">
          <span>{t("share.expiry")}</span>
          <span className="drive-share-expiry-control">
            <input
              className="drive-share-input"
              inputMode="numeric"
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value.replace(/\D/g, ""))}
            />
            <span className="drive-share-unit">{t("share.units.days")}</span>
          </span>
          <span className="drive-share-field-note" data-risk={overLimit ? "true" : undefined}>
            {t("share.maximumAllowed", { count: maxDays })}
          </span>
        </label>
        <label className="drive-share-field">
          <span>{t("share.remark")}</span>
          <textarea
            className="drive-share-textarea"
            onChange={(event) => setRemark(event.target.value)}
            placeholder={t("share.optional")}
            value={remark}
          />
        </label>
      </div>
    </section>
  );
}

function ShareCollectionList({
  collection,
  locale,
  palette,
  sourceItems,
}: {
  collection: ShareCollection;
  locale: Locale;
  palette: Palette;
  sourceItems: DriveItem[];
}) {
  const t = useTranslations();
  const listRef = useMotionStagger<HTMLDivElement>([collection.rootItems.map((item) => item.id).join("|"), collection.mode]);
  const visibleItems = collection.rootItems.slice(0, 4);
  const extraCount = collection.rootItems.length - visibleItems.length;
  return (
    <section className="drive-share-collection">
      <div className="drive-share-collection-head">
        <span className="drive-share-section-label">{t("share.collection")}</span>
        <StatusPill palette={palette}>{t("share.itemCountValue", { count: collection.itemCount })}</StatusPill>
      </div>
      <div ref={listRef} className="drive-share-collection-list">
        {visibleItems.map((item) => (
          <div key={item.id} className="drive-share-collection-row" data-motion-row>
            <ItemIcon item={item} palette={palette} size={20} />
            <span className="drive-share-collection-copy">
              <span className="icedr-truncate">{item.name}</span>
              <span>{t(`files.kind.${getItemKind(item)}`)}</span>
            </span>
            <span className="drive-share-collection-size">{formatFileSize(sumDriveItemSizes([item], sourceItems), locale)}</span>
          </div>
        ))}
        {extraCount > 0 ? (
          <div className="drive-share-collection-more">
            {t("share.viewAllItems", { count: collection.rootItems.length })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ShareCreatedPanel({
  onCopyFeedback,
  onOpenShare,
  palette,
  shareUrl,
}: {
  onCopyFeedback: (message: string | null) => void;
  onOpenShare: () => void;
  palette: Palette;
  shareUrl: string;
}) {
  const t = useTranslations();
  return (
    <div className="drive-share-dialog-body drive-share-dialog-created">
      <div className="drive-share-created-mark" aria-hidden="true">
        <AnimatedCheckMark size={24} />
      </div>
      <div className="drive-share-created-copy">
        <span>{t("share.createdTitle")}</span>
        <span>{t("share.createdSubtitle")}</span>
      </div>
      <div className="drive-share-link-field">
        <span className="icedr-truncate">{shareUrl}</span>
        <ToolButton label={t("actions.copyLink")} onClick={() => void copyShareLink(shareUrl, t, onCopyFeedback)} palette={palette} size="sm">
          <LocalIcon name="copy" size={16} />
        </ToolButton>
      </div>
      <button {...buttonTypeAttr} className="drive-share-open-inline" onClick={onOpenShare}>
        <span>{t("share.openLink")}</span>
        <LocalIcon name="arrow_right" size={15} />
      </button>
    </div>
  );
}

function ShareOptionToggle({
  checked,
  icon,
  label,
  onToggle,
  palette,
}: {
  checked: boolean;
  icon: LocalIconName;
  label: string;
  onToggle: () => void;
  palette: Palette;
}) {
  return (
    <button
      {...buttonTypeAttr}
      aria-pressed={checked}
      className="drive-share-option-toggle"
      data-checked={checked ? "true" : undefined}
      onClick={onToggle}
      style={
        {
          "--share-option-focus": palette.focusRing,
        } as CSSProperties
      }
    >
      <LocalIcon name={icon} size={16} />
      <span className="icedr-truncate">{label}</span>
      <span className="drive-share-option-check" aria-hidden="true">
        {checked ? <AnimatedCheckMark size={12} /> : null}
      </span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="drive-share-metric">
      <span>{label}</span>
      <strong className="icedr-truncate">{value}</strong>
    </span>
  );
}

async function copyShareLink(
  shareUrl: string,
  t: ReturnType<typeof useTranslations>,
  onCopyFeedback: (message: string | null) => void,
) {
  await copyTextToClipboard(shareUrl);
  onCopyFeedback(t("app.copied"));
}

export function buildShareCollection({
  currentDirectoryItems,
  currentFolder,
  folderVisibility,
  rootTitle,
  selectedMemberIds,
  selectedItems,
  sourceItems,
}: {
  currentDirectoryItems: DriveItem[];
  currentFolder?: DriveItem;
  folderVisibility: FolderShareVisibility;
  rootTitle: string;
  selectedMemberIds: string[];
  selectedItems: DriveItem[];
  sourceItems: DriveItem[];
}): ShareCollection {
  if (selectedItems.length === 1 && getItemKind(selectedItems[0]) !== "folder") {
    const item = selectedItems[0];
    return {
      allowedIds: new Set([item.id]),
      dynamicRootId: null,
      folderRoot: null,
      isValid: true,
      itemCount: 1,
      mode: "single-file",
      owner: item.owner,
      rootItems: [item],
      selection: { type: "single-file", itemId: item.id },
      title: item.name,
      totalSizeBytes: Math.max(0, item.sizeBytes ?? 0),
    };
  }

  if (selectedItems.length === 1 && getItemKind(selectedItems[0]) === "folder") {
    return buildFolderShareCollection(
      selectedItems[0],
      sourceItems,
      folderVisibility,
      selectedMemberIds,
    );
  }

  if (selectedItems.length > 1) {
    return buildMultiItemShareCollection(selectedItems, sourceItems, rootTitle);
  }

  if (currentFolder) {
    return buildFolderShareCollection(
      currentFolder,
      sourceItems,
      folderVisibility,
      selectedMemberIds,
    );
  }

  return buildMultiItemShareCollection(currentDirectoryItems, sourceItems, rootTitle);
}

function buildFolderShareCollection(
  folder: DriveItem,
  sourceItems: DriveItem[],
  folderVisibility: FolderShareVisibility,
  selectedMemberIds: string[],
): ShareCollection {
  const scope = buildShareMemberScope({
    rootFolder: folder,
    sourceItems,
    mode: folderVisibility,
    selectedIds: selectedMemberIds,
  });
  const isValid =
    folderVisibility === "entire-folder" ||
    scope.normalizedSelectedIds.length > 0;

  return {
    allowedIds: new Set(scope.visibleMemberIds),
    dynamicRootId: folder.id,
    folderRoot: folder,
    isValid,
    itemCount: scope.fileCount + scope.folderCount,
    mode: "folder",
    owner: folder.owner,
    rootItems: [folder],
    selection: {
      type: "folder",
      folderId: folder.id,
      visibility: folderVisibility,
      ...(folderVisibility === "selected-items"
        ? { selectedItemIds: scope.normalizedSelectedIds }
        : {}),
    },
    title: folder.name,
    totalSizeBytes: scope.totalSizeBytes,
  };
}

function buildMultiItemShareCollection(
  requestedItems: DriveItem[],
  sourceItems: DriveItem[],
  rootTitle: string,
): ShareCollection {
  const rootItems = normalizeShareRoots(requestedItems, sourceItems);
  const allowedItems = rootItems.flatMap((item) => [
    item,
    ...collectShareDescendants(item, sourceItems),
  ]);
  const allowedIds = new Set(allowedItems.map((item) => item.id));
  const parentId =
    rootItems.length > 0 &&
    rootItems.every((item) => item.parentId === rootItems[0].parentId)
      ? rootItems[0].parentId
      : null;
  const parent = parentId ? findDriveItem(parentId, sourceItems) : undefined;
  const owner =
    rootItems.length > 0 &&
    rootItems.every((item) => item.owner === rootItems[0].owner)
      ? rootItems[0].owner
      : "";

  return {
    allowedIds,
    dynamicRootId: null,
    folderRoot: null,
    isValid: rootItems.length > 0,
    itemCount: allowedIds.size,
    mode: "multi-file",
    owner,
    rootItems,
    selection:
      rootItems.length > 0
        ? { type: "multi-item", itemIds: rootItems.map((item) => item.id) }
        : null,
    title: parent?.name ?? rootTitle,
    totalSizeBytes: sumDriveItemSizes(rootItems, sourceItems),
  };
}

function normalizeShareRoots(items: DriveItem[], sourceItems: DriveItem[]) {
  const requestedById = new Map(items.map((item) => [item.id, item]));

  return items.filter((item, index) => {
    if (items.findIndex((candidate) => candidate.id === item.id) !== index) {
      return false;
    }
    let parentId = item.parentId;
    const visited = new Set([item.id]);

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = findDriveItem(parentId, sourceItems);
      if (!parent) return true;
      if (
        getItemKind(parent) === "folder" &&
        requestedById.has(parent.id)
      ) {
        return false;
      }
      parentId = parent.parentId;
    }
    return true;
  });
}

function resolveCreatedShareUrl(token: string, apiUrl?: string) {
  if (apiUrl) {
    try {
      const url = new URL(apiUrl);
      if (url.pathname.includes("/share/s/")) return apiUrl;
    } catch {
      return createShareUrl(token);
    }
  }
  return createShareUrl(token);
}

function getFolderShareRootId({
  currentFolder,
  selectedItems,
}: Pick<DriveShareDialogProps, "currentFolder" | "selectedItems">) {
  if (
    selectedItems.length === 1 &&
    getItemKind(selectedItems[0]) === "folder"
  ) {
    return selectedItems[0].id;
  }

  return selectedItems.length === 0 ? (currentFolder?.id ?? null) : null;
}

function getShareModeIcon(mode: RegisteredShareMode): LocalIconName {
  if (mode === "folder") return "folder";
  if (mode === "multi-file") return "user_group";
  return "link";
}

function dialogVariables(palette: Palette) {
  return {
    "--share-dialog-accent": palette.primary,
    "--share-dialog-accent-hover": palette.primaryHover,
    "--share-dialog-bg": palette.canvas === "#010102" ? palette.surface1 : "#ffffff",
    "--share-dialog-border": palette.hairline,
    "--share-dialog-border-strong": palette.hairlineStrong,
    "--share-dialog-canvas": palette.canvas,
    "--share-dialog-danger": palette.danger,
    "--share-dialog-focus": palette.focusRing,
    "--share-dialog-muted": palette.muted,
    "--share-dialog-selected": palette.selected,
    "--share-dialog-subtle": palette.subtle,
    "--share-dialog-surface": palette.surface1,
    "--share-dialog-surface-2": palette.surface2,
    "--share-dialog-text": palette.ink,
  } as CSSProperties;
}
