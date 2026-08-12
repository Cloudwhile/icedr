"use client";

import { useContext, useEffect, useRef } from "react";
import {
  UnsavedChangesContext,
  type RegisteredUnsavedChangesSection,
} from "./unsaved-changes-context";

export type UnsavedChangesSectionRegistration = {
  id: string;
  isDirty: boolean;
  onDiscard: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
};

export function useUnsavedChangesSection({
  id,
  isDirty,
  onDiscard,
  onSave,
}: UnsavedChangesSectionRegistration) {
  const store = useContext(UnsavedChangesContext);
  if (!store) {
    throw new Error(
      "useUnsavedChangesSection must be used within AdminUnsavedChangesProvider",
    );
  }

  const sectionRef = useRef<RegisteredUnsavedChangesSection>({
    isDirty,
    onDiscard,
    onSave,
  });

  useEffect(() => {
    const dirtyChanged = sectionRef.current.isDirty !== isDirty;
    sectionRef.current = { isDirty, onDiscard, onSave };
    if (dirtyChanged) store.notifyChange();
  }, [isDirty, onDiscard, onSave, store]);

  useEffect(
    () => store.registerSection(id, () => sectionRef.current),
    [id, store],
  );
}
