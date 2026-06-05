"use client";

import { Avatar } from "@heroui/react";
import { AppMenu, type AppMenuItem } from "./app-menu";
import { isAdminUser } from "@/features/auth/permissions";
import type { AuthUser } from "@/lib/drive-api";
import type { Palette } from "@/features/file/model";
import { LocalIcon } from "./app-icon";

export type UserAccountMenuProps = {
  currentUser: AuthUser | null;
  onLogout?: () => void;
  onOpenAdmin?: () => void;
  onOpenSettings?: () => void;
  palette: Palette;
  t: (key: string, values?: Record<string, string | number>) => string;
};

export function UserAccountMenu({
  currentUser,
  onLogout,
  onOpenAdmin,
  onOpenSettings,
  palette,
  t,
}: UserAccountMenuProps) {
  const displayName = currentUser?.displayName?.trim() || (currentUser ? t("app.account") : t("app.accountGuest"));
  const items: AppMenuItem[] = [];

  const showAdminEntry = isAdminUser(currentUser) && Boolean(onOpenAdmin);

  if (showAdminEntry) {
    items.push({
      icon: <LocalIcon name="shield" size={15} />,
      label: t("app.adminPanel"),
      onClick: onOpenAdmin,
      value: "admin",
    });
  }

  items.push(
    {
      icon: <LocalIcon name="settings" size={15} />,
      label: t("app.accountSettings"),
      onClick: onOpenSettings,
      separatorBefore: showAdminEntry,
      value: "settings",
    },
    {
      icon: <LocalIcon name="arrow_left" size={15} />,
      label: t("auth.logout"),
      onClick: onLogout,
      separatorBefore: true,
      tone: "danger",
      value: "logout",
    },
  );

  return (
    <AppMenu ariaLabel={t("app.accountMenu")} className="drive-account-menu" items={items} palette={palette}>
      <button
        aria-label={t("app.accountMenu")}
        className="drive-account-trigger"
        style={
          {
            "--account-bg": palette.surface2,
            "--account-border": palette.hairline,
            "--account-color": palette.ink,
            "--account-focus": palette.focusRing,
            "--account-hover-bg": palette.surface3,
            "--account-hover-border": palette.hairlineStrong,
            "--account-muted": palette.subtle,
          } as React.CSSProperties
        }
        type="button"
      >
        <Avatar size="sm" className="drive-user-avatar">
          {currentUser?.avatarUrl ? <Avatar.Image alt={displayName} src={currentUser.avatarUrl} /> : null}
          <Avatar.Fallback className="drive-user-avatar-fallback">
            <LocalIcon name="user_avatar" size={20} color={palette.primaryHover} />
          </Avatar.Fallback>
        </Avatar>
        <span className="drive-account-text">
          <span className="drive-account-name icedr-truncate">{displayName}</span>
        </span>
        <LocalIcon name="arrow_down" size={14} color={palette.subtle} />
      </button>
    </AppMenu>
  );
}
