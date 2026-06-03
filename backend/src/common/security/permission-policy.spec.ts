import {
  canAccessResource,
  permissionMatrix,
  type PermissionAction,
  type PermissionResource,
  type PermissionRole,
} from './permission-policy';

describe('permission policy', () => {
  it('allows members to use workspace resources without admin privileges', () => {
    expect(canAccessResource('member', 'workspace', 'read')).toBe(true);
    expect(canAccessResource('member', 'file', 'write')).toBe(true);
    expect(canAccessResource('member', 'file', 'download')).toBe(true);
    expect(canAccessResource('member', 'share', 'write')).toBe(true);
    expect(canAccessResource('member', 'transfer', 'delete')).toBe(true);
  });

  it('keeps admin-only resources out of the member role', () => {
    expect(canAccessResource('member', 'audit', 'read')).toBe(false);
    expect(canAccessResource('member', 'settings', 'manage')).toBe(false);
    expect(canAccessResource('member', 'storage', 'manage')).toBe(false);
    expect(canAccessResource('member', 'share', 'manage')).toBe(false);
  });

  it('allows admins to manage backend administration resources', () => {
    expect(canAccessResource('admin', 'audit', 'read')).toBe(true);
    expect(canAccessResource('admin', 'settings', 'manage')).toBe(true);
    expect(canAccessResource('admin', 'storage', 'manage')).toBe(true);
    expect(canAccessResource('admin', 'share', 'manage')).toBe(true);
  });

  it('keeps the documented matrix explicit for every role', () => {
    const roles: PermissionRole[] = ['owner', 'admin', 'member', 'guest'];
    const resources: PermissionResource[] = [
      'audit',
      'file',
      'settings',
      'share',
      'storage',
      'transfer',
      'user',
      'workspace',
    ];

    roles.forEach((role) => {
      expect(permissionMatrix[role]).toBeDefined();
      resources.forEach((resource) => {
        const actions = permissionMatrix[role][resource] ?? [];
        actions.forEach((action: PermissionAction) => {
          expect(canAccessResource(role, resource, action)).toBe(true);
        });
      });
    });
  });
});
