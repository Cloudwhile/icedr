import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ItemIcon } from "@/components/ui/app-icon";
import type { DriveItem, Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";

type ExtensionRenamePrompt = {
  from: string;
  to: string;
};

export function DriveDestructiveDialogs({
  deleteItems,
  deleteOpen,
  deletePending,
  extensionPending,
  extensionPrompt,
  onCancelDelete,
  onCancelExtension,
  onConfirmDelete,
  onConfirmExtension,
  palette,
}: {
  deleteItems: DriveItem[];
  deleteOpen: boolean;
  deletePending: boolean;
  extensionPending: boolean;
  extensionPrompt: ExtensionRenamePrompt | null;
  onCancelDelete: () => void;
  onCancelExtension: () => void;
  onConfirmDelete: () => void;
  onConfirmExtension: () => void;
  palette: Palette;
}) {
  const t = useTranslations();
  const deletePreviewItems = deleteItems.slice(0, 5);
  const remainingDeleteItems = deleteItems.slice(5);

  return (
    <>
      <ConfirmationDialog
        confirmLabel={t("actions.rename")}
        description={t("files.renameExtensionChanged", {
          from: extensionPrompt?.from ?? "",
          to: extensionPrompt?.to ?? "",
        })}
        icon="pencil"
        isPending={extensionPending}
        onClose={onCancelExtension}
        onConfirm={onConfirmExtension}
        open={Boolean(extensionPrompt)}
        palette={palette}
        title={t("actions.rename")}
        tone="warning"
      />
      <ConfirmationDialog
        confirmLabel={t("actions.deletePermanently")}
        description={t("files.permanentDeleteDescription", { count: deleteItems.length })}
        isPending={deletePending}
        onClose={onCancelDelete}
        onConfirm={onConfirmDelete}
        open={deleteOpen}
        palette={palette}
        supportingContent={deleteItems.length > 0 ? (
          <div className="drive-delete-confirmation-preview">
            <DeleteItemList items={deletePreviewItems} palette={palette} />
            {remainingDeleteItems.length > 0 ? (
              deleteItems.length > 20 ? (
                <details className="drive-delete-confirmation-more">
                  <summary>
                    {t("files.deleteConfirmMore", {
                      count: remainingDeleteItems.length,
                    })}
                  </summary>
                  <DeleteItemList items={remainingDeleteItems} palette={palette} />
                </details>
              ) : (
                <>
                  <p className="drive-delete-confirmation-more-label">
                    {t("files.deleteConfirmMore", {
                      count: remainingDeleteItems.length,
                    })}
                  </p>
                  <DeleteItemList items={remainingDeleteItems} palette={palette} />
                </>
              )
            ) : null}
          </div>
        ) : undefined}
        title={t("files.permanentDeleteTitle")}
      />
    </>
  );
}

function DeleteItemList({
  items,
  palette,
}: {
  items: DriveItem[];
  palette: Palette;
}) {
  const t = useTranslations();

  return (
    <ul
      aria-label={t("files.permanentDeleteItems")}
      className="drive-delete-confirmation-list"
    >
      {items.map((item) => (
        <li className="drive-delete-confirmation-item" key={item.id}>
          <ItemIcon item={item} palette={palette} size={18} />
          <span title={item.name}>{item.name}</span>
        </li>
      ))}
    </ul>
  );
}
