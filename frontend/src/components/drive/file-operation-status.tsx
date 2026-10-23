import { LoadingSpinner } from "@/components/common/ui/loading-state";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import "./file-operation-status.css";

export function FileOperationStatus({ palette }: { palette: Palette }) {
  const t = useTranslations();
  return (
    <span className="drive-operation-status" role="status" aria-live="polite">
      <LoadingSpinner palette={palette} size={16} />
      <span>{t("files.processing")}</span>
    </span>
  );
}
