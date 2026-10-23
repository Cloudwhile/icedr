import { useSyncExternalStore } from "react";

const mediaQuery = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = typeof window !== "undefined" ? window.matchMedia?.(mediaQuery) : undefined;
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

function getSnapshot() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(mediaQuery).matches);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
