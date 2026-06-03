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
  if (user.role === "admin") return true;
  if (user.role === "member") {
    return ["drive", "links", "transfers", "settings"].includes(module);
  }
  return false;
}
