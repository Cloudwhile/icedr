"use client";

import { useEffect, useState } from "react";
import type { Palette } from "@/features/file/model";
import { useTranslations } from "@/i18n/react";
import { LocalIcon } from "@/components/ui/app-icon";
import { ToolButton } from "@/components/ui/tool-button";

type UnsavedSettingsBannerProps = {
  dirty: boolean;
  sections: ReadonlyArray<{ id: string; labelKey: string }>;
  dirtySections: Readonly<Record<string, boolean>>;
  onDiscard: () => void;
  onSave: () => Promise<void>;
  palette: Palette;
  pending: boolean;
};

export function UnsavedSettingsBanner({ dirty, sections, dirtySections, onDiscard, onSave, palette, pending }: UnsavedSettingsBannerProps) {
  const t = useTranslations();
  const message = t("admin.unsavedChangesHint", {
    sections: sections.filter((section) => dirtySections[section.id]).map((section) => t(section.labelKey)).join(" · "),
  });
  const [presence, setPresence] = useState({ mounted: dirty, message });

  useEffect(() => {
    // Keep the previous copy while the closing animation finishes.
    const timer = window.setTimeout(() => setPresence({ mounted: dirty, message }), dirty ? 0 : 160);
    return () => window.clearTimeout(timer);
  }, [dirty, message]);

  if (!dirty && !presence.mounted) return null;

  return (
    <div aria-hidden={!dirty || undefined} className="drive-platform-unsaved" data-exiting={!dirty || undefined} inert={!dirty || undefined}>
      <div className="drive-platform-unsaved-copy" role="status">
        <LocalIcon name="exclamation" size={18} color={palette.warning} />
        <span>{dirty ? message : presence.message}</span>
      </div>
      <div className="drive-platform-unsaved-actions">
        <ToolButton showLabel disabled={pending || !dirty} label={t("admin.discardAllChanges")} onClick={onDiscard} palette={palette}>
          <LocalIcon name="undo" size={17} />
        </ToolButton>
        <ToolButton showLabel disabled={pending || !dirty} isPending={pending} label={t("admin.saveAllChanges")} onClick={() => void onSave().catch(() => undefined)} palette={palette}>
          <LocalIcon name="save" size={17} />
        </ToolButton>
      </div>
    </div>
  );
}
