import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../../auth/core/auth.service';
import {
  AuthSessionResponse,
  UpdateAuthSettingsDto,
} from '../../auth/core/auth.dto';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CompleteSetupDto } from '../settings/settings.dto';

export type CompleteSetupResponse = {
  session: AuthSessionResponse;
  bootstrapCompleted: boolean;
};

@Injectable()
export class SetupService {
  constructor(
    private readonly authService: AuthService,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
    private readonly storageService: StorageService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async complete(
    dto: CompleteSetupDto,
    request?: Request,
  ): Promise<CompleteSetupResponse> {
    await this.settingsService.assertSetupOpen();
    const databaseProfile = await this.settingsService.getDatabaseProfile();
    if (!databaseProfile.verified) {
      throw new BadRequestException(
        'Database must be verified before setup can be completed',
      );
    }

    if (!dto.localEnabled && !dto.oauthEnabled && !dto.passkeyEnabled) {
      throw new BadRequestException(
        'At least one authentication method must be enabled',
      );
    }

    if (dto.mail) await this.settingsService.updateMailSettings(dto.mail);
    const mailSettings = await this.settingsService.getMailSettings();
    if (mailSettings.enabled) await this.mailService.assertReady();

    const session = await this.authService.createSetupAdmin(dto.admin, request);
    await this.settingsService.updateSiteSettings(dto.site ?? {});
    if (dto.oauth) await this.settingsService.updateOAuthSettings(dto.oauth);
    if (dto.passkey) {
      await this.settingsService.updatePasskeySettings(dto.passkey);
    }

    await this.authService.updateSettingsForSetup({
      localEnabled: dto.localEnabled,
      oauthEnabled: dto.oauthEnabled,
      passkeyEnabled: dto.passkeyEnabled,
    } satisfies UpdateAuthSettingsDto);

    await this.storageService.updateSettings({
      distributedStorageEnabled: dto.distributedStorageEnabled,
    });
    await this.workspacesService.updateShareSettings(
      'workspace-default',
      dto.sharePolicy,
    );
    await this.settingsService.markBootstrapCompleted();

    return {
      session,
      bootstrapCompleted: true,
    };
  }
}
