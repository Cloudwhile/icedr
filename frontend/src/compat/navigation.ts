import { useMemo, useSyncExternalStore } from "react";

const navigationEventName = "icedr:navigation";
const historyIndexKey = "__icedrNavigationIndex";
const historySequenceKey = "__icedrNavigationSequence";
const historySequencePrefix = `${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2)}`;

export type NavigationAction = "pop" | "push" | "replace";

export type BlockedNavigation = {
  action: NavigationAction;
  currentUrl: URL;
  nextUrl: URL;
  retry: () => void;
};

export type NavigationBlocker = (navigation: BlockedNavigation) => boolean;

type NavigateMode = Exclude<NavigationAction, "pop">;

type TrackedHistoryEntry = {
  index: number;
  sequence: string;
  state: unknown;
  url: string;
};

type PendingPopNavigation = {
  previous: TrackedHistoryEntry;
};

const navigationBlockers = new Set<NavigationBlocker>();
let currentHistoryEntry: TrackedHistoryEntry | null = null;
let pendingPopNavigation: PendingPopNavigation | null = null;
let permittedPopEntry: TrackedHistoryEntry | null = null;
let popstateListenerInstalled = false;
let historySequenceCounter = 0;

export function useRouter() {
  useLocationSnapshot();

  return useMemo(
    () => ({
      back() {
        window.history.back();
      },
      forward() {
        window.history.forward();
      },
      prefetch() {
        return Promise.resolve();
      },
      push(href: string) {
        navigate(href, "push");
      },
      refresh() {
        dispatchNavigationEvent();
      },
      replace(href: string) {
        navigate(href, "replace");
      },
    }),
    [],
  );
}

export function usePathname() {
  return useLocationSnapshot().pathname;
}

export function useSearchParams() {
  const { search } = useLocationSnapshot();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function notFound(): never {
  throw new Error("Not found");
}

export function registerNavigationBlocker(blocker: NavigationBlocker) {
  navigationBlockers.add(blocker);
  startTrackingHistory();

  return () => {
    navigationBlockers.delete(blocker);
  };
}

function navigate(href: string, mode: NavigateMode) {
  const url = new URL(href, window.location.href);
  const currentUrl = new URL(window.location.href);
  let retried = false;

  const commit = () => {
    if (url.origin !== window.location.origin) {
      window.location.href = url.href;
      return;
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    commitSameOriginNavigation(next, mode);
  };

  const transition: BlockedNavigation = {
    action: mode,
    currentUrl,
    nextUrl: url,
    retry() {
      if (retried) return;
      retried = true;
      commit();
    },
  };

  if (runNavigationBlockers(transition)) return;
  retried = true;
  commit();
}

function commitSameOriginNavigation(next: string, mode: NavigateMode) {
  startTrackingHistory();
  const current =
    currentHistoryEntry ??
    trackCurrentHistoryEntry(window.history.state, getSnapshot());
  const index = mode === "push" ? current.index + 1 : current.index;
  const state = withHistoryIndex(
    mode === "replace" ? window.history.state : null,
    index,
    current.sequence,
  );

  if (mode === "replace") window.history.replaceState(state, "", next);
  else window.history.pushState(state, "", next);
  currentHistoryEntry = {
    index,
    sequence: current.sequence,
    state,
    url: next,
  };
  dispatchNavigationEvent();
}

function useLocationSnapshot() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => new URL(snapshot, "http://localhost"), [snapshot]);
}

function subscribe(onStoreChange: () => void) {
  startTrackingHistory();
  window.addEventListener(navigationEventName, onStoreChange);
  return () => {
    window.removeEventListener(navigationEventName, onStoreChange);
  };
}

function getSnapshot() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getServerSnapshot() {
  return "/";
}

function dispatchNavigationEvent() {
  window.dispatchEvent(new Event(navigationEventName));
}

function runNavigationBlockers(transition: BlockedNavigation) {
  for (const blocker of navigationBlockers) {
    try {
      if (blocker(transition)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function startTrackingHistory() {
  installPopstateListener();
  const url = getSnapshot();
  const storedEntry = readTrackedHistoryEntry(window.history.state, url);

  if (
    currentHistoryEntry &&
    storedEntry &&
    matchesHistoryEntry(storedEntry, currentHistoryEntry)
  ) {
    return;
  }

  currentHistoryEntry =
    storedEntry ?? trackCurrentHistoryEntry(window.history.state, url);
}

function installPopstateListener() {
  if (popstateListenerInstalled) return;
  window.addEventListener("popstate", handlePopstate);
  popstateListenerInstalled = true;
}

function handlePopstate(event: PopStateEvent) {
  const nextUrl = getSnapshot();
  const nextEntry = readTrackedHistoryEntry(event.state, nextUrl);

  if (permittedPopEntry && matchesHistoryEntry(nextEntry, permittedPopEntry)) {
    currentHistoryEntry = permittedPopEntry;
    pendingPopNavigation = null;
    permittedPopEntry = null;
    dispatchNavigationEvent();
    return;
  }
  permittedPopEntry = null;

  if (pendingPopNavigation) {
    const pending = pendingPopNavigation;
    pendingPopNavigation = null;
    if (matchesHistoryEntry(nextEntry, pending.previous)) {
      currentHistoryEntry = pending.previous;
      return;
    }

    currentHistoryEntry =
      nextEntry ?? trackCurrentHistoryEntry(event.state, nextUrl);
    dispatchNavigationEvent();
    return;
  }

  if (!currentHistoryEntry || navigationBlockers.size === 0) {
    currentHistoryEntry =
      nextEntry ?? trackCurrentHistoryEntry(event.state, nextUrl);
    dispatchNavigationEvent();
    return;
  }

  const previous = currentHistoryEntry;
  if (
    !nextEntry ||
    nextEntry.sequence !== previous.sequence ||
    (nextEntry.index === previous.index &&
      !matchesHistoryEntry(nextEntry, previous))
  ) {
    handleUncomparablePop(event.state, nextUrl, previous);
    return;
  }

  if (matchesHistoryEntry(nextEntry, previous)) {
    currentHistoryEntry = nextEntry;
    dispatchNavigationEvent();
    return;
  }

  const target = nextEntry;
  const delta = target.index - previous.index;
  let retried = false;
  const transition: BlockedNavigation = {
    action: "pop",
    currentUrl: new URL(previous.url, window.location.origin),
    nextUrl: new URL(target.url, window.location.origin),
    retry() {
      if (retried) return;
      retried = true;
      permittedPopEntry = target;
      window.history.go(delta);
    },
  };

  if (!runNavigationBlockers(transition)) {
    currentHistoryEntry = target;
    dispatchNavigationEvent();
    return;
  }

  pendingPopNavigation = { previous };
  window.history.go(-delta);
}

function handleUncomparablePop(
  targetState: unknown,
  targetUrl: string,
  previous: TrackedHistoryEntry,
) {
  let normalizedTarget: TrackedHistoryEntry | null = null;
  let retryRequested = false;
  let retried = false;
  const retry = () => {
    if (!normalizedTarget) {
      retryRequested = true;
      return;
    }
    permittedPopEntry = normalizedTarget;
    window.history.back();
  };
  const transition: BlockedNavigation = {
    action: "pop",
    currentUrl: new URL(previous.url, window.location.origin),
    nextUrl: new URL(targetUrl, window.location.origin),
    retry() {
      if (retried) return;
      retried = true;
      retry();
    },
  };

  if (!runNavigationBlockers(transition)) {
    currentHistoryEntry = trackCurrentHistoryEntry(targetState, targetUrl);
    dispatchNavigationEvent();
    return;
  }

  const sequence = createHistorySequence();
  const normalizedTargetState = withHistoryIndex(targetState, 0, sequence);
  window.history.replaceState(normalizedTargetState, "", targetUrl);
  normalizedTarget = {
    index: 0,
    sequence,
    state: normalizedTargetState,
    url: targetUrl,
  };

  const restoredState = withHistoryIndex(previous.state, 1, sequence);
  window.history.pushState(restoredState, "", previous.url);
  currentHistoryEntry = {
    index: 1,
    sequence,
    state: restoredState,
    url: previous.url,
  };

  if (retryRequested) retry();
}

function readHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const index = (state as Record<string, unknown>)[historyIndexKey];
  return typeof index === "number" && Number.isInteger(index) ? index : null;
}

function readTrackedHistoryEntry(
  state: unknown,
  url: string,
): TrackedHistoryEntry | null {
  if (!state || typeof state !== "object") return null;
  const index = readHistoryIndex(state);
  const sequence = (state as Record<string, unknown>)[historySequenceKey];
  if (index === null || typeof sequence !== "string" || !sequence) return null;
  return { index, sequence, state, url };
}

function trackCurrentHistoryEntry(state: unknown, url: string) {
  const sequence = createHistorySequence();
  const trackedState = withHistoryIndex(state, 0, sequence);
  window.history.replaceState(trackedState, "", url);
  return { index: 0, sequence, state: trackedState, url };
}

function createHistorySequence() {
  historySequenceCounter += 1;
  return `${historySequencePrefix}-${historySequenceCounter.toString(36)}`;
}

function withHistoryIndex(state: unknown, index: number, sequence: string) {
  const baseState =
    state && typeof state === "object" && !Array.isArray(state)
      ? state
      : {};
  return {
    ...baseState,
    [historyIndexKey]: index,
    [historySequenceKey]: sequence,
  };
}

function matchesHistoryEntry(
  actual: TrackedHistoryEntry | null,
  expected: TrackedHistoryEntry,
) {
  return (
    actual?.index === expected.index &&
    actual.sequence === expected.sequence &&
    actual.url === expected.url
  );
}
