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
import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import * as oidc from 'openid-client';
import { MailService } from '../../admin/mail/mail.service';
import { SettingsService } from '../../admin/settings/settings.service';
import type { OAuthSettings } from '../../admin/settings/settings.dto';
import {
  AuthSessionResponse,
  AuthSettings,
  AuthSettingsResponse,
  AuthUserResponse,
  LoginDto,
  OAuthExchangeDto,
  OAuthExchangeResponse,
  OAuthStartResponse,
  PasskeyAuthenticationOptionsDto,
  PasskeyAuthenticationVerificationDto,
  PasskeyRegistrationVerificationDto,
  PasskeyResponse,
  PasswordResetConfirmDto,
  PasswordResetConfirmResponse,
  PasswordResetRequestDto,
  PasswordResetRequestResponse,
  PasswordResetVerifyDto,
  PasswordResetVerifyResponse,
  RegisterDto,
  UpdateAuthSettingsDto,
} from './auth.dto';
import { AuthRepository, StoredAuthUser } from './auth.repository';

const scryptAsync = promisify(scrypt);
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const resetTtlMs = 15 * 60 * 1000;
const resetTtlMinutes = resetTtlMs / 60 / 1000;
const resetCodeLength = 6;
const resetCodeMaxAttempts = 5;
const resetCodeAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const challengeTtlMs = 5 * 60 * 1000;
const oauthStateTtlMs = 10 * 60 * 1000;
const oauthExchangeTtlMs = 2 * 60 * 1000;
const invalidCredentialsCode = 'AUTH_INVALID_CREDENTIALS';
const invalidCredentialsPasswordHash =
  'scrypt$icedr-auth-invalid$5m3ozKIOc8ztEI2scnbBUoChYL6g8J2r8wIcRIgbsUSqFB3aJyC9v6VmxtTqUsoUxNQqR5Fe61bLEJO55CpWPA';
type OAuthTokenResponse = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly settingsService: SettingsService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async getSettings(): Promise<AuthSettingsResponse> {
    const settings = await this.authRepository.getSettings();
    return this.withConfigState(settings);
  }

  async updateSettings(
    dto: UpdateAuthSettingsDto,
    authorization?: string,
  ): Promise<AuthSettingsResponse> {
    await this.requireAdminSession(authorization);
    return this.persistAuthSettings(dto);
  }

  async updateSettingsForSetup(
    dto: UpdateAuthSettingsDto,
  ): Promise<AuthSettingsResponse> {
    if (await this.settingsService.bootstrapCompleted()) {
      throw new ForbiddenException('Setup has already been completed');
    }
    return this.persistAuthSettings(dto);
  }

  private async persistAuthSettings(
    dto: UpdateAuthSettingsDto,
  ): Promise<AuthSettingsResponse> {
    const current = await this.authRepository.getSettings();
    const next: AuthSettings = {
      ...current,
      ...dto,
      updatedAt: new Date().toISOString(),
    };
    await this.assertMethodConfiguration(next);
    this.assertAtLeastOneMethod(next);

    return this.withConfigState(await this.authRepository.updateSettings(next));
  }

  async register(dto: RegisterDto): Promise<AuthSessionResponse> {
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
    return this.createSession(user);
  }

  async createSetupAdmin(dto: RegisterDto): Promise<AuthSessionResponse> {
    const email = this.normalizeEmail(dto.email);
    const displayName = dto.displayName.trim();
    if (!displayName) throw new BadRequestException('Display name is required');
    const existing = await this.authRepository.findUserByEmail(email);
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
    return this.createSession(user);
  }

  async login(dto: LoginDto): Promise<AuthSessionResponse> {
    await this.assertLocalAuthEnabled();
    const user = await this.authRepository.findUserByEmail(
      this.normalizeEmail(dto.email),
    );

    if (!user) {
      await this.verifyPassword(dto.password, invalidCredentialsPasswordHash);
      throw this.invalidCredentialsException();
    }

    if (!(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw this.invalidCredentialsException();
    }

    return this.createSession(user);
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
  ): Promise<PasswordResetConfirmResponse> {
    await this.assertLocalAuthEnabled();
    const reset = await this.validatePasswordResetCode(dto);

    const updatedUser = await this.authRepository.updateUserPassword(
      reset.user.id,
      await this.hashPassword(dto.password),
    );
    await this.authRepository.markPasswordResetUsed(reset.tokenHash);
    await this.authRepository.deleteSessionsForUser(updatedUser.id);
    return this.createSession(updatedUser);
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

  async startOAuthLogin(): Promise<OAuthStartResponse> {
    const settings = await this.authRepository.getSettings();
    if (!settings.oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    return this.createOAuthStart('login');
  }

  async startOAuthShareAccess(token: string): Promise<OAuthStartResponse> {
    return this.createOAuthStart('share', token);
  }

  async handleOAuthCallback(currentUrl: string) {
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

    const oauth = await this.settingsService.getOAuthSettings();
    const oauthUser =
      oauth.providerProfile === 'icetowne-blog'
        ? await this.exchangeIcetowneBlogCode(
            oauth,
            storedState.redirectUri,
            url,
          )
        : await this.exchangeOidcCode(
            oauth,
            storedState.redirectUri,
            url,
            state,
            storedState.codeVerifier,
          );
    await this.authRepository.markOAuthStateUsed(state);

    let user = await this.authRepository.findUserByProviderIdentity(
      this.oauthProviderKey(oauth),
      oauthUser.subject,
    );
    if (!user) {
      user = await this.authRepository.createOAuthUser({
        provider: this.oauthProviderKey(oauth),
        subject: oauthUser.subject,
        email: this.normalizeEmail(oauthUser.email),
        displayName: oauthUser.displayName,
      });
    }

    if (storedState.flow === 'share') {
      return {
        flow: 'share' as const,
        shareToken: storedState.shareToken,
        user,
      };
    }

    const exchangeCode = this.createToken('oauth');
    await this.authRepository.createOAuthExchangeCode({
      codeHash: this.hashToken(exchangeCode),
      userId: user.id,
      expiresAt: new Date(Date.now() + oauthExchangeTtlMs).toISOString(),
    });
    return {
      flow: 'login' as const,
      code: exchangeCode,
      user,
    };
  }

  async completeFrontendOAuthCallback(
    callbackUrl: string,
  ): Promise<AuthSessionResponse> {
    const result = await this.handleOAuthCallback(callbackUrl);
    if (result.flow !== 'login') {
      throw new BadRequestException(
        'OAuth share callbacks must use the share callback endpoint',
      );
    }
    return this.exchangeOAuthCode({ code: result.code });
  }

  async exchangeOAuthCode(
    dto: OAuthExchangeDto,
  ): Promise<OAuthExchangeResponse> {
    const codeHash = this.hashToken(dto.code);
    const code = await this.authRepository.findOAuthExchangeCode(codeHash);
    if (
      !code ||
      code.usedAt ||
      new Date(code.expiresAt).getTime() < Date.now()
    ) {
      throw new UnauthorizedException('OAuth exchange code is invalid');
    }
    const user = await this.authRepository.findUserById(code.userId);
    if (!user) throw new UnauthorizedException('OAuth user is unavailable');
    await this.authRepository.markOAuthExchangeCodeUsed(codeHash);
    return this.createSession(user);
  }

  async createPasskeyRegistrationOptions(authorization?: string) {
    const session = await this.requireSession(authorization);
    const passkey = await this.requirePasskeyConfigured();
    const existing = await this.authRepository.listPasskeysForUser(
      session.user.id,
    );
    const options = await generateRegistrationOptions({
      rpName: passkey.rpName,
      rpID: passkey.rpId,
      userID: Buffer.from(session.user.id),
      userName: session.user.email,
      userDisplayName: session.user.displayName,
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestationType: 'none',
    });
    await this.authRepository.createChallenge({
      flow: 'passkey-registration',
      challenge: options.challenge,
      userId: session.user.id,
      expiresAt: new Date(Date.now() + challengeTtlMs).toISOString(),
    });
    return options;
  }

  async verifyPasskeyRegistration(
    dto: PasskeyRegistrationVerificationDto,
    authorization?: string,
  ) {
    const session = await this.requireSession(authorization);
    const passkey = await this.requirePasskeyConfigured();
    const challenge = await this.authRepository.findActiveChallenge({
      flow: 'passkey-registration',
      userId: session.user.id,
    });
    if (!challenge)
      throw new UnauthorizedException('Passkey challenge expired');

    const verification = await verifyRegistrationResponse({
      response: dto.response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: passkey.origin,
      expectedRPID: passkey.rpId,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('Passkey registration failed');
    }

    const { credential, credentialBackedUp, credentialDeviceType } =
      verification.registrationInfo;
    const created = await this.authRepository.createPasskey({
      userId: session.user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: dto.name?.trim() || 'Passkey',
    });
    await this.authRepository.markChallengeUsed(challenge.id);
    return this.toPasskeyResponse(created);
  }

  async createPasskeyAuthenticationOptions(
    dto: PasskeyAuthenticationOptionsDto,
  ) {
    const settings = await this.authRepository.getSettings();
    if (!settings.passkeyEnabled) {
      throw new ForbiddenException('Passkey login is disabled');
    }
    const passkey = await this.requirePasskeyConfigured();
    const email = this.normalizeEmail(dto.email);
    const user = await this.authRepository.findUserByEmail(email);
    const credentials = user
      ? await this.authRepository.listPasskeysForUser(user.id)
      : [];
    const options = await generateAuthenticationOptions({
      rpID: passkey.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      userVerification: 'preferred',
    });
    await this.authRepository.createChallenge({
      flow: 'passkey-authentication',
      challenge: options.challenge,
      userId: user?.id ?? null,
      email,
      expiresAt: new Date(Date.now() + challengeTtlMs).toISOString(),
    });
    return options;
  }

  async verifyPasskeyAuthentication(dto: PasskeyAuthenticationVerificationDto) {
    const settings = await this.authRepository.getSettings();
    if (!settings.passkeyEnabled) {
      throw new ForbiddenException('Passkey login is disabled');
    }
    const passkey = await this.requirePasskeyConfigured();
    const email = this.normalizeEmail(dto.email);
    const challenge = await this.authRepository.findActiveChallenge({
      flow: 'passkey-authentication',
      email,
    });
    if (!challenge)
      throw new UnauthorizedException('Passkey challenge expired');

    const response = dto.response as AuthenticationResponseJSON;
    const credential = await this.authRepository.findPasskeyByCredentialId(
      response.id,
    );
    if (!credential || credential.userId !== challenge.userId) {
      throw new UnauthorizedException('Passkey credential is invalid');
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: passkey.origin,
      expectedRPID: passkey.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.counter,
        transports: credential.transports as never,
      },
      requireUserVerification: false,
    });
    if (!verification.verified) {
      throw new UnauthorizedException('Passkey authentication failed');
    }

    await this.authRepository.updatePasskeyCounter(
      credential.id,
      verification.authenticationInfo.newCounter,
    );
    await this.authRepository.markChallengeUsed(challenge.id);
    const user = await this.authRepository.findUserById(credential.userId);
    if (!user) throw new UnauthorizedException('Passkey user is unavailable');
    return this.createSession(user);
  }

  async listPasskeys(authorization?: string) {
    const session = await this.requireSession(authorization);
    const passkeys = await this.authRepository.listPasskeysForUser(
      session.user.id,
    );
    return passkeys.map((passkey) => this.toPasskeyResponse(passkey));
  }

  async deletePasskey(id: string, authorization?: string) {
    const session = await this.requireSession(authorization);
    await this.authRepository.deletePasskey(session.user.id, id);
    return { ok: true };
  }

  buildOAuthFrontendCallbackUrl(code: string) {
    const origin =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    const url = new URL('/login', origin.replace(/\/$/, ''));
    url.searchParams.set('oauthCode', code);
    return url.toString();
  }

  buildShareOAuthFrontendCallbackUrl(shareToken: string, sessionId: string) {
    const origin =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    const url = new URL(
      `/share/s/${encodeURIComponent(shareToken)}`,
      origin.replace(/\/$/, ''),
    );
    url.searchParams.set('shareAccessSession', sessionId);
    url.searchParams.set('identityType', 'ica');
    return url.toString();
  }

  private async createOAuthStart(
    flow: 'login' | 'share',
    shareToken?: string,
  ): Promise<OAuthStartResponse> {
    const settings = await this.authRepository.getSettings();
    if (!settings.oauthEnabled) {
      throw new ForbiddenException('OAuth login is disabled');
    }
    const oauth = await this.settingsService.getOAuthSettings();
    if (!this.settingsService.oauthConfigured(oauth)) {
      throw new ServiceUnavailableException('OAuth is not configured');
    }
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const redirectUri = this.resolveOAuthRedirectUri(oauth, flow);
    const authorizationUrl =
      oauth.providerProfile === 'icetowne-blog'
        ? await this.buildIcetowneBlogAuthorizationUrl(oauth, state)
        : await this.buildOidcAuthorizationUrl(
            oauth,
            redirectUri,
            state,
            codeChallenge,
          );
    await this.authRepository.createOAuthState({
      state,
      flow,
      shareToken: shareToken ?? null,
      codeVerifier,
      redirectUri,
      expiresAt: new Date(Date.now() + oauthStateTtlMs).toISOString(),
    });
    return { authorizationUrl: authorizationUrl.toString() };
  }

  private async buildOidcAuthorizationUrl(
    oauth: OAuthSettings,
    redirectUri: string,
    state: string,
    codeChallenge: string,
  ) {
    const client = await this.createOAuthClient(oidc, oauth, redirectUri);
    return oidc.buildAuthorizationUrl(client, {
      redirect_uri: redirectUri,
      scope: oauth.scopes || 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...(oauth.audience ? { audience: oauth.audience } : {}),
    });
  }

  private async buildIcetowneBlogAuthorizationUrl(
    oauth: OAuthSettings,
    state: string,
  ) {
    const response = await this.postOAuthForm(
      this.joinOAuthUrl(oauth.issuerUrl, '/oauth/request-auth-token'),
      {
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret ?? '',
        scope: oauth.scopes || 'basic',
        state,
      },
    );
    const authUrl = this.readStringField(response, 'auth_url');
    if (!authUrl) {
      throw new ServiceUnavailableException(
        'ICETOWNE BLOG OAuth did not return an authorization URL',
      );
    }
    return new URL(authUrl);
  }

  private async exchangeOidcCode(
    oauth: OAuthSettings,
    redirectUri: string,
    url: URL,
    state: string,
    codeVerifier: string,
  ) {
    const client = await this.createOAuthClient(oidc, oauth, redirectUri);
    const tokens = await oidc.authorizationCodeGrant(client, url, {
      expectedState: state,
      pkceCodeVerifier: codeVerifier,
    });
    const claims = tokens.claims();
    const subject = claims?.sub;
    const accessToken = tokens.access_token;
    let email = typeof claims?.email === 'string' ? claims.email : '';
    let displayName =
      typeof claims?.name === 'string' ? claims.name : email || 'OAuth User';

    if ((!email || !displayName) && accessToken) {
      const userInfo = await oidc.fetchUserInfo(
        client,
        accessToken,
        subject ?? oidc.skipSubjectCheck,
      );
      if (!email && typeof userInfo.email === 'string') email = userInfo.email;
      if (typeof userInfo.name === 'string') displayName = userInfo.name;
    }

    if (!subject) throw new UnauthorizedException('OAuth subject is missing');
    if (!email) email = `${subject}@oauth.local`;
    return { subject, email, displayName };
  }

  private async exchangeIcetowneBlogCode(
    oauth: OAuthSettings,
    redirectUri: string,
    url: URL,
  ) {
    const code = url.searchParams.get('code');
    if (!code) throw new UnauthorizedException('OAuth code is required');
    const tokenResponse = await this.postOAuthForm(
      this.joinOAuthUrl(oauth.issuerUrl, '/oauth/token'),
      {
        grant_type: 'authorization_code',
        code,
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret ?? '',
        redirect_uri: redirectUri,
      },
    );
    const accessToken = this.readStringField(tokenResponse, 'access_token');
    if (!accessToken) {
      throw new UnauthorizedException('ICETOWNE BLOG access token is missing');
    }
    const userInfo = await this.fetchOAuthJson(
      this.joinOAuthUrl(oauth.issuerUrl, '/oauth/userinfo'),
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );
    return this.parseIcetowneBlogUser(userInfo, tokenResponse);
  }

  private parseIcetowneBlogUser(
    userInfo: Record<string, unknown>,
    tokenResponse: OAuthTokenResponse,
  ) {
    const nestedUser = this.readRecordField(userInfo, 'user');
    const subject =
      this.firstStringField(userInfo, [
        'sub',
        'id',
        'ID',
        'user_id',
        'userId',
      ]) ||
      this.firstStringField(nestedUser, [
        'sub',
        'id',
        'ID',
        'user_id',
        'userId',
      ]) ||
      this.firstStringField(tokenResponse, ['sub', 'user_id', 'userId']);
    if (!subject) {
      throw new UnauthorizedException('ICETOWNE BLOG user id is missing');
    }

    const email =
      this.firstStringField(userInfo, ['email', 'user_email']) ||
      this.firstStringField(nestedUser, ['email', 'user_email']) ||
      `${subject}@icetowne-blog.local`;
    const displayName =
      this.firstStringField(userInfo, [
        'name',
        'display_name',
        'displayName',
        'nickname',
        'user_login',
        'login',
        'username',
      ]) ||
      this.firstStringField(nestedUser, [
        'name',
        'display_name',
        'displayName',
        'nickname',
        'user_login',
        'login',
        'username',
      ]) ||
      email;

    return { subject, email, displayName };
  }

  private async postOAuthForm(
    targetUrl: string,
    fields: Record<string, string>,
  ) {
    return this.fetchOAuthJson(
      targetUrl,
      {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      new URLSearchParams(fields),
    );
  }

  private async fetchOAuthJson(
    targetUrl: string,
    headers: Record<string, string>,
    body?: URLSearchParams,
  ) {
    let response: globalThis.Response;
    try {
      response = await fetch(targetUrl, {
        method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json', ...headers },
        body,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `OAuth provider request failed: ${error instanceof Error ? error.message : 'network error'}`,
      );
    }
    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new ServiceUnavailableException(
        `OAuth provider returned ${response.status}: ${message}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private joinOAuthUrl(baseUrl: string, path: string) {
    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }

  private oauthProviderKey(oauth: OAuthSettings) {
    return oauth.providerProfile === 'icetowne-blog'
      ? 'icetowne-blog'
      : 'oauth';
  }

  private readRecordField(source: Record<string, unknown>, key: string) {
    const value = source[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private firstStringField(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = this.readStringField(source, key);
      if (value) return value;
    }
    return '';
  }

  private readStringField(source: Record<string, unknown>, key: string) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return '';
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

  private async createOAuthClient(
    oidc: typeof import('openid-client'),
    oauth: {
      issuerUrl: string;
      clientId: string;
      clientSecret?: string;
      redirectUri: string;
    },
    redirectUri = this.resolveOAuthRedirectUri(oauth, 'login'),
  ) {
    const issuer = new URL(oauth.issuerUrl);
    return oidc.discovery(
      issuer,
      oauth.clientId,
      {
        redirect_uris: [redirectUri],
        response_types: ['code'],
      },
      oauth.clientSecret
        ? oidc.ClientSecretPost(oauth.clientSecret)
        : oidc.None(),
      issuer.protocol === 'http:' && !this.production
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined,
    );
  }

  private resolveOAuthRedirectUri(
    oauth: { redirectUri: string },
    flow: 'login' | 'share',
  ) {
    if (flow === 'login' && oauth.redirectUri) return oauth.redirectUri;
    const base = (
      this.config.get<string>('api.publicBaseUrl') ??
      'http://127.0.0.1:13001/api'
    ).replace(/\/$/, '');
    return flow === 'share'
      ? `${base}/shares/oauth/callback`
      : `${base}/auth/oauth/callback`;
  }

  private async assertLocalAuthEnabled() {
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

  private async assertMethodConfiguration(settings: AuthSettings) {
    const oauth = await this.settingsService.getOAuthSettings();
    const passkey = await this.settingsService.getPasskeySettings();
    if (settings.oauthEnabled && !this.settingsService.oauthConfigured(oauth)) {
      throw new BadRequestException(
        'OAuth must be configured before enabling it',
      );
    }
    if (
      settings.passkeyEnabled &&
      !this.settingsService.passkeyConfigured(passkey)
    ) {
      throw new BadRequestException(
        'Passkey must be configured before enabling it',
      );
    }
  }

  private assertAtLeastOneMethod(settings: AuthSettings) {
    if (
      !settings.localEnabled &&
      !settings.oauthEnabled &&
      !settings.passkeyEnabled
    ) {
      throw new BadRequestException(
        'At least one authentication method must be enabled',
      );
    }
  }

  private async requireSession(
    authorization?: string,
  ): Promise<{ user: AuthUserResponse; expiresAt: string }> {
    const token = this.extractBearerToken(authorization);
    if (!token) throw new UnauthorizedException('Authentication is required');

    const session = await this.authRepository.findSessionByTokenHash(
      this.hashToken(token),
    );
    if (!session) throw new UnauthorizedException('Session is invalid');
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.authRepository.deleteSessionByTokenHash(session.tokenHash);
      throw new UnauthorizedException('Session has expired');
    }

    return { user: session.user, expiresAt: session.expiresAt };
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

  private toPasskeyResponse(passkey: {
    id: string;
    name: string;
    transports: string[];
    createdAt: string;
    lastUsedAt: string | null;
  }): PasskeyResponse {
    return {
      id: passkey.id,
      name: passkey.name,
      transports: passkey.transports,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt,
    };
  }

  private async requirePasskeyConfigured() {
    const passkey = await this.settingsService.getPasskeySettings();
    if (!this.settingsService.passkeyConfigured(passkey)) {
      throw new ServiceUnavailableException('Passkey is not configured');
    }
    return passkey;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
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
    const salt = randomBytes(16).toString('base64url');
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${derivedKey.toString('base64url')}`;
  }

  private async verifyPassword(password: string, passwordHash: string) {
    const [algorithm, salt, expected] = passwordHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !expected) return false;
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const expectedBuffer = Buffer.from(expected, 'base64url');
    if (derivedKey.length !== expectedBuffer.length) return false;
    return timingSafeEqual(derivedKey, expectedBuffer);
  }

  private get production() {
    return Boolean(this.config.get<boolean>('app.production'));
  }
}
