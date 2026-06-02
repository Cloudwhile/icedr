"use client";

import type { CSSProperties } from "react";
import { tailChase } from "ldrs";
import { useMotionReveal } from "@/components/ui/motion";
import type { Palette } from "@/features/file/model";

if (typeof window !== "undefined") {
  tailChase.register();
}

export type AppLoadingStage = "progress" | "blocking";
export { WorkspaceSkeleton } from "./drive-loading-state";

export function LoadingSpinner({
  palette,
  size = 18,
}: {
  palette: Palette;
  size?: number;
}) {
  const loaderSize = Math.max(16, size);
  const frameSize = Math.max(20, loaderSize + 6);

  return (
    <div
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: "transparent",
        color: palette.primaryHover,
        display: "flex",
        height: `${frameSize}px`,
        justifyContent: "center",
        width: `${frameSize}px`,
      }}
    >
      <l-tail-chase size={`${loaderSize}`} speed="1.75" color="currentColor" />
    </div>
  );
}

export function LdrsLoadingState({
  compact = false,
  framed = false,
  label = "Loading",
  minHeight = 220,
  palette,
  size = 28,
}: {
  compact?: boolean;
  framed?: boolean;
  label?: string;
  minHeight?: CSSProperties["minHeight"];
  palette: Palette;
  size?: number;
}) {
  const revealRef = useMotionReveal<HTMLDivElement>("surface", []);

  return (
    <div
      ref={revealRef}
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        alignItems: "center",
        color: palette.ink,
        display: "flex",
        justifyContent: "center",
        minHeight,
        padding: compact ? "12px" : "24px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: framed ? palette.surface1 : "transparent",
          borderColor: palette.hairline,
          borderRadius: "8px",
          borderWidth: framed ? "1px" : "0px",
          display: "flex",
          gap: compact ? "10px" : "12px",
          justifyContent: "center",
          minHeight: compact ? "40px" : "56px",
          minWidth: compact ? "auto" : "176px",
          paddingInline: compact ? "8px" : "16px",
        }}
      >
        <LoadingSpinner palette={palette} size={size} />
        <span
          style={{
            color: palette.muted,
            fontSize: "12px",
            fontWeight: "600",
            lineHeight: "1.4",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export function LoadingCurtain({
  label = "Loading",
  palette,
}: {
  label?: string;
  palette: Palette;
}) {
  const revealRef = useMotionReveal<HTMLDivElement>("menu", []);

  return (
    <div
      ref={revealRef}
      role="status"
      aria-live="polite"
      aria-label={label}
      className="icedr-r-right icedr-r-top icedr-r-transform"
      style={{
        "--r-right-base": "50%",
        "--r-right-md": "20px",
        "--r-top-base": "68px",
        "--r-top-md": "70px",
        "--r-transform-base": "translateX(50%)",
        "--r-transform-md": "none",
        alignItems: "center",
        background: palette.surface1,
        borderColor: palette.hairlineStrong,
        borderRadius: "8px",
        borderWidth: "1px",
        boxShadow: "0 16px 44px rgba(0, 0, 0, 0.28)",
        color: palette.ink,
        display: "flex",
        gap: "12px",
        maxWidth: "calc(100vw - 24px)",
        paddingBlock: "8px",
        paddingInline: "12px",
        pointerEvents: "none",
        position: "fixed",
        zIndex: "60",
      } as CSSProperties}
    >
      <LoadingSpinner palette={palette} size={16} />
      <span
        style={{
          color: palette.muted,
          fontSize: "12px",
          fontWeight: "600",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function AppLoading({
  label = "Loading workspace",
  palette,
  stage,
}: {
  label?: string;
  palette: Palette;
  stage: AppLoadingStage;
  viewMode?: "list" | "grid";
}) {
  if (stage === "progress") {
    return <AppProgressLoading label={label} palette={palette} />;
  }

  return (
    <div
      aria-label={label}
      role="status"
      style={{
        background: palette.canvas,
        color: palette.ink,
        inset: "0px",
        pointerEvents: "none",
        position: "fixed",
        zIndex: "70",
      }}
    >
      <LdrsLoadingState label={label} palette={palette} minHeight="100vh" size={32} />
      <TopProgressBar palette={palette} />
    </div>
  );
}

function AppProgressLoading({
  label,
  palette,
}: {
  label: string;
  palette: Palette;
}) {
  return (
    <div
      style={{
        pointerEvents: "none",
        position: "fixed",
        top: "0px",
        zIndex: "70",
      }}
    >
      <TopProgressBar palette={palette} />
      <LoadingCurtain label={label} palette={palette} />
    </div>
  );
}

function TopProgressBar({ palette }: { palette: Palette }) {
  return (
    <div
      style={{
        height: "2px",
        overflow: "hidden",
      }}
    >
      <div
        className="icedr-top-progress"
        style={{
          background: palette.primaryHover,
        }}
      />
    </div>
  );
}

export function ShareCreationLoading({
  label = "Loading",
  palette,
}: {
  label?: string;
  palette: Palette;
}) {
  return <LdrsLoadingState compact label={label} palette={palette} minHeight={220} size={24} />;
}

export function ExternalSharePageLoading({
  label = "Loading",
  palette,
}: {
  label?: string;
  palette: Palette;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background: palette.canvas,
        display: "flex",
        justifyContent: "center",
        minHeight: "100vh",
        paddingBlock: "32px",
        paddingInline: "12px",
      }}
    >
      <LdrsLoadingState label={label} palette={palette} minHeight={320} size={32} />
    </div>
  );
}
