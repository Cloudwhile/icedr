import type { OAuthSettings } from "@/lib/drive-api";

export type OAuthEditorSnapshot = {
  draft: OAuthSettings;
  secret: string;
  secretCleared: boolean;
};

export function cloneOAuthDraft(draft: OAuthSettings): OAuthSettings {
  return {
    ...draft,
    allowedEmailDomains: [...(draft.allowedEmailDomains ?? [])],
  };
}

export function createEditorSnapshot(
  draft: OAuthSettings,
): OAuthEditorSnapshot {
  return {
    draft: cloneOAuthDraft(draft),
    secret: "",
    secretCleared: false,
  };
}

export function isOAuthEditorDirty(
  draft: OAuthSettings | null,
  baseline: OAuthEditorSnapshot | null,
  secret: string,
  secretCleared: boolean,
) {
  if (!draft || !baseline) return false;
  return (
    JSON.stringify(draft) !== JSON.stringify(baseline.draft) ||
    secret !== baseline.secret ||
    secretCleared !== baseline.secretCleared
  );
}

export function upsertOAuthProvider(
  current: OAuthSettings[],
  nextProvider: OAuthSettings,
) {
  let found = false;
  const next = current.map((provider) => {
    if (provider.id === nextProvider.id) {
      found = true;
      return nextProvider;
    }
    if (
      nextProvider.enabled &&
      provider.providerKey === nextProvider.providerKey &&
      provider.enabled
    ) {
      return { ...provider, enabled: false };
    }
    return provider;
  });
  return found ? next : [...next, nextProvider];
}
