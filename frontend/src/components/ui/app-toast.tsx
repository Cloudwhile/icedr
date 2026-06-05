"use client";

import { Toast } from "@heroui/react";
import type { ReactNode } from "react";

export type AppToastTone = "success" | "error" | "info" | "warning" | "neutral";

export type AppToastOptions = {
  description?: ReactNode;
  duration?: number;
  title: ReactNode;
  tone?: AppToastTone;
};

export function AppToastProvider() {
  return (
    <Toast.Provider
      className="icedr-toast-region"
      maxVisibleToasts={4}
      placement="bottom start"
      width="min(420px, calc(100vw - 24px))"
    />
  );
}

export function showAppToast({
  description,
  duration = 2600,
  title,
  tone = "success",
}: AppToastOptions) {
  const options = {
    description,
    timeout: duration,
  };

  if (tone === "error") return Toast.toast.danger(title, options);
  if (tone === "info") return Toast.toast.info(title, options);
  if (tone === "warning") return Toast.toast.warning(title, options);
  if (tone === "neutral") return Toast.toast(title, options);
  return Toast.toast.success(title, options);
}
