import type { UploadConflictStrategy } from "./actions";

export type UploadConflictPrompt = {
  batchCount: number;
  conflictCount: number;
  fileNames: string[];
};

type PendingUploadConflictPrompt = {
  prompt: UploadConflictPrompt;
  resolve: (strategy: UploadConflictStrategy | null) => void;
};

export function createUploadConflictPromptQueue(
  onPromptChange: (prompt: UploadConflictPrompt | null) => void,
) {
  let active: PendingUploadConflictPrompt | null = null;
  let queued: PendingUploadConflictPrompt[] = [];

  const publish = () => {
    onPromptChange(active?.prompt ?? null);
  };

  const showNext = () => {
    active = queued.shift() ?? null;
    publish();
  };

  return {
    request(prompt: UploadConflictPrompt) {
      return new Promise<UploadConflictStrategy | null>((resolve) => {
        queued.push({ prompt, resolve });
        if (!active) showNext();
      });
    },
    resolve(strategy: UploadConflictStrategy | null) {
      if (!active) return false;
      const current = active;
      active = null;
      showNext();
      current.resolve(strategy);
      return true;
    },
    dispose() {
      const unresolved = active ? [active, ...queued] : queued;
      active = null;
      queued = [];
      unresolved.forEach((entry) => entry.resolve(null));
    },
  };
}
