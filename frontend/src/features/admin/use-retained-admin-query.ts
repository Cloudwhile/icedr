import { useCallback, useEffect, useRef, useState } from "react";

export type RetainedAdminQueryState<T> = {
  data: T | null;
  error: string | null;
  initialLoading: boolean;
  lastSuccessfulAt: string | null;
  refreshing: boolean;
  stale: boolean;
};

export type RetainedAdminQueryResult<T> = RetainedAdminQueryState<T> & {
  refresh: () => Promise<boolean>;
};

export function useRetainedAdminQuery<T>({
  enabled,
  key,
  load,
}: {
  enabled: boolean;
  key: string;
  load: (signal: AbortSignal) => Promise<T>;
}): RetainedAdminQueryResult<T> {
  const [state, setState] = useState<RetainedAdminQueryState<T>>({
    data: null,
    error: null,
    initialLoading: enabled,
    lastSuccessfulAt: null,
    refreshing: false,
    stale: false,
  });
  const requestRef = useRef<{ controller: AbortController; id: number } | null>(
    null,
  );
  const requestIdRef = useRef(0);
  const keyRef = useRef(key);
  const loadRef = useRef(load);
  keyRef.current = key;
  loadRef.current = load;

  const runRequest = useCallback(async (requestKey: string) => {
    if (!enabled) return false;
    requestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestRef.current = { controller, id: requestId };
    setState((current) => ({
      ...current,
      error: null,
      initialLoading: current.data === null,
      refreshing: current.data !== null,
      stale: current.data !== null,
    }));

    try {
      const data = await loadRef.current(controller.signal);
      if (
        requestIdRef.current !== requestId ||
        keyRef.current !== requestKey ||
        controller.signal.aborted
      ) {
        return false;
      }
      setState({
        data,
        error: null,
        initialLoading: false,
        lastSuccessfulAt: new Date().toISOString(),
        refreshing: false,
        stale: false,
      });
      return true;
    } catch (error) {
      if (
        requestIdRef.current !== requestId ||
        keyRef.current !== requestKey ||
        controller.signal.aborted
      ) {
        return false;
      }
      setState((current) => ({
        ...current,
        error: getQueryErrorMessage(error),
        initialLoading: false,
        refreshing: false,
        stale: current.data !== null,
      }));
      return false;
    }
  }, [enabled]);

  const refresh = useCallback(
    () => runRequest(keyRef.current),
    [runRequest],
  );

  useEffect(() => {
    if (!enabled) {
      requestRef.current?.controller.abort();
      setState((current) => ({
        ...current,
        initialLoading: false,
        refreshing: false,
      }));
      return;
    }
    void runRequest(key);
    return () => {
      requestRef.current?.controller.abort();
    };
  }, [enabled, key, runRequest]);

  return { ...state, refresh };
}

function getQueryErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Request failed";
}
