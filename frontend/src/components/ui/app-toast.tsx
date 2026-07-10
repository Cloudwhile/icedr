"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { LocalIcon } from "./app-icon";
import {
  closeAppToast,
  getAppToastSnapshot,
  subscribeAppToast,
  type AppToastSnapshot,
  type AppToastTone,
} from "./app-toast-store";
import "./app-toast.css";

const toastEnterDurationMs = 280;
const toastExitDurationMs = 160;
const toastMinimumLifetimeMs = 900;
export function AppToastProvider() {
  const toast = useSyncExternalStore(subscribeAppToast, getAppToastSnapshot, getAppToastSnapshot);

  return (
    <div className="icedr-toast-region">
      {toast ? <AppToast key={toast.id} toast={toast} /> : null}
    </div>
  );
}

function AppToast({ toast }: { toast: AppToastSnapshot }) {
  const toastRef = useRef<HTMLDivElement | null>(null);
  const countdownRef = useRef<HTMLSpanElement | null>(null);
  const animationFrameRef = useRef(0);
  const startTimeoutRef = useRef(0);
  const phaseRef = useRef<"entering" | "visible" | "exiting" | "closed">("entering");
  const countdownStartedAtRef = useRef(0);

  const stopCountdown = useCallback(() => {
    window.clearTimeout(startTimeoutRef.current);
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
  }, []);

  const setPhase = useCallback((phase: typeof phaseRef.current) => {
    const toastNode = toastRef.current;
    phaseRef.current = phase;
    if (toastNode) toastNode.dataset.phase = phase;
  }, []);

  const writeProgress = useCallback((progress: number, countdownState: "waiting" | "running" | "done") => {
    const countdownNode = countdownRef.current;
    if (!countdownNode) return;
    const nextProgress = Math.max(0, Math.min(1, progress));
    countdownNode.dataset.countdown = countdownState;
    countdownNode.style.transform = `scaleX(${nextProgress.toFixed(4)})`;
    countdownNode.style.setProperty("--icedr-toast-progress", nextProgress.toFixed(4));
  }, []);

  const finishToast = useCallback(() => {
    stopCountdown();
    setPhase("closed");
    writeProgress(0, "done");
    closeAppToast(toast.id);
  }, [setPhase, stopCountdown, toast.id, writeProgress]);

  const closeToast = useCallback(() => {
    if (phaseRef.current === "exiting" || phaseRef.current === "closed") return;

    stopCountdown();
    setPhase("exiting");
    const startedAt = performance.now();
    const initialProgress = readCurrentProgress(countdownRef.current);

    const tick = (now: number) => {
      if (phaseRef.current !== "exiting") return;
      const elapsed = Math.max(0, now - startedAt);
      const progress = initialProgress * Math.max(0, 1 - elapsed / toastExitDurationMs);
      writeProgress(progress, progress > 0 ? "running" : "done");

      if (elapsed < toastExitDurationMs) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      finishToast();
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [finishToast, setPhase, stopCountdown, writeProgress]);

  useEffect(() => {
    const toastNode = toastRef.current;
    const duration = Math.max(toastMinimumLifetimeMs, toast.duration);

    const startCountdown = () => {
      if (phaseRef.current !== "entering") return;
      setPhase("visible");
      writeProgress(1, "running");
      countdownStartedAtRef.current = performance.now();
      const exitStartsAt = Math.max(0, duration - toastExitDurationMs);

      const tick = (now: number) => {
        if (phaseRef.current !== "visible" && phaseRef.current !== "exiting") return;

        const elapsed = Math.max(0, now - countdownStartedAtRef.current);
        const progress = Math.max(0, 1 - elapsed / duration);
        writeProgress(progress, progress > 0 ? "running" : "done");

        if (elapsed >= exitStartsAt && phaseRef.current === "visible") {
          setPhase("exiting");
        }

        if (elapsed < duration) {
          animationFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        finishToast();
      };

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    setPhase("entering");
    writeProgress(1, "waiting");

    startTimeoutRef.current = window.setTimeout(startCountdown, getToastEnterDuration(toastNode));

    return () => {
      stopCountdown();
    };
  }, [finishToast, setPhase, stopCountdown, toast.duration, writeProgress]);

  return (
    <div
      ref={toastRef}
      aria-label={typeof toast.title === "string" ? toast.title : undefined}
      className="icedr-app-toast"
      data-phase="entering"
      data-variant={getToastVariant(toast.tone)}
      role={toast.tone === "error" || toast.tone === "warning" ? "alert" : "status"}
      style={{ viewTransitionName: "none" }}
    >
      <span ref={countdownRef} className="icedr-app-toast-countdown" aria-hidden="true" data-countdown="waiting" />
      <div className="icedr-app-toast-content">
        <span className="icedr-app-toast-indicator" aria-hidden="true">
          <LocalIcon name={getToastIconName(toast.tone)} size={15} />
        </span>
        <span className="icedr-app-toast-copy">
          <span className="icedr-app-toast-title">{toast.title}</span>
          {toast.description ? <span className="icedr-app-toast-description">{toast.description}</span> : null}
        </span>
        <button
          type="button"
          aria-label="Close"
          className="icedr-app-toast-close"
          onClick={closeToast}
        >
          <LocalIcon name="cross" size={13} />
        </button>
      </div>
    </div>
  );
}

function readCurrentProgress(node: HTMLElement | null) {
  if (!node) return 1;
  const cssProgress = Number.parseFloat(node.style.getPropertyValue("--icedr-toast-progress"));
  if (Number.isFinite(cssProgress)) return Math.max(0, Math.min(1, cssProgress));
  return 1;
}

function getToastVariant(tone: AppToastTone) {
  if (tone === "error") return "danger";
  if (tone === "neutral") return "default";
  return tone;
}

function getToastIconName(tone: AppToastTone) {
  if (tone === "error" || tone === "warning") return "exclamation";
  if (tone === "success") return "tick";
  return "info";
}

function getToastEnterDuration(node: HTMLElement | null) {
  if (!node) return toastEnterDurationMs;
  const style = window.getComputedStyle(node);
  const animationNames = style.animationName.split(",");
  const animationIndex = Math.max(0, animationNames.findIndex((name) => name.trim() === "icedr-app-toast-enter"));
  const duration = parseCssTimeList(style.animationDuration)[animationIndex] ?? 0;
  const delay = parseCssTimeList(style.animationDelay)[animationIndex] ?? 0;
  const total = duration + delay;
  return total > 0 ? total + 24 : 0;
}

function parseCssTimeList(value: string) {
  return value.split(",").map((item) => {
    const next = item.trim();
    if (next.endsWith("ms")) return Number.parseFloat(next);
    if (next.endsWith("s")) return Number.parseFloat(next) * 1000;
    return Number.parseFloat(next) || 0;
  });
}
