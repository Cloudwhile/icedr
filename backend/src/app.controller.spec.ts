import { Test, TestingModule } from '@nestjs/testing';
import { AdminGuardService } from './common/security/admin-guard.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let adminGuard: { requirePermission: jest.Mock };

  beforeEach(async () => {
    adminGuard = { requirePermission: jest.fn() };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: AdminGuardService,
          useValue: adminGuard,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return the ICEDR service index', () => {
      expect(appController.getServiceIndex()).toMatchObject({
        name: 'ICEDR API',
        architecture: 'NestJS Monolith',
      });
    });
  });

  describe('system overview', () => {
    it('preserves explicit prerelease app versions', () => {
      const previousVersion = process.env.APP_VERSION;
      process.env.APP_VERSION = '1.2.3-beta.1';

      try {
        expect(new AppService().getSystemOverview().appVersion).toBe(
          '1.2.3-beta.1',
        );
      } finally {
        if (previousVersion === undefined) {
          delete process.env.APP_VERSION;
        } else {
          process.env.APP_VERSION = previousVersion;
        }
      }
    });

    it('returns protected runtime and host information for admins', async () => {
      const overview = await appController.getSystemOverview('Bearer token');

      expect(adminGuard.requirePermission).toHaveBeenCalledWith(
        'Bearer token',
        'settings',
        'read',
      );
      expect(overview).toMatchObject({
        apiName: 'ICEDR API',
        runtime: 'NestJS',
      });
      expect(overview.appVersion).toEqual(expect.any(String));
      expect(overview.architecture).toEqual(expect.any(String));
      expect(overview.loadAverage).toEqual(expect.any(Array));
      expect(overview.memoryFreeBytes).toEqual(expect.any(Number));
      expect(overview.memoryTotalBytes).toEqual(expect.any(Number));
      expect(overview.memoryUsagePercent).toEqual(expect.any(Number));
      expect(overview.operatingSystem).toEqual(expect.any(String));
      expect(overview.osPlatform).toEqual(expect.any(String));
      expect(overview.osRelease).toEqual(expect.any(String));
      expect(overview.processUptimeSeconds).toEqual(expect.any(Number));
      expect(overview.serviceStartedAt).toEqual(expect.any(String));
    });
  });
});
