import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("updates mounted consumers when the system motion preference changes and removes the listener", () => {
  const events = new EventTarget();
  const media = {
    matches: false,
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  const { result, unmount } = renderHook(usePrefersReducedMotion);
  expect(result.current).toBe(false);
  act(() => {
    media.matches = true;
    events.dispatchEvent(new Event("change"));
  });
  expect(result.current).toBe(true);
  act(() => {
    media.matches = false;
    events.dispatchEvent(new Event("change"));
  });
  expect(result.current).toBe(false);
  unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith("change", media.addEventListener.mock.calls[0][1]);
});

it("reads an existing reduced motion preference on mount", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  expect(renderHook(usePrefersReducedMotion).result.current).toBe(true);
});

it("works when matchMedia is unavailable", () => {
  vi.stubGlobal("matchMedia", undefined);
  expect(renderHook(usePrefersReducedMotion).result.current).toBe(false);
});
