import { Test, TestingModule } from '@nestjs/testing';
import { AdminGuardService } from './common/security/admin-guard.service';
import { AppController } from './app.controller';
import {
  AppService,
  compareAppVersions,
  isAppVersionPrerelease,
} from './app.service';

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
    it('normalizes explicit prerelease app versions', () => {
      const previousVersion = process.env.APP_VERSION;
      process.env.APP_VERSION = 'v0.0.1-alpha.1';

      try {
        const overview = new AppService().getSystemOverview();
        expect(overview.appVersion).toBe('0.0.1-alpha.1');
        expect(overview.appVersionTag).toBe('v0.0.1-alpha.1');
        expect(overview.appReleaseChannel).toBe('prerelease');
        expect(overview.appPrereleaseLabel).toBe('alpha');
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
      expect(overview.appVersionTag).toEqual(expect.any(String));
      expect(overview.appReleaseChannel).toMatch(/^(stable|prerelease)$/);
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

    it('protects update status and compares prerelease versions', async () => {
      const previousVersion = process.env.APP_VERSION;
      const previousUpdateCheckUrl = process.env.ICEDR_UPDATE_CHECK_URL;
      process.env.APP_VERSION = 'v0.0.1-alpha.1';
      process.env.ICEDR_UPDATE_CHECK_URL =
        'data:application/json,[{"tag_name":"v0.0.1-beta.1","html_url":"https://example.test/releases/v0.0.1-beta.1"}]';

      try {
        const updateStatus = await new AppService().getSystemUpdateStatus();
        expect(updateStatus.currentVersion).toBe('0.0.1-alpha.1');
        expect(updateStatus.currentTag).toBe('v0.0.1-alpha.1');
        expect(updateStatus.currentReleaseChannel).toBe('prerelease');
        expect(updateStatus.latestVersion).toBe('0.0.1-beta.1');
        expect(updateStatus.updateAvailable).toBe(true);
        expect(isAppVersionPrerelease('v0.0.1-alpha.1')).toBe(true);
        expect(compareAppVersions('0.0.1-beta.1', '0.0.1-alpha.1')).toBe(1);
        expect(compareAppVersions('0.0.1', '0.0.1-alpha.1')).toBe(1);
      } finally {
        if (previousVersion === undefined) {
          delete process.env.APP_VERSION;
        } else {
          process.env.APP_VERSION = previousVersion;
        }
        if (previousUpdateCheckUrl === undefined) {
          delete process.env.ICEDR_UPDATE_CHECK_URL;
        } else {
          process.env.ICEDR_UPDATE_CHECK_URL = previousUpdateCheckUrl;
        }
      }
    });
  });
});
