import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { MailService } from '../../admin/mail/mail.service';
import { BootstrapStateService } from '../../admin/setup/bootstrap-state.service';
import {
  AUTH_UNAUTHORIZED_CODES,
  createAuthUnauthorizedError,
} from '../../../common/security/auth-unauthorized-error';
import { SettingsService } from '../../admin/settings/settings.service';
import type {
  OAuthSettings,
  PasskeySettings,
} from '../../admin/settings/settings.dto';
import {
  AuthSessionResponse,
  AuthSettings,
  AuthSettingsResponse,
  AuthUserResponse,
  LoginDto,
  OAuthExchangeDto,
  OAuthExchangeResponse,
  OAuthFrontendCallbackResponse,
  OAuthStartResponse,
  PasswordResetConfirmDto,
  PasswordResetConfirmResponse,
  PasswordResetRequestDto,
  PasswordResetRequestResponse,
  PasswordResetVerifyDto,
  PasswordResetVerifyResponse,
  RegisterDto,
  UpdateAuthSettingsDto,
  UpdateCurrentUserDto,
} from './auth.dto';
import { AuthRepository, StoredAuthUser } from './auth.repository';
import {
  createOAuthProviderAdapter,
  createOAuthRequestState,
  type OAuthProviderSnapshot,
} from '../../../extensions/oauth/oauth-provider-adapters';
import { AuthAuditService, type AuthAuditMethod } from './auth-audit.service';
import { hashPassword, verifyPasswordHash } from './password-security';
import { PasskeyOAuthStepUpExchangeDto } from './passkey.dto';
import { getOAuthIdentityProvider } from '../../../extensions/oauth/oauth-provider-identity';
import { validateAuthMethodConfiguration } from './auth-settings-policy';
import {
  assertOAuthCallbackTarget,
  assertOAuthUserPolicy,
  createOAuthProviderSnapshot,
  oauthProviderSnapshotMatchesSettings,
  requireOAuthFlowToken,
} from './oauth-flow-policy';

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const resetTtlMs = 15 * 60 * 1000;
const resetTtlMinutes = resetTtlMs / 60 / 1000;
const resetCodeLength = 6;
const resetCodeMaxAttempts = 5;
const resetCodeAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const oauthStateTtlMs = 10 * 60 * 1000;
const oauthExchangeTtlMs = 2 * 60 * 1000;
const invalidCredentialsCode = 'AUTH_INVALID_CREDENTIALS';
const setupAdminEmailOccupiedCode = 'SETUP_ADMIN_EMAIL_OCCUPIED';
const invalidCredentialsPasswordHash =
  'scrypt$icedr-auth-invalid$5m3ozKIOc8ztEI2scnbBUoChYL6g8J2r8wIcRIgbsUSqFB3aJyC9v6VmxtTqUsoUxNQqR5Fe61bLEJO55CpWPA';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly settingsService: SettingsService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    private readonly authAuditService: AuthAuditService,
    private readonly bootstrapState: BootstrapStateService,
  ) {}

  async getSettings(): Promise<AuthSettingsResponse> {
    await this.bootstrapState.requireCompleted();
    const settings = await this.authRepository.getSettings();
    return this.withConfigState(settings);
  }

  async updateSettings(
    dto: UpdateAuthSettingsDto,
    authorization?: string,
  ): Promise<AuthSettingsResponse> {
    const admin = await this.requireAdminSession(authorization);
    return this.persistAuthSettings(dto, admin.user.id);
  }

  async updateSettingsForSetup(
    dto: UpdateAuthSettingsDto,
  ): Promise<AuthSettingsResponse> {
    if (await this.settingsService.bootstrapCompleted()) {
      throw new ForbiddenException('Setup has already been completed');
    }
    await this.validateSettingsForSetup(dto);
    return this.persistAuthSettings(dto);
  }

  async validateSettings(
    dto: UpdateAuthSettingsDto,
    candidates: {
      oauth?: OAuthSettings;
      passkey?: PasskeySettings;
    } = {},
  ) {
    return this.prepareAuthSettings(dto, candidates);
  }

  async validateSettingsForSetup(
    dto: UpdateAuthSettingsDto,
    candidates: {
      oauth?: OAuthSettings;
      passkey?: PasskeySettings;
    } = {},
  ) {
    if (await this.settingsService.bootstrapCompleted()) {
      throw new ForbiddenException('Setup has already been completed');
    }
    const settings = await this.prepareAuthSettings(dto, candidates);
    if (!settings.localEnabled)
      throw new BadRequestException({
        code: 'AUTH_LAST_LOGIN_METHOD',
        message:
          'Keep password login enabled until the administrator has enrolled another login method',
      });
  }

  private async persistAuthSettings(
    dto: UpdateAuthSettingsDto,
    actorUserId?: string,
  ): Promise<AuthSettingsResponse> {
    const next = await this.prepareAuthSettings(dto);
    return this.withConfigState(
      await this.authRepository.updateSettings(next, actorUserId),
    );
  }

  private async prepareAuthSettings(
    dto: UpdateAuthSettingsDto,
    candidates: {
      oauth?: OAuthSettings;
      passkey?: PasskeySettings;
    } = {},
  ) {
    const current = await this.authRepository.getSettings();
    const next: AuthSettings = {
      ...current,
      ...dto,
      updatedAt: new Date().toISOString(),
    };
    await validateAuthMethodConfiguration(
      next,
      this.settingsService,
      candidates,
    );
    return next;
  }

  async register(
    dto: RegisterDto,
    request?: Request,
  ): Promise<AuthSessionResponse> {
    await this.assertLocalAuthEnabled();
    const email = this.normalizeEmail(dto.email);
    const displayName = dto.displayName.trim();
    if (!displayName) throw new BadRequestException('Display name is required');

    const existing = await this.authRepository.findUserByEmail(email);
    if (existing) throw new ConflictException('Email is already registered');

    const user = await this.authRepository.createUser({
      email,
      displayName,
      passwordHash: await this.hashPassword(dto.password),
      role: 'member',
    });
    const session = await this.createSession(user);
    await this.recordAuthAudit('auth.registered', session.user, {
      method: 'local',
      request,
    });
    return session;
  }

  async createSetupAdmin(
    dto: RegisterDto,
    request?: Request,
  ): Promise<AuthSessionResponse> {
    const email = this.normalizeEmail(dto.email);
    const displayName = dto.displayName.trim();
    if (!displayName) throw new BadRequestException('Display name is required');
    const existing = await this.resolveSetupAdmin(email);
    const user = existing
      ? await this.promoteExistingSetupAdmin(
          existing,
          dto.password,
          displayName,
        )
      : await this.authRepository.createUser({
          email,
          displayName,
          passwordHash: await this.hashPassword(dto.password),
          role: 'admin',
        });
    const session = await this.createSession(user);
    await this.recordAuthAudit('auth.registered', session.user, {
      method: 'setup',
      request,
    });
    return session;
  }

  async validateSetupAdmin(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);
    const displayName = dto.displayName.trim();
    if (!displayName) throw new BadRequestException('Display name is required');
    const existing = await this.resolveSetupAdmin(email);
    if (
      existing &&
      !(await this.verifyPassword(dto.password, existing.passwordHash))
    ) {
      throw new UnauthorizedException(
        'Existing administrator password does not match',
      );
    }
  }

  async login(dto: LoginDto, request?: Request): Promise<AuthSessionResponse> {
    await this.assertLocalAuthEnabled();
    const user = await this.authRepository.findUserByEmail(
      this.normalizeEmail(dto.email),
    );

    if (!user) {
      await this.verifyPassword(dto.password, invalidCredentialsPasswordHash);
      await this.authAuditService.record('auth.login_failed', null, {
        method: 'local',
        result: 'failure',
        request,
        metadata: { stage: 'credentials' },
      });
      throw this.invalidCredentialsException();
    }

    if (!(await this.verifyPassword(dto.password, user.passwordHash))) {
      await this.authAuditService.record('auth.login_failed', user, {
        method: 'local',
        result: 'failure',
        request,
        metadata: { stage: 'credentials' },
      });
      throw this.invalidCredentialsException();
    }

    const session = await this.createSession(user);
    await this.recordAuthAudit('auth.login', session.user, {
      method: 'local',
      request,
    });
    await this.notifyLogin(session.user, request);
    return session;
  }

  async logout(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (token) {
      await this.authRepository.deleteSessionByTokenHash(this.hashToken(token));
    }
    return { ok: true };
  }

  async getCurrentUser(authorization?: string): Promise<AuthUserResponse> {
    return (await this.requireSession(authorization)).user;
  }

  async updateCurrentUser(
    dto: UpdateCurrentUserDto,
    authorization?: string,
  ): Promise<AuthUserResponse> {
    const session = await this.requireSession(authorization);
    const displayName = dto.displayName?.trim();
    if (dto.displayName !== undefined && !displayName) {
      throw new BadRequestException('Display name is required');
    }

    return this.authRepository.updateUserProfile(session.user.id, {
      avatarUrl:
        dto.avatarUrl === undefined
          ? undefined
          : dto.avatarUrl?.trim()
            ? dto.avatarUrl.trim()
            : null,
      displayName,
      locale: this.normalizeNullableString(dto.locale),
      theme: this.normalizeNullableString(dto.theme),
      timezone: this.normalizeNullableString(dto.timezone),
    });
  }

  async requireAdminSession(authorization?: string) {
    const session = await this.requireSession(authorization);
    if (session.user.role !== 'admin') {
      throw new ForbiddenException('Administrator access is required');
    }
    return session;
  }

  async requestPasswordReset(
    dto: PasswordResetRequestDto,
  ): Promise<PasswordResetRequestResponse> {
    await this.assertLocalAuthEnabled();
    const email = this.normalizeEmail(dto.email);
    const expiresAt = new Date(Date.now() + resetTtlMs).toISOString();
    const user = await this.authRepository.findUserByEmail(email);

    if (user) {
      const code = this.createPasswordResetCode();
      await this.authRepository.createPasswordReset({
        tokenHash: this.hashPasswordResetCode(user.id, code),
        userId: user.id,
        expiresAt,
      });
      try {
        await this.mailService.sendPasswordReset({
          email,
          code,
          expiresAt,
          expiresInMinutes: resetTtlMinutes,
          locale: this.resolvePasswordResetLocale(user.locale, dto.locale),
        });
      } catch (error) {
        this.logger.warn(
          `Password reset mail failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return {
      configured: true,
      delivery: 'email',
      expiresAt,
    };
  }

  async confirmPasswordReset(
    dto: PasswordResetConfirmDto,
    request?: Request,
  ): Promise<PasswordResetConfirmResponse> {
    await this.assertLocalAuthEnabled();
    const reset = await this.validatePasswordResetCode(dto);

    const updatedUser = await this.authRepository.updateUserPassword(
      reset.user.id,
      await this.hashPassword(dto.password),
    );
    await this.authRepository.markPasswordResetUsed(reset.tokenHash);
    await this.authRepository.deleteSessionsForUser(updatedUser.id);
    const session = await this.createSession(updatedUser);
    await this.recordAuthAudit('auth.password_reset_completed', session.user, {
      method: 'local',
      request,
    });
    return session;
  }

  async verifyPasswordReset(
    dto: PasswordResetVerifyDto,
  ): Promise<PasswordResetVerifyResponse> {
    await this.assertLocalAuthEnabled();
    const reset = await this.validatePasswordResetCode(dto);
    return {
      verified: true,
      expiresAt: reset.expiresAt,
    };
  }

  async startOAuthLogin(
    providerId?: string,
    flowToken?: string,
  ): Promise<OAuthStartResponse> {
    await this.bootstrapState.requireCompleted();
    const settings = await this.authRepository.getSettings();
    if (!settings.oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    return this.createOAuthStart(providerId, {
      flow: 'login',
      userId: null,
      sessionTokenHash: this.hashToken(requireOAuthFlowToken(flowToken)),
      purpose: null,
    });
  }

  async startOAuthStepUp(
    providerId?: string,
    authorization?: string,
  ): Promise<OAuthStartResponse> {
    const session = await this.requireSession(authorization);
    const settings = await this.authRepository.getSettings();
    if (!settings.oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    const linked = await this.authRepository.listOAuthIdentityProviders(
      session.user.id,
    );
    const providers = await this.settingsService.getOAuthProviderSettings();
    const provider = providers.find(
      (item) =>
        (!providerId || item.id === providerId) &&
        this.settingsService.oauthConfigured(item) &&
        linked.includes(getOAuthIdentityProvider(item)),
    );
    if (!provider)
      throw new ForbiddenException({
        code: 'AUTH_REAUTH_METHOD_UNAVAILABLE',
        message: 'No linked OAuth provider is available for reauthentication',
      });
    return this.createOAuthStart(provider.id, {
      flow: 'step-up',
      userId: session.user.id,
      sessionTokenHash: session.tokenHash,
      purpose: 'manage-authenticators',
    });
  }

  async handleOAuthCallback(
    currentUrl: string,
    browserFlow?: { flowToken?: string },
  ) {
    await this.bootstrapState.requireCompleted();
    if (!(await this.authRepository.getSettings()).oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    const url = new URL(currentUrl);
    const state = url.searchParams.get('state');
    if (!state) throw new UnauthorizedException('OAuth state is required');
    const storedState = await this.authRepository.findOAuthState(state);
    if (
      !storedState ||
      storedState.usedAt ||
      new Date(storedState.expiresAt).getTime() < Date.now()
    ) {
      throw new UnauthorizedException('OAuth state is invalid');
    }
    if (storedState.flow !== 'login' && storedState.flow !== 'step-up') {
      throw new UnauthorizedException('OAuth state flow is invalid');
    }
    if (
      browserFlow &&
      storedState.flow === 'login' &&
      this.hashToken(requireOAuthFlowToken(browserFlow.flowToken)) !==
        storedState.sessionTokenHash
    ) {
      throw new UnauthorizedException('OAuth browser flow does not match');
    }

    const oauth = await this.resolveOAuthStateProvider(
      storedState.providerSnapshot,
      storedState.redirectUri,
    );
    assertOAuthCallbackTarget(url, storedState.redirectUri);
    const claimed = await this.authRepository.markOAuthStateUsed(state);
    if (!claimed) {
      throw new UnauthorizedException('OAuth state is invalid');
    }
    const oauthAdapter = this.createOAuthProviderAdapter(oauth);
    const oauthUser = await oauthAdapter.exchangeCode({
      oauth,
      redirectUri: storedState.redirectUri,
      url,
      state,
      codeVerifier: storedState.codeVerifier,
      reauthenticate: storedState.flow === 'step-up',
    });

    assertOAuthUserPolicy(oauth, oauthUser);
    let user = await this.authRepository.findUserByProviderIdentity(
      oauthUser.provider,
      oauthUser.subject,
    );
    if (storedState.flow === 'step-up') {
      if (!user || user.id !== storedState.userId) {
        throw new UnauthorizedException(
          'OAuth reauthentication identity does not match the current account',
        );
      }
      const exchangeCode = this.createToken('oauth_stepup');
      await this.authRepository.createOAuthExchangeCode({
        codeHash: this.hashToken(exchangeCode),
        userId: user.id,
        flow: 'step-up',
        sessionTokenHash: storedState.sessionTokenHash,
        purpose: storedState.purpose,
        expiresAt: new Date(Date.now() + oauthExchangeTtlMs).toISOString(),
      });
      return {
        flow: 'step-up' as const,
        code: exchangeCode,
        user: this.toUserResponse(user),
      };
    }
    if (!user) {
      const normalizedEmail = this.normalizeEmail(oauthUser.email);
      const existingUser =
        oauthUser.emailSource === 'provider'
          ? await this.authRepository.findUserByEmail(normalizedEmail)
          : null;
      if (existingUser) {
        if (!oauth.linkByVerifiedEmail || !oauthUser.emailVerified) {
          throw new ConflictException(
            'An account already exists for this email and automatic linking is not allowed',
          );
        }
        user = await this.authRepository.linkOAuthIdentity({
          userId: existingUser.id,
          provider: oauthUser.provider,
          subject: oauthUser.subject,
          emailSource: oauthUser.emailSource,
        });
      } else {
        if (oauth.allowSignup === false) {
          throw new ForbiddenException(
            'OAuth account provisioning is disabled',
          );
        }
        user = await this.authRepository.createOAuthUser({
          provider: oauthUser.provider,
          subject: oauthUser.subject,
          email: normalizedEmail,
          emailSource: oauthUser.emailSource,
          displayName: oauthUser.displayName,
        });
      }
    }
    const userResponse = this.toUserResponse(user);

    const exchangeCode = this.createToken('oauth');
    await this.authRepository.createOAuthExchangeCode({
      codeHash: this.hashToken(exchangeCode),
      userId: user.id,
      sessionTokenHash: storedState.sessionTokenHash,
      expiresAt: new Date(Date.now() + oauthExchangeTtlMs).toISOString(),
    });
    return {
      flow: 'login' as const,
      code: exchangeCode,
      user: userResponse,
    };
  }

  async exchangeOAuthStepUpCode(
    dto: PasskeyOAuthStepUpExchangeDto,
    authorization?: string,
    request?: Request,
  ) {
    const session = await this.requireSession(authorization);
    if (!(await this.authRepository.getSettings()).oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    const token = this.createToken('stepup');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const consumed = await this.authRepository.consumeOAuthStepUpExchangeCode({
      codeHash: this.hashToken(dto.code),
      userId: session.user.id,
      sessionTokenHash: session.tokenHash,
      stepUpTokenHash: this.hashToken(token),
      stepUpExpiresAt: expiresAt,
    });
    if (!consumed) {
      await this.authAuditService.record(
        'auth.reauthentication_failed',
        session.user,
        {
          method: 'oauth',
          result: 'failure',
          request,
          metadata: { stage: 'oauth-exchange' },
        },
      );
      throw new UnauthorizedException({
        code: 'AUTH_REAUTH_FAILED',
        message: 'OAuth reauthentication failed',
      });
    }
    await this.authAuditService.recordSuccess(
      'auth.reauthentication_succeeded',
      session.user,
      { method: 'oauth', request },
    );
    return { token, expiresAt, method: 'oauth' as const };
  }

  async completeFrontendOAuthCallback(
    callbackUrl: string,
    request?: Request,
    flowToken?: string,
  ): Promise<OAuthFrontendCallbackResponse> {
    const result = await this.handleOAuthCallback(callbackUrl, { flowToken });
    if (result.flow === 'step-up') {
      return { flow: result.flow, code: result.code };
    }
    return this.exchangeOAuthCode(
      { code: result.code, flowToken: requireOAuthFlowToken(flowToken) },
      request,
    );
  }

  async exchangeOAuthCode(
    dto: OAuthExchangeDto,
    request?: Request,
  ): Promise<OAuthExchangeResponse> {
    await this.bootstrapState.requireCompleted();
    if (!(await this.authRepository.getSettings()).oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    const codeHash = this.hashToken(dto.code);
    const token = this.createToken('sess');
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    const code = await this.authRepository.consumeOAuthLoginExchangeCode(
      codeHash,
      this.hashToken(requireOAuthFlowToken(dto.flowToken)),
      { tokenHash: this.hashToken(token), expiresAt },
    );
    if (!code) {
      throw new UnauthorizedException('OAuth exchange code is invalid');
    }
    const user = await this.authRepository.findUserById(code.userId);
    if (!user) throw new UnauthorizedException('OAuth user is unavailable');
    const session = { token, expiresAt, user: this.toUserResponse(user) };
    await this.recordAuthAudit('auth.login', session.user, {
      method: 'oauth',
      request,
    });
    await this.notifyLogin(session.user, request);
    return session;
  }

  buildOAuthFrontendCallbackUrl(
    code: string,
    flow: 'login' | 'step-up' = 'login',
  ) {
    const origin =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    const url = new URL(
      flow === 'step-up' ? '/settings' : '/login',
      origin.replace(/\/$/, ''),
    );
    url.searchParams.set(
      flow === 'step-up' ? 'oauthStepUpCode' : 'oauthCode',
      code,
    );
    if (flow === 'step-up') url.searchParams.set('tab', 'security');
    return url.toString();
  }

  private async createOAuthStart(
    providerId?: string,
    binding?: {
      flow: 'login' | 'step-up';
      userId: string | null;
      sessionTokenHash: string;
      purpose: string | null;
    },
  ): Promise<OAuthStartResponse> {
    const settings = await this.authRepository.getSettings();
    if (!settings.oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    const oauth = await this.settingsService.getOAuthSettings(providerId);
    if (!this.settingsService.oauthConfigured(oauth)) {
      throw new ServiceUnavailableException('OAuth is not configured');
    }
    const { codeChallenge, codeVerifier, state } =
      await createOAuthRequestState();
    const redirectUri = this.resolveOAuthRedirectUri(oauth);
    const authorizationUrl = await this.createOAuthProviderAdapter(
      oauth,
    ).buildAuthorizationUrl({
      oauth,
      redirectUri,
      state,
      codeChallenge,
      reauthenticate: binding?.flow === 'step-up',
    });
    await this.authRepository.createOAuthState({
      state,
      flow: binding?.flow ?? 'login',
      shareToken: null,
      userId: binding?.userId ?? null,
      sessionTokenHash: binding?.sessionTokenHash ?? null,
      purpose: binding?.purpose ?? null,
      codeVerifier,
      redirectUri,
      providerSnapshot: createOAuthProviderSnapshot(oauth, redirectUri),
      expiresAt: new Date(Date.now() + oauthStateTtlMs).toISOString(),
    });
    return { authorizationUrl: authorizationUrl.toString() };
  }

  private async promoteExistingSetupAdmin(
    existing: StoredAuthUser,
    password: string,
    displayName: string,
  ) {
    if (!(await this.verifyPassword(password, existing.passwordHash))) {
      throw new UnauthorizedException(
        'Existing administrator password does not match',
      );
    }
    return this.authRepository.promoteLocalUser({
      userId: existing.id,
      email: existing.email,
      displayName,
      role: 'admin',
    });
  }

  private createOAuthProviderAdapter(oauth: OAuthSettings) {
    return createOAuthProviderAdapter(oauth, {
      production: this.production,
    });
  }

  private async resolveOAuthStateProvider(
    providerSnapshot: OAuthProviderSnapshot | null,
    redirectUri: string,
  ): Promise<OAuthSettings> {
    const currentSettings = await this.settingsService.getOAuthSettings(
      providerSnapshot?.id,
    );
    if (!this.settingsService.oauthConfigured(currentSettings)) {
      throw new UnauthorizedException('OAuth state provider is invalid');
    }
    if (!providerSnapshot) {
      return { ...currentSettings, redirectUri };
    }
    if (
      !providerSnapshot.enabled ||
      !oauthProviderSnapshotMatchesSettings(providerSnapshot, {
        ...currentSettings,
        redirectUri: this.resolveOAuthRedirectUri(currentSettings),
      })
    ) {
      throw new UnauthorizedException('OAuth state provider is invalid');
    }
    return {
      ...currentSettings,
      ...providerSnapshot,
      clientSecret: currentSettings.clientSecret,
      redirectUri: providerSnapshot.redirectUri || redirectUri,
    };
  }

  private resolveOAuthRedirectUri(oauth: { redirectUri: string }) {
    if (oauth.redirectUri) return oauth.redirectUri;
    const base = (
      this.config.get<string>('api.publicBaseUrl') ??
      'http://127.0.0.1:13001/api'
    ).replace(/\/$/, '');
    return `${base}/auth/oauth/callback`;
  }

  private async assertLocalAuthEnabled() {
    await this.bootstrapState.requireCompleted();
    const settings = await this.authRepository.getSettings();
    if (!settings.localEnabled) {
      throw new ForbiddenException('Local authentication is disabled');
    }
  }

  private invalidCredentialsException() {
    return new UnauthorizedException({
      statusCode: 401,
      code: invalidCredentialsCode,
      message: 'Invalid email or password',
      error: 'Unauthorized',
    });
  }

  private invalidPasswordResetCodeException() {
    return new UnauthorizedException('Password reset code is invalid');
  }

  private async validatePasswordResetCode(dto: {
    email: string;
    code: string;
  }) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.authRepository.findUserByEmail(email);
    if (!user) throw this.invalidPasswordResetCodeException();

    const reset = await this.authRepository.findLatestPasswordResetForUser(
      user.id,
    );
    if (!reset || reset.user.email !== email || reset.usedAt) {
      throw this.invalidPasswordResetCodeException();
    }
    if (new Date(reset.expiresAt).getTime() < Date.now()) {
      throw this.invalidPasswordResetCodeException();
    }
    if (reset.attemptCount >= resetCodeMaxAttempts) {
      throw this.invalidPasswordResetCodeException();
    }

    const codeHash = this.hashPasswordResetCode(
      reset.user.id,
      this.normalizePasswordResetCode(dto.code),
    );
    if (!this.tokenHashesEqual(codeHash, reset.tokenHash)) {
      await this.authRepository.incrementPasswordResetAttempts(reset.tokenHash);
      throw this.invalidPasswordResetCodeException();
    }

    return reset;
  }

  private async resolveSetupAdmin(email: string) {
    const state = await this.authRepository.getSetupAdminEmailState(email);
    if (state.kind === 'occupied') {
      throw new ConflictException({
        code: setupAdminEmailOccupiedCode,
        message:
          'Administrator email is already assigned to an account without local credentials',
      });
    }
    return state.kind === 'local' ? state.user : null;
  }

  private async requireSession(authorization?: string): Promise<{
    tokenHash: string;
    user: AuthUserResponse;
    expiresAt: string;
  }> {
    await this.bootstrapState.requireCompleted();
    const token = this.extractBearerToken(authorization);
    if (!token) {
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.SESSION_REQUIRED,
      );
    }

    const session = await this.authRepository.findSessionByTokenHash(
      this.hashToken(token),
    );
    if (!session) {
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.SESSION_INVALID,
      );
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.authRepository.deleteSessionByTokenHash(session.tokenHash);
      throw createAuthUnauthorizedError(
        AUTH_UNAUTHORIZED_CODES.SESSION_EXPIRED,
      );
    }

    return {
      tokenHash: session.tokenHash,
      user: session.user,
      expiresAt: session.expiresAt,
    };
  }

  private async createSession(
    user: StoredAuthUser | AuthUserResponse,
  ): Promise<AuthSessionResponse> {
    const token = this.createToken('sess');
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    await this.authRepository.createSession({
      tokenHash: this.hashToken(token),
      userId: user.id,
      expiresAt,
    });

    return {
      token,
      expiresAt,
      user: this.toUserResponse(user),
    };
  }

  private async recordAuthAudit(
    action: 'auth.login' | 'auth.registered' | 'auth.password_reset_completed',
    user: AuthUserResponse,
    options: { method: AuthAuditMethod; request?: Request },
  ) {
    await this.authAuditService.recordSuccess(action, user, options);
  }

  private async notifyLogin(user: AuthUserResponse, request?: Request) {
    try {
      await this.mailService.sendSecurityNotification({
        email: user.email,
        event: 'login',
        locale: user.locale === 'zh' ? 'zh' : 'en',
        occurredAt: new Date().toISOString(),
        deviceName: request?.get('user-agent')?.trim() || 'Unknown device',
        ipAddress:
          request?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          request?.get('x-real-ip') ||
          request?.ip ||
          request?.socket.remoteAddress ||
          'unknown',
      });
    } catch (error) {
      this.logger.warn(
        `Login security notification failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  private async withConfigState(
    settings: AuthSettings,
  ): Promise<AuthSettingsResponse> {
    const oauth = await this.settingsService.getOAuthSettings();
    const passkey = await this.settingsService.getPasskeySettings();
    return {
      ...settings,
      oauthConfigured: this.settingsService.oauthConfigured(oauth),
      passkeyConfigured: this.settingsService.passkeyConfigured(passkey),
    };
  }

  private toUserResponse(
    user: StoredAuthUser | AuthUserResponse,
  ): AuthUserResponse {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role ?? 'member',
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      theme: user.theme,
      timezone: user.timezone,
      createdAt: user.createdAt,
    };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private normalizeNullableString(value: string | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private normalizePasswordResetCode(code: string) {
    return code.trim().toUpperCase();
  }

  private resolvePasswordResetLocale(
    userLocale?: string | null,
    requestLocale?: string | null,
  ): 'en' | 'zh' {
    if (userLocale === 'zh' || userLocale === 'en') return userLocale;
    if (requestLocale === 'zh' || requestLocale === 'en') return requestLocale;
    return 'en';
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) return null;
    const [type, token] = authorization.split(/\s+/, 2);
    if (type?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }

  private createToken(prefix: string) {
    return `${prefix}_${randomBytes(32).toString('base64url')}`;
  }

  private createPasswordResetCode() {
    return Array.from(
      { length: resetCodeLength },
      () => resetCodeAlphabet[randomInt(resetCodeAlphabet.length)],
    ).join('');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashPasswordResetCode(userId: string, code: string) {
    return this.hashToken(`password-reset:${userId}:${code}`);
  }

  private tokenHashesEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private async hashPassword(password: string) {
    return hashPassword(password);
  }

  private async verifyPassword(password: string, passwordHash: string) {
    return verifyPasswordHash(password, passwordHash);
  }

  private get production() {
    return Boolean(this.config.get<boolean>('app.production'));
  }
}
