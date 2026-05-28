"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { AppToastProvider } from "@/components/ui/app-toast";

export function Provider(props: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <AppToastProvider />
      {props.children}
    </MotionConfig>
  );
}
