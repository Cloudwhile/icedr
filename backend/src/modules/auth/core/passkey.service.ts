import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt } from 'crypto';
import type { Request } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AdminGuardService } from '../../../common/security/admin-guard.service';
import { MailService } from '../../admin/mail/mail.service';
import { BootstrapStateService } from '../../admin/setup/bootstrap-state.service';
import {
  AUTH_UNAUTHORIZED_CODES,
  createAuthUnauthorizedError,
} from '../../../common/security/auth-unauthorized-error';
import { SettingsService } from '../../admin/settings/settings.service';
import { AuthAuditService } from './auth-audit.service';
import { AuthRepository } from './auth.repository';
import {
  PasskeyAuthenticationVerificationDto,
  PasskeyDeleteDto,
  PasskeyRecoveryCodeDto,
  PasskeyRecoveryCodeGenerateDto,
  PasskeyRenameDto,
  PasskeyRegistrationOptionsDto,
  PasskeyRegistrationVerificationDto,
  PasskeyStepUpPasswordDto,
  PasskeyStepUpVerificationDto,
  type PasskeyCeremonyResponse,
} from './passkey.dto';
import { detectPasskeyDeviceName } from './passkey-device';
import {
  PasskeyRepository,
  PasskeyStateConflictError,
} from './passkey.repository';
import { verifyPasswordHash } from './password-security';

const challengeTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const stepUpTtlMs = 5 * 60 * 1000;
const recoveryCodeCount = 10;
const recoveryCodeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);

  constructor(
    private readonly passkeyRepository: PasskeyRepository,
    private readonly authRepository: AuthRepository,
    private readonly settingsService: SettingsService,
    private readonly adminGuard: AdminGuardService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    private readonly auditService: AuthAuditService,
    private readonly bootstrapState: BootstrapStateService,
  ) {}

  async createAuthenticationOptions(
    request?: Request,
  ): Promise<PasskeyCeremonyResponse<PublicKeyCredentialRequestOptionsJSON>> {
    await this.requirePasskeyLoginEnabled();
    const passkey = await this.requirePasskeyConfigured();
    await this.passkeyRepository.assertRateLimit({
      action: 'passkey-authentication-options',
      scopeHash: this.requestScopeHash(request),
      limit: 20,
      windowSeconds: 60,
    });
    const options = await generateAuthenticationOptions({
      rpID: passkey.rpId,
      userVerification: 'required',
    });
    const ceremony = await this.passkeyRepository.createChallenge({
      flow: 'passkey-authentication',
      challenge: options.challenge,
      userId: null,
      expiresAt: new Date(Date.now() + challengeTtlMs).toISOString(),
    });
    return { ceremonyId: ceremony.id, expectedOrigin: passkey.origin, options };
  }

  async createRegistrationOptions(
    dto: PasskeyRegistrationOptionsDto,
    authorization?: string,
    request?: Request,
  ): Promise<PasskeyCeremonyResponse<PublicKeyCredentialCreationOptionsJSON>> {
    const session = await this.adminGuard.requireSession(authorization);
    const passkey = await this.requirePasskeyConfigured();
    await this.passkeyRepository.assertRateLimit({
      action: 'passkey-registration-options',
      scopeHash: this.requestScopeHash(request, session.user.id),
      limit: 10,
      windowSeconds: 60,
    });
    const stepUp = await this.passkeyRepository.findValidStepUpToken(
      this.passkeyRepository.hashOpaqueToken(dto.stepUpToken),
      session.user.id,
      session.tokenHash,
      'manage-authenticators',
    );
    if (!stepUp) {
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.REAUTH_REQUIRED,
      );
    }
    const existing = await this.passkeyRepository.listPasskeysForUser(
      session.user.id,
    );
    const options = await generateRegistrationOptions({
      rpName: passkey.rpName,
      rpID: passkey.rpId,
      userID: Buffer.from(session.user.id),
      userName: session.user.id,
      userDisplayName: session.user.displayName,
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      attestationType: 'none',
    });
    const ceremony = await this.passkeyRepository.createChallenge({
      flow: 'passkey-registration',
      challenge: options.challenge,
      userId: session.user.id,
      expiresAt: new Date(Date.now() + challengeTtlMs).toISOString(),
      stepUpTokenHash: stepUp.tokenHash,
    });
    return { ceremonyId: ceremony.id, expectedOrigin: passkey.origin, options };
  }

  async listPasskeys(authorization?: string) {
    const session = await this.adminGuard.requireSession(authorization);
    const passkeys = await this.passkeyRepository.listPasskeysForUser(
      session.user.id,
    );
    return passkeys.map((passkey) => this.toPasskeyResponse(passkey));
  }

  async renamePasskey(
    passkeyId: string,
    dto: PasskeyRenameDto,
    authorization?: string,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Passkey name is required');
    const renamed = await this.passkeyRepository.renamePasskey(
      session.user.id,
      passkeyId,
      name,
    );
    if (!renamed) {
      throw new BadRequestException({
        code: 'PASSKEY_NOT_FOUND',
        message: 'Passkey was not found',
      });
    }
    await this.auditService.recordSuccess(
      'auth.passkey_renamed',
      session.user,
      { method: 'passkey' },
    );
    const passkeys = await this.passkeyRepository.listPasskeysForUser(
      session.user.id,
    );
    return this.toPasskeyResponse(
      passkeys.find((passkey) => passkey.id === passkeyId)!,
    );
  }

  async deletePasskey(
    passkeyId: string,
    dto: PasskeyDeleteDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    const tokenHash = this.passkeyRepository.hashOpaqueToken(dto.stepUpToken);
    try {
      const deleted = await this.passkeyRepository.deletePasskey({
        userId: session.user.id,
        passkeyId,
        sessionTokenHash: session.tokenHash,
        stepUpTokenHash: tokenHash,
      });
      if (!deleted) {
        throw new BadRequestException({
          code: 'PASSKEY_NOT_FOUND',
          message: 'Passkey was not found',
        });
      }
    } catch (error) {
      if (error instanceof PasskeyStateConflictError) {
        if (error.message === 'Authentication method policy') {
          throw new BadRequestException({
            code: 'AUTH_METHOD_POLICY_REQUIRED',
            message:
              'This Passkey cannot be removed until another authentication method is available',
          });
        }
        throw createAuthUnauthorizedError(
          AUTH_UNAUTHORIZED_CODES.REAUTH_REQUIRED,
        );
      }
      throw error;
    }
    await this.auditService.recordSuccess(
      'auth.passkey_removed',
      session.user,
      {
        method: 'passkey',
        request,
      },
    );
    await this.notifySecurityEvent(session.user, {
      event: 'passkey-removed',
      request,
    });
    return { ok: true };
  }

  async getAuthenticationMethodStatus(authorization?: string) {
    const session = await this.adminGuard.requireSession(authorization);
    return this.passkeyRepository.getAuthenticationMethodStatus(
      session.user.id,
    );
  }

  async reauthenticateWithPassword(
    dto: PasskeyStepUpPasswordDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    await this.passkeyRepository.assertRateLimit({
      action: 'password-step-up-verification',
      scopeHash: this.requestScopeHash(request, session.user.id),
      limit: 5,
      windowSeconds: 300,
    });
    const passwordHash = await this.passkeyRepository.findLocalPasswordHash(
      session.user.id,
    );
    if (
      !passwordHash ||
      !(await verifyPasswordHash(dto.password, passwordHash))
    ) {
      await this.auditService.record(
        'auth.reauthentication_failed',
        session.user,
        {
          method: 'local',
          result: 'failure',
          request,
          metadata: { stage: 'password' },
        },
      );
      throw this.reauthenticationFailed();
    }
    return this.issueStepUpToken(session, 'password', request);
  }

  async createPasskeyStepUpOptions(
    authorization?: string,
    request?: Request,
  ): Promise<PasskeyCeremonyResponse<PublicKeyCredentialRequestOptionsJSON>> {
    const session = await this.adminGuard.requireSession(authorization);
    const passkey = await this.requirePasskeyConfigured();
    await this.passkeyRepository.assertRateLimit({
      action: 'passkey-step-up-options',
      scopeHash: this.requestScopeHash(request, session.user.id),
      limit: 10,
      windowSeconds: 60,
    });
    const credentials = await this.passkeyRepository.listPasskeysForUser(
      session.user.id,
    );
    if (credentials.length === 0) {
      throw new ForbiddenException({
        code: 'AUTH_REAUTH_METHOD_UNAVAILABLE',
        message: 'No Passkey is available for reauthentication',
      });
    }
    const options = await generateAuthenticationOptions({
      rpID: passkey.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.readTransports(credential.transports) as never,
      })),
      userVerification: 'required',
    });
    const ceremony = await this.passkeyRepository.createChallenge({
      flow: 'passkey-step-up',
      challenge: options.challenge,
      userId: session.user.id,
      expiresAt: new Date(Date.now() + challengeTtlMs).toISOString(),
    });
    return { ceremonyId: ceremony.id, expectedOrigin: passkey.origin, options };
  }

  async verifyPasskeyStepUp(
    dto: PasskeyStepUpVerificationDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    const passkey = await this.requirePasskeyConfigured();
    await this.passkeyRepository.assertRateLimit({
      action: 'passkey-step-up-verification',
      scopeHash: this.requestScopeHash(request, session.user.id),
      limit: 10,
      windowSeconds: 60,
    });
    const ceremony = await this.passkeyRepository.claimChallenge({
      ceremonyId: dto.ceremonyId,
      flow: 'passkey-step-up',
      userId: session.user.id,
    });
    if (!ceremony) throw this.ceremonyUnavailable();
    const response = dto.response as AuthenticationResponseJSON;
    const credential = await this.passkeyRepository.findPasskeyByCredentialId(
      response.id,
    );
    if (!credential || credential.userId !== session.user.id) {
      await this.failStepUpCeremony(
        ceremony,
        session.user,
        request,
        'credential',
      );
    }
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: passkey.origin,
        expectedRPID: passkey.rpId,
        credential: {
          id: credential!.credentialId,
          publicKey: Buffer.from(credential!.publicKey, 'base64url'),
          counter: Number(credential!.counter),
          transports: this.readTransports(credential!.transports) as never,
        },
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn(
        `Passkey step-up verification failed: ${this.errorName(error)}`,
      );
      await this.failStepUpCeremony(
        ceremony,
        session.user,
        request,
        'assertion',
      );
    }
    if (
      !verification!.verified ||
      !verification!.authenticationInfo.userVerified
    ) {
      await this.failStepUpCeremony(
        ceremony,
        session.user,
        request,
        'user-verification',
      );
    }

    const responseToken = this.createStepUpToken();
    try {
      await this.passkeyRepository.completeStepUpAuthentication({
        ceremonyId: ceremony.id,
        claimToken: ceremony.claimToken,
        credentialId: credential!.credentialId,
        counter: verification!.authenticationInfo.newCounter,
        userId: session.user.id,
        tokenHash: this.passkeyRepository.hashOpaqueToken(responseToken.token),
        sessionTokenHash: session.tokenHash,
        purpose: 'manage-authenticators',
        expiresAt: responseToken.expiresAt,
        lastUsedIpHash: this.requestIpHash(request),
        lastUsedUserAgent: this.requestUserAgent(request),
      });
    } catch (error) {
      if (error instanceof PasskeyStateConflictError) {
        throw this.ceremonyUnavailable();
      }
      throw error;
    }
    await this.auditService.recordSuccess(
      'auth.reauthentication_succeeded',
      session.user,
      { method: 'passkey', request },
    );
    return { ...responseToken, method: 'passkey' as const };
  }

  async reauthenticateWithRecoveryCode(
    dto: PasskeyRecoveryCodeDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    await this.passkeyRepository.assertRateLimit({
      action: 'recovery-code-step-up-verification',
      scopeHash: this.requestScopeHash(request, session.user.id),
      limit: 5,
      windowSeconds: 300,
    });
    const responseToken = this.createStepUpToken();
    const consumed = await this.passkeyRepository.consumeRecoveryCodeForStepUp({
      codeHash: this.hashRecoveryCode(dto.code),
      userId: session.user.id,
      tokenHash: this.passkeyRepository.hashOpaqueToken(responseToken.token),
      sessionTokenHash: session.tokenHash,
      expiresAt: responseToken.expiresAt,
    });
    if (!consumed) {
      await this.auditService.record(
        'auth.reauthentication_failed',
        session.user,
        {
          method: 'recovery',
          result: 'failure',
          request,
          metadata: { stage: 'recovery-code' },
        },
      );
      throw this.reauthenticationFailed();
    }
    await this.auditService.recordSuccess(
      'auth.reauthentication_succeeded',
      session.user,
      { method: 'recovery', request },
    );
    await this.auditService.recordSuccess(
      'auth.recovery_code_used',
      session.user,
      { method: 'recovery', request },
    );
    return { ...responseToken, method: 'recovery' as const };
  }

  async generateRecoveryCodes(
    dto: PasskeyRecoveryCodeGenerateDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    const codes = Array.from({ length: recoveryCodeCount }, () =>
      this.createRecoveryCode(),
    );
    const batchId = `recovery_${randomBytes(12).toString('base64url')}`;
    try {
      await this.passkeyRepository.replaceRecoveryCodes({
        userId: session.user.id,
        sessionTokenHash: session.tokenHash,
        stepUpTokenHash: this.passkeyRepository.hashOpaqueToken(
          dto.stepUpToken,
        ),
        codes: codes.map((code) => ({
          id: `recovery_code_${randomBytes(12).toString('base64url')}`,
          batchId,
          codeHash: this.hashRecoveryCode(code),
        })),
      });
    } catch (error) {
      if (error instanceof PasskeyStateConflictError) {
        throw createAuthUnauthorizedError(
          AUTH_UNAUTHORIZED_CODES.REAUTH_REQUIRED,
        );
      }
      throw error;
    }
    await this.auditService.recordSuccess(
      'auth.recovery_codes_generated',
      session.user,
      { method: 'recovery', request },
    );
    return {
      codes,
      count: codes.length,
      generatedAt: new Date().toISOString(),
    };
  }

  async verifyAuthentication(
    dto: PasskeyAuthenticationVerificationDto,
    request?: Request,
  ) {
    await this.requirePasskeyLoginEnabled();
    const passkey = await this.requirePasskeyConfigured();
    await this.passkeyRepository.assertRateLimit({
      action: 'passkey-authentication-verification',
      scopeHash: this.requestScopeHash(request),
      limit: 10,
      windowSeconds: 60,
    });
    const ceremony = await this.passkeyRepository.claimChallenge({
      ceremonyId: dto.ceremonyId,
      flow: 'passkey-authentication',
    });
    if (!ceremony) throw this.ceremonyUnavailable();

    const response = dto.response as AuthenticationResponseJSON;
    const credential = await this.passkeyRepository.findPasskeyByCredentialId(
      response.id,
    );
    if (!credential) {
      await this.failClaimedCeremony(ceremony, null, request, 'credential');
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: passkey.origin,
        expectedRPID: passkey.rpId,
        credential: {
          id: credential!.credentialId,
          publicKey: Buffer.from(credential!.publicKey, 'base64url'),
          counter: Number(credential!.counter),
          transports: this.readTransports(credential!.transports) as never,
        },
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn(
        `Passkey authentication verification failed: ${this.errorName(error)}`,
      );
      await this.failClaimedCeremony(
        ceremony,
        credential!.userId,
        request,
        'assertion',
      );
    }
    if (
      !verification!.verified ||
      !verification!.authenticationInfo.userVerified
    ) {
      await this.failClaimedCeremony(
        ceremony,
        credential!.userId,
        request,
        'user-verification',
      );
    }

    const token = this.createToken('sess');
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    try {
      const completed = await this.passkeyRepository.completeAuthentication({
        ceremonyId: ceremony.id,
        claimToken: ceremony.claimToken,
        credentialId: credential!.credentialId,
        counter: verification!.authenticationInfo.newCounter,
        sessionTokenHash: this.passkeyRepository.hashOpaqueToken(token),
        sessionExpiresAt: expiresAt,
        lastUsedIpHash: this.requestIpHash(request),
        lastUsedUserAgent: this.requestUserAgent(request),
      });
      const user = await this.authRepository.findUserById(completed.userId);
      if (!user) throw this.verificationFailed();
      await this.auditService.recordSuccess('auth.login', user, {
        method: 'passkey',
        request,
      });
      await this.notifySecurityEvent(user, {
        event: 'login',
        request,
      });
      return { token, expiresAt, user };
    } catch (error) {
      if (error instanceof PasskeyStateConflictError) {
        throw this.ceremonyUnavailable();
      }
      throw error;
    }
  }

  async verifyRegistration(
    dto: PasskeyRegistrationVerificationDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.adminGuard.requireSession(authorization);
    const passkey = await this.requirePasskeyConfigured();
    await this.passkeyRepository.assertRateLimit({
      action: 'passkey-registration-verification',
      scopeHash: this.requestScopeHash(request, session.user.id),
      limit: 10,
      windowSeconds: 60,
    });
    const ceremony = await this.passkeyRepository.claimChallenge({
      ceremonyId: dto.ceremonyId,
      flow: 'passkey-registration',
      userId: session.user.id,
    });
    if (!ceremony) throw this.ceremonyUnavailable();
    const stepUpTokenHash = ceremony.metadata.stepUpTokenHash;
    if (typeof stepUpTokenHash !== 'string' || !stepUpTokenHash) {
      return this.failClaimedCeremony(
        ceremony,
        session.user.id,
        request,
        'step-up',
      );
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.response as RegistrationResponseJSON,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: passkey.origin,
        expectedRPID: passkey.rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn(
        `Passkey registration verification failed: ${this.errorName(error)}`,
      );
      return this.failClaimedCeremony(
        ceremony,
        session.user.id,
        request,
        'attestation',
      );
    }
    if (
      !verification!.verified ||
      !verification.registrationInfo ||
      !verification.registrationInfo.userVerified
    ) {
      return this.failClaimedCeremony(
        ceremony,
        session.user.id,
        request,
        'user-verification',
      );
    }

    const info = verification.registrationInfo;
    const deviceName =
      dto.name?.trim() ||
      detectPasskeyDeviceName(this.requestUserAgent(request));
    try {
      const created = await this.passkeyRepository.completeRegistration({
        ceremonyId: ceremony.id,
        claimToken: ceremony.claimToken,
        userId: session.user.id,
        sessionTokenHash: session.tokenHash,
        stepUpTokenHash,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: deviceName,
        aaguid: info.aaguid,
        createdIpHash: this.requestIpHash(request),
        createdUserAgent: this.requestUserAgent(request),
      });
      await this.auditService.recordSuccess(
        'auth.passkey_added',
        session.user,
        {
          method: 'passkey',
          request,
        },
      );
      await this.notifySecurityEvent(session.user, {
        event: 'passkey-added',
        request,
        deviceName,
      });
      return this.toPasskeyResponse(created);
    } catch (error) {
      if (error instanceof PasskeyStateConflictError) {
        throw createAuthUnauthorizedError(
          AUTH_UNAUTHORIZED_CODES.REAUTH_REQUIRED,
        );
      }
      throw error;
    }
  }

  private async requirePasskeyLoginEnabled() {
    await this.bootstrapState.requireCompleted();
    const settings = await this.authRepository.getSettings();
    if (!settings.passkeyEnabled) {
      throw new ForbiddenException('Passkey login is disabled');
    }
  }

  private async requirePasskeyConfigured() {
    const passkey = await this.settingsService.getPasskeySettings();
    if (!this.settingsService.passkeyConfigured(passkey)) {
      throw new ServiceUnavailableException('Passkey is not configured');
    }
    return passkey;
  }

  private requestScopeHash(request?: Request, userId?: string) {
    return createHmac('sha256', this.securitySecret)
      .update(`${userId ?? 'anonymous'}:${this.requestIp(request)}`)
      .digest('hex');
  }

  private requestIp(request?: Request) {
    return (
      request?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request?.get('x-real-ip') ||
      request?.ip ||
      request?.socket.remoteAddress ||
      'unknown'
    );
  }

  private requestIpHash(request?: Request) {
    return createHmac('sha256', this.securitySecret)
      .update(this.requestIp(request))
      .digest('hex');
  }

  private requestUserAgent(request?: Request) {
    return request?.get('user-agent')?.trim() || null;
  }

  private async failClaimedCeremony(
    ceremony: { id: string; claimToken: string },
    userId: string | null,
    request: Request | undefined,
    stage: string,
  ): Promise<never> {
    await this.passkeyRepository.recordChallengeFailure(
      ceremony.id,
      ceremony.claimToken,
    );
    const user = userId ? await this.authRepository.findUserById(userId) : null;
    await this.auditService.record('auth.login_failed', user, {
      method: 'passkey',
      result: 'failure',
      request,
      metadata: { stage },
    });
    throw this.verificationFailed();
  }

  private async failStepUpCeremony(
    ceremony: { id: string; claimToken: string },
    user: {
      id: string;
      email: string;
      displayName: string;
      role: 'admin' | 'member';
      avatarUrl: string | null;
      locale: string | null;
      theme: string | null;
      timezone: string | null;
      createdAt: string;
    },
    request: Request | undefined,
    stage: string,
  ): Promise<never> {
    await this.passkeyRepository.recordChallengeFailure(
      ceremony.id,
      ceremony.claimToken,
    );
    await this.auditService.record('auth.reauthentication_failed', user, {
      method: 'passkey',
      result: 'failure',
      request,
      metadata: { stage },
    });
    throw this.reauthenticationFailed();
  }

  private async issueStepUpToken(
    session: {
      tokenHash: string;
      user: {
        id: string;
        email: string;
        displayName: string;
        role: 'admin' | 'member';
        avatarUrl: string | null;
        locale: string | null;
        theme: string | null;
        timezone: string | null;
        createdAt: string;
      };
    },
    method: 'password' | 'oauth' | 'recovery',
    request?: Request,
  ) {
    const response = this.createStepUpToken();
    await this.passkeyRepository.createStepUpToken({
      tokenHash: this.passkeyRepository.hashOpaqueToken(response.token),
      userId: session.user.id,
      sessionTokenHash: session.tokenHash,
      method,
      purpose: 'manage-authenticators',
      expiresAt: response.expiresAt,
    });
    await this.auditService.recordSuccess(
      'auth.reauthentication_succeeded',
      session.user,
      {
        method: method === 'password' ? 'local' : method,
        request,
      },
    );
    return { ...response, method };
  }

  private createStepUpToken() {
    return {
      token: this.createToken('stepup'),
      expiresAt: new Date(Date.now() + stepUpTtlMs).toISOString(),
    };
  }

  private createRecoveryCode() {
    const raw = Array.from(
      { length: 16 },
      () => recoveryCodeAlphabet[randomInt(recoveryCodeAlphabet.length)],
    ).join('');
    return raw.match(/.{1,4}/g)?.join('-') ?? raw;
  }

  private hashRecoveryCode(code: string) {
    const normalized = code.trim().toUpperCase().replaceAll('-', '');
    return createHmac('sha256', this.securitySecret)
      .update(`recovery-code:${normalized}`)
      .digest('hex');
  }

  private reauthenticationFailed() {
    return new UnauthorizedException({
      code: 'AUTH_REAUTH_FAILED',
      message: 'Reauthentication failed',
    });
  }

  private verificationFailed() {
    return new UnauthorizedException({
      code: 'PASSKEY_VERIFICATION_FAILED',
      message: 'Passkey verification failed',
    });
  }

  private ceremonyUnavailable() {
    return new UnauthorizedException({
      code: 'PASSKEY_CEREMONY_UNAVAILABLE',
      message: 'Passkey ceremony expired or is already in use',
    });
  }

  private toPasskeyResponse(passkey: {
    id: string;
    name: string;
    transports: unknown;
    deviceType: string;
    backedUp: boolean;
    aaguid: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    createdUserAgent: string | null;
  }) {
    return {
      id: passkey.id,
      name: passkey.name,
      transports: this.readTransports(passkey.transports),
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      aaguid: passkey.aaguid,
      createdAt: passkey.createdAt.toISOString(),
      lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
      deviceName: detectPasskeyDeviceName(passkey.createdUserAgent),
    };
  }

  private readTransports(value: unknown) {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private createToken(prefix: string) {
    return `${prefix}_${randomBytes(32).toString('base64url')}`;
  }

  private async notifySecurityEvent(
    user: { email: string; locale: string | null },
    input: {
      event: 'login' | 'passkey-added' | 'passkey-removed';
      request?: Request;
      deviceName?: string;
    },
  ) {
    try {
      await this.mailService.sendSecurityNotification({
        email: user.email,
        event: input.event,
        locale: user.locale === 'zh' ? 'zh' : 'en',
        occurredAt: new Date().toISOString(),
        deviceName:
          input.deviceName ||
          detectPasskeyDeviceName(this.requestUserAgent(input.request)),
        ipAddress: this.requestIp(input.request),
      });
    } catch (error) {
      this.logger.warn(
        `Security notification delivery failed: ${this.errorName(error)}`,
      );
    }
  }

  private errorName(error: unknown) {
    return error instanceof Error ? error.name : 'unknown';
  }

  private get securitySecret() {
    return (
      this.config.get<string>('auth.securitySecret')?.trim() ||
      'icedr-dev-auth-security-secret'
    );
  }
}
