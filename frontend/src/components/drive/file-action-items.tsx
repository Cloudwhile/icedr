import type { AppMenuItem } from "@/components/ui/app-menu";
import { LocalIcon } from "@/components/ui/app-icon";
import { getItemKind, type DriveItem, type Palette } from "@/features/file/model";
import { isTextEditableFile } from "@/features/file/open-with";
import type { useTranslations } from "@/i18n/react";

type FileAction = (item: DriveItem) => void;

export function buildFileActionItems({
  destructivePending,
  item,
  onArchive,
  onCopy,
  onCopyNode,
  onDeletePermanently,
  onDownload,
  onEdit,
  onOpen,
  onCut,
  onRename,
  onRestore,
  onShare,
  onShowDetails,
  onToggleStar,
  palette,
  t,
}: {
  destructivePending?: { archive: boolean; delete: boolean; restore: boolean };
  item: DriveItem;
  onArchive: FileAction;
  onCopy: FileAction;
  onCopyNode: FileAction;
  onDeletePermanently: FileAction;
  onDownload: FileAction;
  onEdit: FileAction;
  onOpen: FileAction;
  onCut: FileAction;
  onRename: FileAction;
  onRestore: FileAction;
  onShare: FileAction;
  onShowDetails: FileAction;
  onToggleStar: () => void;
  palette: Palette;
  t: ReturnType<typeof useTranslations>;
}): AppMenuItem[] {
  const isFolder = getItemKind(item) === "folder";
  const editable = isTextEditableFile(item);
  if (item.archivedAt) {
    return [
      { icon: <LocalIcon name="info" size={15} />, label: t("app.details"), onClick: () => onShowDetails(item), value: "details" },
      { icon: <LocalIcon name="restore" size={15} />, label: t("actions.restore"), onClick: () => onRestore(item), disabled: destructivePending?.restore, separatorBefore: true, value: "restore" },
      { icon: <LocalIcon name="trash" size={15} />, label: t("actions.deletePermanently"), onClick: () => onDeletePermanently(item), disabled: destructivePending?.delete, tone: "danger" as const, value: "delete-permanently" },
    ];
  }
  const actionItems: AppMenuItem[] = [
    { icon: <LocalIcon name={isFolder ? "folder" : "visible"} size={15} />, label: t("actions.open"), onClick: () => onOpen(item), value: "open" },
    editable ? { icon: <LocalIcon name="pencil" size={15} />, label: t("actions.edit"), onClick: () => onEdit(item), value: "edit" } : null,
    { icon: <LocalIcon name="share2" size={15} />, label: t("actions.share"), onClick: () => onShare(item), separatorBefore: true, value: "share" },
    { icon: <LocalIcon name="link" size={15} />, label: t("actions.copyLink"), onClick: () => onCopy(item), value: "copy-link" },
    !isFolder ? { icon: <LocalIcon name="download" size={15} />, label: t("actions.download"), onClick: () => onDownload(item), value: "download" } : null,
    { icon: <LocalIcon name="pencil" size={15} />, label: t("actions.rename"), onClick: () => onRename(item), separatorBefore: true, value: "rename" },
    { icon: <LocalIcon name="copy" size={15} />, label: t("actions.copy"), onClick: () => onCopyNode(item), value: "copy-node" },
    { icon: <LocalIcon name="cut" size={15} />, label: t("actions.cut"), onClick: () => onCut(item), value: "cut-node" },
    { icon: <LocalIcon name="info" size={15} />, label: t("app.details"), onClick: () => onShowDetails(item), separatorBefore: true, value: "details" },
    {
      icon: <LocalIcon name="star" size={15} color={item.starred ? palette.primaryHover : "currentColor"} />,
      label: item.starred ? t("actions.unstar") : t("actions.star"),
      onClick: onToggleStar,
      value: "star",
    },
    item.archivedAt
      ? { icon: <LocalIcon name="restore" size={15} />, label: t("actions.restore"), onClick: () => onRestore(item), value: "restore" }
      : { icon: <LocalIcon name="trash" size={15} />, label: t("actions.archive"), onClick: () => onArchive(item), disabled: destructivePending?.archive, separatorBefore: true, tone: "danger", value: "archive" },
  ].filter(Boolean) as AppMenuItem[];

  return actionItems;
}

