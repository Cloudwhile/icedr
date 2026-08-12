import { createContext } from "react";

export type RegisteredUnsavedChangesSection = {
  isDirty: boolean;
  onDiscard: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
};

type ReadSection = () => RegisteredUnsavedChangesSection;

export type UnsavedChangesStore = ReturnType<typeof createUnsavedChangesStore>;

export const UnsavedChangesContext =
  createContext<UnsavedChangesStore | null>(null);

export function createUnsavedChangesStore() {
  const listeners = new Set<() => void>();
  const sections = new Map<string, ReadSection>();
  let version = 0;

  const emitChange = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => version,
    hasDirtySections: () =>
      Array.from(sections.values()).some((readSection) => readSection().isDirty),
    notifyChange: emitChange,
    readDirtySections: () =>
      Array.from(sections.values())
        .map((readSection) => readSection())
        .filter((section) => section.isDirty),
    registerSection(id: string, readSection: ReadSection) {
      sections.set(id, readSection);
      emitChange();

      return () => {
        if (sections.get(id) !== readSection) return;
        sections.delete(id);
        emitChange();
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
