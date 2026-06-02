export type PermissionRole = 'owner' | 'admin' | 'member' | 'guest';

export type PermissionResource =
  | 'audit'
  | 'file'
  | 'settings'
  | 'share'
  | 'storage'
  | 'transfer'
  | 'user'
  | 'workspace';

export type PermissionAction =
  | 'delete'
  | 'download'
  | 'manage'
  | 'read'
  | 'share'
  | 'write';

type PermissionMatrix = Record<
  PermissionRole,
  Partial<Record<PermissionResource, readonly PermissionAction[]>>
>;

const allActions: readonly PermissionAction[] = [
  'delete',
  'download',
  'manage',
  'read',
  'share',
  'write',
];

export const permissionMatrix: PermissionMatrix = {
  owner: {
    audit: allActions,
    file: allActions,
    settings: allActions,
    share: allActions,
    storage: allActions,
    transfer: allActions,
    user: allActions,
    workspace: allActions,
  },
  admin: {
    audit: ['read', 'manage'],
    file: ['read', 'write', 'delete', 'download', 'share', 'manage'],
    settings: ['read', 'write', 'manage'],
    share: ['read', 'write', 'delete', 'manage'],
    storage: ['read', 'write', 'manage'],
    transfer: ['read', 'write', 'delete', 'manage'],
    user: ['read', 'write', 'manage'],
    workspace: ['read', 'write', 'manage'],
  },
  member: {
    file: ['read', 'write', 'delete', 'download', 'share'],
    share: ['read', 'write', 'delete'],
    storage: ['read'],
    transfer: ['read', 'write', 'delete'],
    user: ['read', 'write'],
    workspace: ['read'],
  },
  guest: {
    share: ['read', 'download'],
  },
};

export function canAccessResource(
  role: PermissionRole | null | undefined,
  resource: PermissionResource,
  action: PermissionAction,
) {
  if (!role) return false;
  return permissionMatrix[role]?.[resource]?.includes(action) ?? false;
}

export function formatPermission(
  resource: PermissionResource,
  action: PermissionAction,
) {
  return `${resource}.${action}`;
}
