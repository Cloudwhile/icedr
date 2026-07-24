import { useTranslations } from "@/i18n/react";
import type { ChangeEvent, RefObject } from "react";

export function DriveHiddenFileInput({
  inputRef,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const t = useTranslations();

  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      title={t("app.upload")}
      aria-label={t("app.upload")}
      onChange={onChange}
      style={{ display: "none" }}
    />
  );
}
