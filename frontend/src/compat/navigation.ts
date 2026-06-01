import { useMemo, useSyncExternalStore } from "react";

const navigationEventName = "icedr:navigation";

type NavigateMode = "push" | "replace";

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

function navigate(href: string, mode: NavigateMode) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.href = url.href;
    return;
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
  dispatchNavigationEvent();
}

function useLocationSnapshot() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => new URL(snapshot, "http://localhost"), [snapshot]);
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(navigationEventName, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
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
