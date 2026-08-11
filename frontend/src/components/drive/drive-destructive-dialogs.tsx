import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";

type ExtensionRenamePrompt = {
  from: string;
  to: string;
};

export function DriveDestructiveDialogs({
  deleteCount,
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
  deleteCount: number;
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
        description={t("files.permanentDeleteDescription", { count: deleteCount })}
        isPending={deletePending}
        onClose={onCancelDelete}
        onConfirm={onConfirmDelete}
        open={deleteOpen}
        palette={palette}
        title={t("files.permanentDeleteTitle")}
      />
    </>
  );
}
