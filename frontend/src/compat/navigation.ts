import { useMemo, useSyncExternalStore } from "react";

const navigationEventName = "icedr:navigation";
const historyIndexKey = "__icedrNavigationIndex";

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
  const shouldStartTracking = navigationBlockers.size === 0;
  navigationBlockers.add(blocker);
  if (shouldStartTracking) startTrackingHistory();

  return () => {
    navigationBlockers.delete(blocker);
    if (navigationBlockers.size === 0) stopTrackingHistory();
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
  if (navigationBlockers.size === 0) {
    if (mode === "replace") window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
    currentHistoryEntry = null;
    dispatchNavigationEvent();
    return;
  }
  startTrackingHistory();
  const current = currentHistoryEntry ?? {
    index: readHistoryIndex(window.history.state) ?? 0,
    url: getSnapshot(),
  };
  const index = mode === "push" ? current.index + 1 : current.index;
  const state = withHistoryIndex(null, index);

  if (mode === "replace") window.history.replaceState(state, "", next);
  else window.history.pushState(state, "", next);
  currentHistoryEntry = { index, url: next };
  dispatchNavigationEvent();
}

function useLocationSnapshot() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => new URL(snapshot, "http://localhost"), [snapshot]);
}

function subscribe(onStoreChange: () => void) {
  installPopstateListener();
  window.addEventListener(navigationEventName, onStoreChange);
  return () => {
    window.removeEventListener(navigationEventName, onStoreChange);
  };
}

function stopTrackingHistory() {
  currentHistoryEntry = null;
  pendingPopNavigation = null;
  permittedPopEntry = null;
  const state = window.history.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return;
  if (!(historyIndexKey in state)) return;
  const nextState = { ...(state as Record<string, unknown>) };
  delete nextState[historyIndexKey];
  window.history.replaceState(
    Object.keys(nextState).length > 0 ? nextState : null,
    "",
    getSnapshot(),
  );
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
  const storedIndex = readHistoryIndex(window.history.state);

  if (
    currentHistoryEntry &&
    currentHistoryEntry.url === url &&
    storedIndex === currentHistoryEntry.index
  ) {
    return;
  }

  const index = storedIndex ?? 0;
  if (storedIndex === null) {
    window.history.replaceState(
      withHistoryIndex(window.history.state, index),
      "",
      url,
    );
  }
  currentHistoryEntry = { index, url };
}

function installPopstateListener() {
  if (popstateListenerInstalled) return;
  window.addEventListener("popstate", handlePopstate);
  popstateListenerInstalled = true;
}

function handlePopstate(event: PopStateEvent) {
  const nextEntry = {
    index: readHistoryIndex(event.state),
    url: getSnapshot(),
  };

  if (permittedPopEntry && matchesHistoryEntry(nextEntry, permittedPopEntry)) {
    currentHistoryEntry = permittedPopEntry;
    permittedPopEntry = null;
    dispatchNavigationEvent();
    return;
  }

  if (pendingPopNavigation) {
    const pending = pendingPopNavigation;
    if (matchesHistoryEntry(nextEntry, pending.previous)) {
      pendingPopNavigation = null;
      currentHistoryEntry = pending.previous;
      return;
    }

    return;
  }

  const nextIndex = nextEntry.index;
  if (
    navigationBlockers.size === 0 ||
    !currentHistoryEntry ||
    nextIndex === null ||
    nextIndex === currentHistoryEntry.index
  ) {
    currentHistoryEntry =
      nextIndex === null ? null : { index: nextIndex, url: nextEntry.url };
    dispatchNavigationEvent();
    return;
  }

  const previous = currentHistoryEntry;
  const target = { index: nextIndex, url: nextEntry.url };
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

function readHistoryIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const index = (state as Record<string, unknown>)[historyIndexKey];
  return typeof index === "number" && Number.isInteger(index) ? index : null;
}

function withHistoryIndex(state: unknown, index: number) {
  const baseState =
    state && typeof state === "object" && !Array.isArray(state)
      ? state
      : {};
  return { ...baseState, [historyIndexKey]: index };
}

function matchesHistoryEntry(
  actual: { index: number | null; url: string },
  expected: TrackedHistoryEntry,
) {
  return actual.index === expected.index && actual.url === expected.url;
}
