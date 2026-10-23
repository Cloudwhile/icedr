"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { AppToastProvider } from "@/components/ui/app-toast";
import { usePrefersReducedMotion } from "@/components/ui/use-prefers-reduced-motion";

export function Provider(props: { children: ReactNode }) {
  const reduce = usePrefersReducedMotion();
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <AppToastProvider />
      {props.children}
    </MotionConfig>
  );
}
