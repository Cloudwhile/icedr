import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewIntentResponse } from "./actions";
import { resolveTaskLifecycleStatus } from "./task-lifecycle";

type PreviewIntentLoader = (signal: AbortSignal) => Promise<PreviewIntentResponse>;
type PreviewIntentPoller = (
  intent: PreviewIntentResponse,
  signal: AbortSignal,
) => Promise<PreviewIntentResponse>;

export type UsePreviewLifecycleOptions = {
  createIntent: PreviewIntentLoader;
  enabled: boolean;
  identity: string | null;
  initialIntent?: PreviewIntentResponse | null;
  pollIntent: PreviewIntentPoller;
  pollIntervalMs?: number;
};

export function usePreviewLifecycle({
  createIntent,
  enabled,
  identity,
  initialIntent = null,
  pollIntent,
  pollIntervalMs = 1000,
}: UsePreviewLifecycleOptions) {
  const [error, setError] = useState<unknown>(null);
  const [intent, setIntent] = useState<PreviewIntentResponse | null>(initialIntent);
  const [loading, setLoading] = useState(enabled && !initialIntent);
  const [retryRevision, setRetryRevision] = useState(0);
  const [stateIdentity, setStateIdentity] = useState(identity);
  const createIntentRef = useRef(createIntent);
  const pollIntentRef = useRef(pollIntent);
  const initialIntentRef = useRef(initialIntent);
  const lastStartedIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    createIntentRef.current = createIntent;
    pollIntentRef.current = pollIntent;
    initialIntentRef.current = initialIntent;
  }, [createIntent, initialIntent, pollIntent]);

  useEffect(() => {
    if (!enabled || !identity) {
      lastStartedIdentityRef.current = null;
      return;
    }

    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const isNewIdentity = lastStartedIdentityRef.current !== identity;
    lastStartedIdentityRef.current = identity;
    const startingIntent = isNewIdentity ? initialIntentRef.current : null;

    const schedulePoll = (currentIntent: PreviewIntentResponse) => {
      timer = setTimeout(() => {
        void load(currentIntent);
      }, pollIntervalMs);
    };

    const accept = (nextIntent: PreviewIntentResponse) => {
      if (!active) return;
      setStateIdentity(identity);
      setIntent(nextIntent);
      setError(null);
      const status = resolveTaskLifecycleStatus(nextIntent);
      const polling = status === "pending" || status === "running";
      setLoading(polling);
      if (polling) schedulePoll(nextIntent);
    };

    const load = async (currentIntent: PreviewIntentResponse | null) => {
      controller = new AbortController();
      try {
        const nextIntent = currentIntent
          ? await pollIntentRef.current(currentIntent, controller.signal)
          : await createIntentRef.current(controller.signal);
        accept(nextIntent);
      } catch (nextError) {
        if (!active || isAbortError(nextError)) return;
        setStateIdentity(identity);
        setError(nextError);
        setLoading(false);
      }
    };

    void Promise.resolve().then(() => {
      if (!active) return;
      setStateIdentity(identity);
      setError(null);
      if (startingIntent) {
        accept(startingIntent);
      } else {
        setIntent(null);
        setLoading(true);
        void load(null);
      }
    });

    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, identity, pollIntervalMs, retryRevision]);

  const active = Boolean(enabled && identity);
  const stateMatches = active && stateIdentity === identity;

  return {
    error: stateMatches ? error : null,
    intent: stateMatches ? intent : active ? initialIntent : null,
    loading: stateMatches ? loading : active && !initialIntent,
    retry: useCallback(() => setRetryRevision((revision) => revision + 1), []),
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
