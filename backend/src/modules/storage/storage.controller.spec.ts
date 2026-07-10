import type { Request } from 'express';
import { AdminGuardService } from '../../common/security/admin-guard.service';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

describe('StorageController local object access', () => {
  it('requires storage management permission for the legacy local upload route', async () => {
    const requirePermission = jest.fn(() => Promise.resolve({}));
    const writeLocalUpload = jest.fn(() => Promise.resolve({ stored: true }));
    const controller = new StorageController(
      { writeLocalUpload } as unknown as StorageService,
      { requirePermission } as unknown as AdminGuardService,
    );
    const request = {} as Request;

    await controller.uploadLocalObject(
      'local/workspace/file.bin',
      'Bearer admin',
      request,
    );

    expect(requirePermission).toHaveBeenCalledWith(
      'Bearer admin',
      'storage',
      'manage',
    );
    expect(writeLocalUpload).toHaveBeenCalledWith(
      'local/workspace/file.bin',
      request,
    );
  });
});
