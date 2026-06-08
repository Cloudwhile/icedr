"use client";

import { Avatar } from "@heroui/react";
import { cn } from "./cn";
import "./app-user-avatar.css";

type AppUserAvatarSize = "sm" | "md" | "lg";

export type AppUserAvatarProps = {
  className?: string;
  fallbackClassName?: string;
  label: string;
  size?: AppUserAvatarSize;
  src?: string | null;
};

export function AppUserAvatar({
  className,
  fallbackClassName,
  label,
  size = "md",
  src,
}: AppUserAvatarProps) {
  const displayLabel = label.trim() || "User";
  const initials = getUserInitials(displayLabel);

  return (
    <Avatar className={cn("app-user-avatar", className)} data-size={size} size={size}>
      {src ? <Avatar.Image alt={displayLabel} src={src} /> : null}
      <Avatar.Fallback className={cn("app-user-avatar-fallback", fallbackClassName)}>
        {initials}
      </Avatar.Fallback>
    </Avatar>
  );
}

function getUserInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "U";

  const emailName = trimmed.includes("@") ? trimmed.split("@")[0] ?? trimmed : trimmed;
  const nameParts = emailName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  if (nameParts.length > 1) {
    return nameParts.map((part) => part[0]).join("").toUpperCase();
  }

  return (emailName[0] ?? "U").toUpperCase();
}
