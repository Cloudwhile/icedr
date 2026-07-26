import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type {
  AuthSessionResponse,
  UpdateAuthSettingsDto,
} from '../../auth/core/auth.dto';
import { AuthService } from '../../auth/core/auth.service';
import { StorageService } from '../../storage/storage.service';
import { MailService } from '../mail/mail.service';
import type { CompleteSetupDto } from '../settings/settings.dto';
import { SettingsService } from '../settings/settings.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  SetupOperationService,
  type SetupOperationClaim,
} from './setup-operation.service';

export type CompleteSetupResponse = {
  session: AuthSessionResponse;
  bootstrapCompleted: boolean;
};

@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
    private readonly storageService: StorageService,
    private readonly workspacesService: WorkspacesService,
    private readonly operationService: SetupOperationService,
  ) {}

  async complete(
    dto: CompleteSetupDto,
    request?: Request,
  ): Promise<CompleteSetupResponse> {
    await this.preflight(dto);
    const claim = await this.operationService.claimComplete(dto);

    try {
      const session = await this.operationService.withLease(claim, async () => {
        await this.settingsService.assertSetupOpen();
        await this.operationService.markIrreversible(claim);
        await this.persistSettings(dto, claim);
        await this.operationService.extendLease(claim);
        return this.authService.createSetupAdmin(dto.admin, request);
      });
      await this.operationService.completeWithBootstrap(claim);
      return { session, bootstrapCompleted: true };
    } catch (error) {
      try {
        await this.operationService.fail(claim, error);
      } catch (releaseError) {
        this.logger.warn(
          `Setup claim release failed: ${
            releaseError instanceof Error ? releaseError.name : 'UnknownError'
          }`,
        );
      }
      throw error;
    }
  }

  private async preflight(dto: CompleteSetupDto) {
    await this.settingsService.assertSetupOpen();
    const databaseProfile = await this.settingsService.getDatabaseProfile();
    if (!databaseProfile.verified) {
      throw new BadRequestException(
        'Database must be verified before setup can be completed',
      );
    }
    this.assertAuthenticationMethod(dto);

    const authSettings = this.authSettings(dto);
    const storageSettings = this.storageSettings(dto);
    const [oauth, passkey] = await Promise.all([
      dto.oauth
        ? this.settingsService.validateOAuthSettings(dto.oauth)
        : Promise.resolve(undefined),
      dto.passkey
        ? this.settingsService.validatePasskeySettings(dto.passkey)
        : Promise.resolve(undefined),
      this.authService.validateSetupAdmin(dto.admin),
      this.settingsService.validateSiteSettings(dto.site ?? {}),
      this.storageService.validateSettings(storageSettings),
      this.workspacesService.validateShareSettings(
        'workspace-default',
        dto.sharePolicy,
      ),
    ]);
    await this.authService.validateSettingsForSetup(authSettings, {
      oauth,
      passkey,
    });

    const mailSettings = await this.settingsService.previewMailSettings(
      dto.mail ?? {},
    );
    if (mailSettings.enabled) {
      await this.mailService.assertReady(mailSettings);
    }
  }

  private async persistSettings(
    dto: CompleteSetupDto,
    claim: SetupOperationClaim,
  ) {
    let lastCompletedStep = 'none';
    const runStep = async (step: string, action: () => Promise<unknown>) => {
      await this.operationService.extendLease(claim);
      await action();
      lastCompletedStep = step;
    };

    try {
      const mail = dto.mail;
      if (mail) {
        await runStep('mail', () =>
          this.settingsService.updateMailSettings(mail),
        );
      }
      await runStep('site', () =>
        this.settingsService.updateSiteSettings(dto.site ?? {}),
      );
      const oauth = dto.oauth;
      if (oauth) {
        await runStep('oauth', () =>
          this.settingsService.updateOAuthSettings(oauth),
        );
      }
      const passkey = dto.passkey;
      if (passkey) {
        await runStep('passkey', () =>
          this.settingsService.updatePasskeySettings(passkey),
        );
      }
      await runStep('auth', () =>
        this.authService.updateSettingsForSetup(this.authSettings(dto)),
      );
      await runStep('storage', () =>
        this.storageService.updateSettings(this.storageSettings(dto)),
      );
      await runStep('share', () =>
        this.workspacesService.updateShareSettings(
          'workspace-default',
          dto.sharePolicy,
        ),
      );
    } catch (error) {
      this.logger.warn(
        'Setup settings persistence failed after ' +
          lastCompletedStep +
          ' step',
      );
      throw error;
    }
  }

  private assertAuthenticationMethod(dto: CompleteSetupDto) {
    if (!dto.localEnabled && !dto.oauthEnabled && !dto.passkeyEnabled) {
      throw new BadRequestException(
        'At least one authentication method must be enabled',
      );
    }
  }

  private authSettings(dto: CompleteSetupDto) {
    return {
      localEnabled: dto.localEnabled,
      oauthEnabled: dto.oauthEnabled,
      passkeyEnabled: dto.passkeyEnabled,
    } satisfies UpdateAuthSettingsDto;
  }

  private storageSettings(dto: CompleteSetupDto) {
    return {
      ...(dto.storage ?? {}),
      distributedStorageEnabled: dto.distributedStorageEnabled,
    };
  }
}
