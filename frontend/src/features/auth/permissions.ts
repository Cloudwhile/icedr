import type { DriveModule } from "@/features/file/model";
import type { AuthUser } from "@/lib/drive-api";

export type DrivePermissionModule = DriveModule | "settings";

export function isAdminUser(user: AuthUser | null | undefined) {
  return user?.role === "admin";
}

export function canAccessDriveModule(
  user: AuthUser | null | undefined,
  module: DrivePermissionModule,
) {
  if (!user) return false;
  if (module === "audit") return isAdminUser(user);
  return true;
}
