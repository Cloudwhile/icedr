import { UploadConflictDialog } from "@/components/ui/upload-conflict-dialog";
import type { UploadConflictStrategy } from "@/features/file/actions";
import type { UploadConflictPrompt } from "@/features/file/upload-conflict-prompt-queue";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";

export function UploadConflictDialogs({
  discardOpen,
  onCancelDiscard,
  onConfirmDiscard,
  onDismissPrompt,
  onSelect,
  palette,
  prompt,
}: {
  discardOpen: boolean;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
  onDismissPrompt: () => void;
  onSelect: (strategy: UploadConflictStrategy) => void;
  palette: Palette;
  prompt: UploadConflictPrompt | null;
}) {
  const t = useTranslations();

  return (
    <>
      <UploadConflictDialog
        conflictCount={prompt?.conflictCount ?? 0}
        discardConfirmation={discardOpen ? {
          confirmLabel: t("upload.conflictDiscardConfirm"),
          description: t("upload.conflictDiscardDescription", {
            count: prompt?.batchCount ?? 0,
          }),
          onCancel: onCancelDiscard,
          onConfirm: onConfirmDiscard,
          title: t("upload.conflictDiscardTitle"),
        } : undefined}
        fileNames={prompt?.fileNames ?? []}
        onClose={onDismissPrompt}
        onSelect={onSelect}
        open={Boolean(prompt)}
        palette={palette}
      />
    </>
  );
}
