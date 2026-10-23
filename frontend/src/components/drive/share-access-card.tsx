import { ActionButton } from "@/components/ui/action-button";
import { LocalIcon } from "@/components/ui/app-icon";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";

export function ShareAccessCard({ allowDownload, onStartAccess, palette, verified }: {
  allowDownload: boolean;
  onStartAccess?: () => void;
  palette: Palette;
  verified: boolean;
}) {
  const t = useTranslations();
  const label = allowDownload
    ? verified ? t("share.openDownload") : t("share.downloadAndVerify")
    : verified ? t("share.openPreview") : t("share.authenticate");
  return (
    <section className="external-share-access">
      <p>{verified ? t("share.verifiedAccess") : t("share.verificationHint")}</p>
      <ActionButton disabled={!onStartAccess} icon={<LocalIcon name={allowDownload ? "download" : "visible"} size={17} />} onClick={onStartAccess} palette={palette} tone="primary">
        {label}
      </ActionButton>
    </section>
  );
}
