import { AdminPoliciesController } from './admin-policies.controller';

describe('AdminPoliciesController', () => {
  const policies = {
    updateAuthPolicy: jest.fn(),
    updateStoragePolicy: jest.fn(),
  };
  const adminGuard = {
    requireAdminSession: jest.fn(() =>
      Promise.resolve({ user: { id: 'admin-1' } }),
    ),
    requirePermission: jest.fn(() =>
      Promise.resolve({ user: { id: 'admin-1' } }),
    ),
  };
  const controller = new AdminPoliciesController(
    policies as never,
    adminGuard as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('requires storage management before updating the combined policy', async () => {
    const dto = { workspaceId: 'workspace-1', quotaBytes: 1000 };
    await controller.updateStoragePolicy(dto, 'Bearer token');
    expect(adminGuard.requirePermission).toHaveBeenCalledWith(
      'Bearer token',
      'storage',
      'manage',
    );
    expect(policies.updateStoragePolicy).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('requires an admin session before updating authentication policy', async () => {
    const dto = { auth: { localEnabled: true } };
    await controller.updateAuthPolicy(dto, 'Bearer token');
    expect(adminGuard.requireAdminSession).toHaveBeenCalledWith('Bearer token');
    expect(policies.updateAuthPolicy).toHaveBeenCalledWith(dto, 'admin-1');
  });
});
