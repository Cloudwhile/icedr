import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { validateOAuthHttpUrl } from '../../../extensions/oauth/oauth-url-policy';
import { StorageService } from '../../storage/storage.service';
import { AuthRepository } from '../../auth/core/auth.repository';
import {
  AdminSettingsResponse,
  DatabaseProfile,
  JsonRecord,
  MailSettings,
  MailSettingsResponse,
  OAuthProviderListResponse,
  OAuthSettings,
  OAuthSettingsResponse,
  PasskeySettings,
  PublicSiteSettings,
  SetupAccessState,
  SetupStatusResponse,
  TranslationSettings,
  UpdateMailSettingsDto,
  UpdateOAuthSettingsDto,
  UpdatePasskeySettingsDto,
  UpdateSiteSettingsDto,
  UpsertTranslationBundleDto,
  VerifyDatabaseDto,
} from './settings.dto';
import {
  applyOAuthProviderActivationRule,
  createOAuthProviderId,
  defaultOAuthDisplayName,
  defaultOAuthProfileForProviderKey,
  defaultOAuthProviderKeyForProfile,
  defaultOAuthSecurityPolicy,
  mergeOAuthProviderSettings,
  normalizeOAuthProviderKey,
  normalizeOAuthProviderProfile,
  normalizeOAuthProviderSettings,
  normalizeOAuthStore,
  oauthProviderMode,
  oauthProviderReady,
  selectPrimaryOAuthProvider,
} from './settings-oauth.helpers';
import {
  bootstrapMeta,
  databaseMeta,
  mailMeta,
  oauthMeta,
  passkeyMeta,
  settingsParentMeta,
  SettingsRepository,
  siteMeta,
  translationsMeta,
} from './settings.repository';

type BootstrapSetting = {
  completed: boolean;
  completedAt: string | null;
};

const maxLogoBytes = 256 * 1024;
const maxTranslationBytes = 1024 * 1024;
const logoPattern =
  /^data:image\/(?:png|jpeg|jpg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i;

@Injectable()
export class SettingsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly repository: SettingsRepository,
    private readonly storageService: StorageService,
    private readonly authRepository: AuthRepository,
  ) {}

  async getSetupStatus(
    setupAccess: SetupAccessState = {
      authorized: false,
      configured: false,
    },
  ): Promise<SetupStatusResponse> {
    const databaseAvailable = await this.databaseReachable();
    const bootstrapCompleted = await this.bootstrapCompleted();
    if (bootstrapCompleted) {
      return {
        databaseAvailable,
        needsSetup: false,
        bootstrapCompleted: true,
      };
    }
    if (!setupAccess.authorized) {
      return {
        databaseAvailable,
        needsSetup: true,
        bootstrapCompleted: false,
        setupAccess,
      };
    }
    return {
      databaseAvailable,
      needsSetup: true,
      bootstrapCompleted: false,
      setupAccess,
      databaseProfile: await this.getDatabaseProfile(),
      site: await this.getPublicSiteSettings(),
      oauth: this.toOAuthResponse(await this.getOAuthSettings()),
      passkey: await this.getPasskeySettings(),
      mail: this.toMailResponse(await this.getMailSettings()),
      storage: await this.storageService.getSettings(),
    };
  }

  async getAdminSettings(): Promise<AdminSettingsResponse> {
    return {
      site: await this.getPublicSiteSettings(),
      databaseProfile: await this.getDatabaseProfile(),
      oauth: this.toOAuthResponse(await this.getOAuthSettings()),
      passkey: await this.getPasskeySettings(),
      mail: this.toMailResponse(await this.getMailSettings()),
      bootstrapCompleted: await this.bootstrapCompleted(),
    };
  }

  async bootstrapCompleted() {
    const bootstrap = await this.repository.get<BootstrapSetting>(
      settingsParentMeta,
      bootstrapMeta,
      { completed: false, completedAt: null },
    );
    return Boolean(bootstrap.completed);
  }

  async assertSetupOpen() {
    if (await this.bootstrapCompleted()) {
      throw new BadRequestException('Setup has already been completed');
    }
  }

  async verifyDatabase(dto: VerifyDatabaseDto = {}) {
    await this.assertSetupOpen();
    const remoteInput = this.normalizeRemoteDatabaseInput(dto);
    if (remoteInput) {
      if (dto.confirm !== true) {
        throw new BadRequestException(
          'Remote database migration requires explicit confirmation',
        );
      }
      const source = await this.prisma.migrateToPostgres(remoteInput);
      const profile = this.toDatabaseProfile(source, true);
      await this.repository.set(settingsParentMeta, databaseMeta, profile);
      return profile;
    }

    if (!(await this.databaseReachable())) {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    const profile = {
      ...this.defaultDatabaseProfile(),
      verified: true,
      verifiedAt: new Date().toISOString(),
    };
    await this.repository.set(settingsParentMeta, databaseMeta, profile);
    return profile;
  }

  async markBootstrapCompleted() {
    return this.repository.set<BootstrapSetting>(
      settingsParentMeta,
      bootstrapMeta,
      { completed: true, completedAt: new Date().toISOString() },
    );
  }

  async getDatabaseProfile(): Promise<DatabaseProfile> {
    const stored = await this.repository.get<DatabaseProfile>(
      settingsParentMeta,
      databaseMeta,
      this.defaultDatabaseProfile(),
    );
    return {
      ...this.defaultDatabaseProfile(),
      ...stored,
      passwordProvided: Boolean(stored.passwordProvided),
    };
  }

  async getPublicSiteSettings(): Promise<PublicSiteSettings> {
    const stored = await this.repository.get<PublicSiteSettings>(
      settingsParentMeta,
      siteMeta,
      this.defaultSiteSettings(),
    );
    return {
      siteName: this.normalizeSiteName(stored.siteName),
      authLogoDataUrl: stored.authLogoDataUrl ?? null,
    };
  }

  async updateSiteSettings(dto: UpdateSiteSettingsDto) {
    const current = await this.getPublicSiteSettings();
    const next: PublicSiteSettings = {
      siteName: this.normalizeSiteName(dto.siteName ?? current.siteName),
      authLogoDataUrl:
        dto.authLogoDataUrl === undefined
          ? current.authLogoDataUrl
          : this.validateLogo(dto.authLogoDataUrl),
    };
    return this.repository.set(settingsParentMeta, siteMeta, next);
  }

  async getTranslationSettings(): Promise<TranslationSettings> {
    const stored = await this.repository.get<TranslationSettings>(
      settingsParentMeta,
      translationsMeta,
      { bundles: [] },
    );
    return {
      bundles: Array.isArray(stored.bundles) ? stored.bundles : [],
    };
  }

  async upsertTranslationBundle(dto: UpsertTranslationBundleDto) {
    const code = this.normalizeTranslationCode(dto.code);
    const content = this.validateTslnContent(dto.content);
    const language = this.extractTslnLanguage(content);
    const current = await this.getTranslationSettings();
    const nextBundle = {
      code,
      content,
      language,
      updatedAt: new Date().toISOString(),
    };
    const next = {
      bundles: [
        nextBundle,
        ...current.bundles.filter((bundle) => bundle.code !== code),
      ].sort((left, right) => left.code.localeCompare(right.code)),
    };
    await this.repository.set(settingsParentMeta, translationsMeta, next);
    return nextBundle;
  }

  async getOAuthSettings(providerId?: string): Promise<OAuthSettings> {
    const providers = await this.getOAuthProviderSettings();
    if (providerId) {
      return (
        providers.find((provider) => provider.id === providerId) ??
        this.defaultOAuthSettings({ id: providerId })
      );
    }
    return selectPrimaryOAuthProvider(providers) ?? this.defaultOAuthSettings();
  }

  async getOAuthProviderSettings(): Promise<OAuthSettings[]> {
    const stored = await this.repository.get<JsonRecord>(
      settingsParentMeta,
      oauthMeta,
      {},
    );
    return normalizeOAuthStore(stored, (options) =>
      this.defaultOAuthSettings(options),
    ).providers;
  }

  async listOAuthProviders(): Promise<OAuthProviderListResponse> {
    const providers = await this.getOAuthProviderSettings();
    const responses = providers.map((provider) =>
      this.toOAuthResponse(provider),
    );
    const activeProvider = selectPrimaryOAuthProvider(providers);
    return {
      activeProvider: activeProvider
        ? this.toOAuthResponse(activeProvider)
        : null,
      configured: responses.some(
        (provider) => provider.enabled && provider.configured,
      ),
      providers: responses,
    };
  }

  async testOAuthProvider(dto: UpdateOAuthSettingsDto) {
    const { testOAuthProviderConnection } =
      await import('../../../extensions/oauth/oauth-provider-adapters.js');
    const providers = await this.getOAuthProviderSettings();
    const providerKey = normalizeOAuthProviderKey(
      dto.providerKey ?? defaultOAuthProviderKeyForProfile(dto.providerProfile),
    );
    const providerProfile = normalizeOAuthProviderProfile(
      dto.providerProfile ?? defaultOAuthProfileForProviderKey(providerKey),
    );
    const current =
      providers.find((provider) => provider.id === dto.id) ??
      this.defaultOAuthSettings({ providerKey, providerProfile });
    const candidate = mergeOAuthProviderSettings(current, {
      ...dto,
      enabled: true,
    });
    this.assertOAuthSettingsValid(candidate);
    return testOAuthProviderConnection(candidate, {
      production: Boolean(this.config.get<boolean>('app.production')),
    });
  }
  async createOAuthProvider(dto: UpdateOAuthSettingsDto) {
    const providerKey = normalizeOAuthProviderKey(
      dto.providerKey ?? defaultOAuthProviderKeyForProfile(dto.providerProfile),
    );
    const profile = normalizeOAuthProviderProfile(
      dto.providerProfile ?? defaultOAuthProfileForProviderKey(providerKey),
    );
    const now = new Date().toISOString();
    const provider = normalizeOAuthProviderSettings(
      {
        ...this.defaultOAuthSettings({
          providerKey,
          providerProfile: profile,
        }),
        ...dto,
        id: dto.id?.trim() || createOAuthProviderId(),
        createdAt: now,
        updatedAt: now,
      },
      this.defaultOAuthSettings({
        providerKey,
        providerProfile: profile,
      }),
    );
    const providers = await this.getOAuthProviderSettings();
    if (providers.some((item) => item.id === provider.id)) {
      throw new BadRequestException('OAuth provider ID already exists');
    }
    this.assertOAuthSettingsValid(provider);
    const nextProviders = applyOAuthProviderActivationRule(
      [...providers, provider],
      provider.enabled ? provider.id : undefined,
    );
    await this.saveOAuthProviders(nextProviders);
    return this.toOAuthResponse(provider);
  }

  async updateOAuthProvider(id: string, dto: UpdateOAuthSettingsDto) {
    const providerId = id.trim();
    if (!providerId)
      throw new BadRequestException('OAuth provider ID is required');
    const providers = await this.getOAuthProviderSettings();
    const current = providers.find((provider) => provider.id === providerId);
    if (!current) throw new BadRequestException('OAuth provider was not found');
    const next = mergeOAuthProviderSettings(current, dto);
    this.assertOAuthSettingsValid(next);
    const nextProviders = applyOAuthProviderActivationRule(
      providers.map((provider) =>
        provider.id === providerId ? next : provider,
      ),
      next.enabled ? next.id : undefined,
    );
    await this.assertOAuthProviderRemovalSafe(providers, nextProviders);
    await this.saveOAuthProviders(nextProviders);
    return this.toOAuthResponse(next);
  }

  async deleteOAuthProvider(id: string) {
    const providerId = id.trim();
    if (!providerId)
      throw new BadRequestException('OAuth provider ID is required');
    const providers = await this.getOAuthProviderSettings();
    const nextProviders = providers.filter(
      (provider) => provider.id !== providerId,
    );
    if (nextProviders.length === providers.length) {
      throw new BadRequestException('OAuth provider was not found');
    }
    await this.assertOAuthProviderRemovalSafe(providers, nextProviders);
    await this.saveOAuthProviders(nextProviders);
    return { ok: true };
  }

  async updateOAuthSettings(dto: UpdateOAuthSettingsDto) {
    const providers = await this.getOAuthProviderSettings();
    const current =
      providers.find((provider) => provider.id === dto.id) ??
      selectPrimaryOAuthProvider(providers) ??
      providers[0] ??
      this.defaultOAuthSettings({ id: dto.id?.trim() || 'default' });
    const next = mergeOAuthProviderSettings(current, dto);
    this.assertOAuthSettingsValid(next);
    const remainingProviders = providers.filter(
      (provider) => provider.id !== current.id,
    );
    const nextProviders = applyOAuthProviderActivationRule(
      [...remainingProviders, next],
      next.enabled ? next.id : undefined,
    );
    await this.saveOAuthProviders(nextProviders);
    return this.toOAuthResponse(next);
  }

  async getPasskeySettings(): Promise<PasskeySettings> {
    const stored = await this.repository.get<PasskeySettings>(
      settingsParentMeta,
      passkeyMeta,
      this.defaultPasskeySettings(),
    );
    return {
      ...this.defaultPasskeySettings(),
      ...stored,
      rpName: String(stored.rpName ?? this.defaultPasskeySettings().rpName),
      rpId: String(stored.rpId ?? this.defaultPasskeySettings().rpId),
      origin: String(stored.origin ?? this.defaultPasskeySettings().origin),
    };
  }

  async updatePasskeySettings(dto: UpdatePasskeySettingsDto) {
    const current = await this.getPasskeySettings();
    const next: PasskeySettings = {
      ...current,
      ...dto,
      rpName: (dto.rpName ?? current.rpName).trim() || 'ICEDR',
      rpId: (dto.rpId ?? current.rpId).trim(),
      origin: (dto.origin ?? current.origin).trim(),
    };
    if (next.rpId || next.origin) this.assertPasskeySettings(next);
    return this.repository.set(settingsParentMeta, passkeyMeta, next);
  }

  async getMailSettings(): Promise<MailSettings> {
    const stored = await this.repository.get<MailSettings>(
      settingsParentMeta,
      mailMeta,
      this.defaultMailSettings(),
    );
    return {
      ...this.defaultMailSettings(),
      ...stored,
      enabled: Boolean(stored.enabled),
      host: String(stored.host ?? '').trim(),
      port: Number(stored.port ?? this.defaultMailSettings().port),
      secure: Boolean(stored.secure),
      username: String(stored.username ?? '').trim(),
      password: stored.password ? String(stored.password) : '',
      fromName:
        String(stored.fromName ?? this.defaultMailSettings().fromName).trim() ||
        'ICEDR',
      fromEmail: String(stored.fromEmail ?? '').trim(),
      replyTo: String(stored.replyTo ?? '').trim(),
      verifiedAt: stored.verifiedAt ?? null,
    };
  }

  async updateMailSettings(dto: UpdateMailSettingsDto) {
    const current = await this.getMailSettings();
    const next: MailSettings = {
      ...current,
      ...dto,
      enabled: dto.enabled ?? current.enabled,
      host: (dto.host ?? current.host).trim(),
      port: dto.port ?? current.port,
      secure: dto.secure ?? current.secure,
      username: (dto.username ?? current.username).trim(),
      password:
        dto.password === undefined ? current.password : dto.password.trim(),
      fromName: (dto.fromName ?? current.fromName).trim() || 'ICEDR',
      fromEmail: (dto.fromEmail ?? current.fromEmail).trim().toLowerCase(),
      replyTo: (dto.replyTo ?? current.replyTo).trim().toLowerCase(),
      verifiedAt: current.verifiedAt,
    };

    this.assertMailSettingsValid(next);
    if (this.mailTransportChanged(current, next)) {
      next.verifiedAt = null;
    }
    const saved = await this.repository.set(settingsParentMeta, mailMeta, next);
    return this.toMailResponse(saved);
  }

  async markMailVerified() {
    const current = await this.getMailSettings();
    this.assertMailSettingsValid(current);
    const next = {
      ...current,
      verifiedAt: new Date().toISOString(),
    };
    const saved = await this.repository.set(settingsParentMeta, mailMeta, next);
    return this.toMailResponse(saved);
  }

  toOAuthResponse(settings: OAuthSettings): OAuthSettingsResponse {
    return {
      id: settings.id,
      enabled: settings.enabled,
      providerKey: settings.providerKey,
      displayName: settings.displayName,
      providerProfile: settings.providerProfile,
      providerMode: oauthProviderMode(settings.providerProfile),
      issuerUrl: settings.issuerUrl,
      authorizationUrl: settings.authorizationUrl,
      tokenUrl: settings.tokenUrl,
      userinfoUrl: settings.userinfoUrl,
      clientId: settings.clientId,
      audience: settings.audience,
      scopes: settings.scopes,
      redirectUri: settings.redirectUri,
      allowSignup: settings.allowSignup,
      linkByVerifiedEmail: settings.linkByVerifiedEmail,
      requireVerifiedEmail: settings.requireVerifiedEmail,
      allowedEmailDomains: settings.allowedEmailDomains,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
      clientSecretConfigured: Boolean(settings.clientSecret),
      configured: oauthProviderReady(settings),
    };
  }

  oauthConfigured(settings: OAuthSettings) {
    return Boolean(settings.enabled && oauthProviderReady(settings));
  }

  passkeyConfigured(settings: PasskeySettings) {
    return Boolean(settings.rpName && settings.rpId && settings.origin);
  }

  toMailResponse(settings: MailSettings): MailSettingsResponse {
    const safe = { ...settings };
    delete safe.password;
    return {
      ...safe,
      configured: this.mailConfigured(settings),
      passwordConfigured: Boolean(settings.password),
    };
  }

  mailConfigured(settings: MailSettings) {
    return Boolean(
      settings.enabled &&
      settings.host &&
      settings.port >= 1 &&
      settings.port <= 65535 &&
      settings.fromEmail &&
      settings.username &&
      settings.password,
    );
  }

  private async databaseReachable() {
    try {
      await this.prisma.$queryRaw`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  private defaultDatabaseProfile(): DatabaseProfile {
    const source = this.prisma.getSource();
    if (source.provider === 'sqlite') {
      return {
        provider: 'sqlite',
        host: 'local',
        port: 0,
        dbName: 'icedr.sqlite',
        user: '',
        passwordProvided: false,
        passwordSource: 'local',
        verified: true,
        verifiedAt: source.verifiedAt,
      };
    }

    return {
      provider: 'postgresql',
      host: this.config.get<string>('database.host') ?? '',
      port: this.config.get<number>('database.port') ?? 5432,
      dbName: this.config.get<string>('database.dbName') ?? '',
      user: this.config.get<string>('database.user') ?? '',
      passwordProvided: Boolean(this.config.get<string>('database.password')),
      passwordSource: source.source,
      verified: false,
      verifiedAt: null,
    };
  }

  private toDatabaseProfile(
    source: ReturnType<PrismaService['getSource']>,
    verified: boolean,
  ): DatabaseProfile {
    if (source.provider === 'sqlite') {
      return this.defaultDatabaseProfile();
    }

    return {
      provider: 'postgresql',
      host: source.host,
      port: source.port,
      dbName: source.dbName,
      user: source.user,
      passwordProvided: Boolean(source.password),
      passwordSource: source.source,
      verified,
      verifiedAt: verified
        ? (source.verifiedAt ?? new Date().toISOString())
        : null,
    };
  }

  private normalizeRemoteDatabaseInput(dto: VerifyDatabaseDto) {
    const hasRemoteValue = Boolean(
      dto.provider ||
      dto.host?.trim() ||
      dto.dbName?.trim() ||
      dto.user?.trim() ||
      dto.password,
    );
    if (!hasRemoteValue) return null;

    const host = dto.host?.trim();
    const dbName = dto.dbName?.trim();
    const user = dto.user?.trim();
    if (!host || !dbName || !user) {
      throw new BadRequestException(
        'Remote database host, database name, and user are required',
      );
    }

    return {
      host,
      port: dto.port || 5432,
      dbName,
      user,
      password: dto.password ?? '',
    };
  }

  private defaultSiteSettings(): PublicSiteSettings {
    return {
      siteName: process.env.SITE_NAME ?? 'ICEDR',
      authLogoDataUrl: null,
    };
  }

  private defaultOAuthSettings(
    options: Partial<OAuthSettings> = {},
  ): OAuthSettings {
    const redirectBase =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    const providerProfile =
      options.providerProfile ??
      normalizeOAuthProviderProfile(
        this.config.get<OAuthSettings['providerProfile']>(
          'identity.providerProfile',
        ) ?? 'oidc',
      );
    const timestamp = new Date(0).toISOString();
    return {
      id: options.id ?? 'default',
      enabled: false,
      providerKey:
        options.providerKey ??
        defaultOAuthProviderKeyForProfile(providerProfile),
      displayName:
        options.displayName ??
        defaultOAuthDisplayName(
          options.providerKey ??
            defaultOAuthProviderKeyForProfile(providerProfile),
        ),
      providerProfile,
      issuerUrl: this.config.get<string>('identity.issuerUrl') ?? '',
      authorizationUrl: options.authorizationUrl ?? '',
      tokenUrl: options.tokenUrl ?? '',
      userinfoUrl: options.userinfoUrl ?? '',
      clientId: this.config.get<string>('identity.clientId') ?? '',
      clientSecret: process.env.ICA_OAUTH_CLIENT_SECRET ?? '',
      audience: this.config.get<string>('identity.audience') ?? 'icedr-api',
      scopes:
        this.config.get<string>('identity.scopes') ?? 'openid email profile',
      redirectUri:
        this.config.get<string>('identity.redirectUri') ??
        `${redirectBase.replace(/\/$/, '')}/callback`,
      ...defaultOAuthSecurityPolicy(
        options.providerKey ??
          defaultOAuthProviderKeyForProfile(providerProfile),
      ),
      ...(options.allowSignup !== undefined
        ? { allowSignup: options.allowSignup }
        : {}),
      ...(options.linkByVerifiedEmail !== undefined
        ? { linkByVerifiedEmail: options.linkByVerifiedEmail }
        : {}),
      ...(options.requireVerifiedEmail !== undefined
        ? { requireVerifiedEmail: options.requireVerifiedEmail }
        : {}),
      ...(options.allowedEmailDomains
        ? { allowedEmailDomains: options.allowedEmailDomains }
        : {}),
      createdAt: options.createdAt ?? timestamp,
      updatedAt: options.updatedAt ?? timestamp,
    };
  }

  private async saveOAuthProviders(providers: OAuthSettings[]) {
    await this.repository.set<JsonRecord>(settingsParentMeta, oauthMeta, {
      providers,
    });
  }

  private async assertOAuthProviderRemovalSafe(
    currentProviders: OAuthSettings[],
    nextProviders: OAuthSettings[],
  ) {
    const currentReady = currentProviders.some(
      (provider) => provider.enabled && oauthProviderReady(provider),
    );
    const nextReady = nextProviders.some(
      (provider) => provider.enabled && oauthProviderReady(provider),
    );
    if (!currentReady || nextReady) return;
    const auth = await this.authRepository.getSettings();
    if (auth.oauthEnabled && !auth.localEnabled && !auth.passkeyEnabled) {
      throw new BadRequestException({
        code: 'AUTH_LAST_LOGIN_METHOD',
        message:
          'The last active OAuth provider cannot be removed while OAuth is the only enabled login method',
      });
    }
  }

  private assertOAuthSettingsValid(settings: OAuthSettings) {
    if (!settings.enabled) return;
    if (
      !settings.clientId ||
      (settings.providerProfile !== 'oauth2' && !settings.issuerUrl)
    ) {
      throw new BadRequestException(
        'OAuth issuer URL and client ID are required when OAuth is enabled',
      );
    }
    if (
      settings.providerProfile === 'oauth2' &&
      (!settings.authorizationUrl ||
        !settings.tokenUrl ||
        !settings.userinfoUrl)
    ) {
      throw new BadRequestException(
        'OAuth authorization, token, and userinfo URLs are required when OAuth2 is enabled',
      );
    }
    if (
      settings.providerProfile === 'icetowne-blog' &&
      !settings.clientSecret
    ) {
      throw new BadRequestException(
        'OAuth client secret is required for ICETOWNE BLOG OAuth',
      );
    }
    const production = Boolean(this.config.get<boolean>('app.production'));
    const endpoints = [
      ...(settings.providerProfile === 'oauth2'
        ? [
            ['OAuth authorization URL', settings.authorizationUrl],
            ['OAuth token URL', settings.tokenUrl],
            ['OAuth userinfo URL', settings.userinfoUrl],
          ]
        : [['OAuth issuer URL', settings.issuerUrl]]),
      ...(settings.redirectUri
        ? [['OAuth redirect URI', settings.redirectUri]]
        : []),
    ] as const;
    for (const [label, endpoint] of endpoints) {
      try {
        validateOAuthHttpUrl(endpoint, { label, production });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : `${label} is invalid`,
        );
      }
    }
  }

  private defaultPasskeySettings(): PasskeySettings {
    const origin =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    let rpId = 'localhost';
    try {
      rpId = new URL(origin).hostname;
    } catch {
      rpId = 'localhost';
    }
    return {
      rpName: process.env.SITE_NAME ?? 'ICEDR',
      rpId,
      origin,
    };
  }

  private defaultMailSettings(): MailSettings {
    return {
      enabled: Boolean(this.config.get<boolean>('mail.enabled')),
      host: this.config.get<string>('mail.host') ?? '',
      port: this.config.get<number>('mail.port') ?? 587,
      secure: Boolean(this.config.get<boolean>('mail.secure')),
      username: this.config.get<string>('mail.username') ?? '',
      password: this.config.get<string>('mail.password') ?? '',
      fromName: this.config.get<string>('mail.fromName') ?? 'ICEDR',
      fromEmail: this.config.get<string>('mail.fromEmail') ?? '',
      replyTo: this.config.get<string>('mail.replyTo') ?? '',
      verifiedAt: null,
    };
  }

  private normalizeSiteName(value: string | undefined) {
    const siteName = (value ?? 'ICEDR').trim();
    if (!siteName) throw new BadRequestException('Site name is required');
    if (siteName.length > 80) {
      throw new BadRequestException('Site name must be 80 characters or fewer');
    }
    return siteName;
  }

  private validateLogo(value: string | null | undefined) {
    if (!value) return null;
    const normalized = value.trim();
    if (!logoPattern.test(normalized)) {
      throw new BadRequestException(
        'Logo must be a PNG, JPEG, WebP, or SVG data URL',
      );
    }
    const commaIndex = normalized.indexOf(',');
    const payload = normalized.slice(commaIndex + 1);
    const estimatedBytes = Math.floor((payload.length * 3) / 4);
    if (estimatedBytes > maxLogoBytes) {
      throw new BadRequestException('Logo must be 256KB or smaller');
    }
    return normalized;
  }

  private normalizeTranslationCode(value: string) {
    const code = value.trim();
    if (!/^[a-z]{2,3}_[A-Z0-9]{2,8}$/.test(code)) {
      throw new BadRequestException('Translation locale code is not valid');
    }
    return code;
  }

  private validateTslnContent(value: string) {
    const content = value.replace(/^\uFEFF/, '').trim();
    if (!content) throw new BadRequestException('Translation file is empty');
    if (Buffer.byteLength(content, 'utf8') > maxTranslationBytes) {
      throw new BadRequestException('Translation file must be 1MB or smaller');
    }

    content.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      if (index === 0 && /^language:\s*"([^"]+)"$/.test(trimmed)) return;
      if (!/^"[^"]+"\s*:\s*"[\s\S]*"$/.test(trimmed)) {
        throw new BadRequestException(`Invalid translation line ${index + 1}`);
      }
    });
    this.extractTslnLanguage(content);
    return content;
  }

  private extractTslnLanguage(content: string) {
    const firstMeaningfulLine = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'));
    const match = firstMeaningfulLine?.match(/^language:\s*"([^"]+)"$/);
    if (!match?.[1]?.trim()) {
      throw new BadRequestException('Translation language header is required');
    }
    return match[1].trim();
  }

  private assertPasskeySettings(settings: PasskeySettings) {
    if (!settings.rpId || !settings.origin) {
      throw new BadRequestException('Passkey RP ID and origin are required');
    }
    let url: URL;
    try {
      url = new URL(settings.origin);
    } catch {
      throw new BadRequestException('Passkey origin must be a valid URL');
    }
    if (
      url.username ||
      url.password ||
      (url.pathname && url.pathname !== '/') ||
      url.search ||
      url.hash
    ) {
      throw new BadRequestException(
        'Passkey origin must contain only scheme, hostname, and optional port',
      );
    }
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
    const local =
      hostname === 'localhost' ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname === '::1' ||
      hostname === '0:0:0:0:0:0:0:1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw new BadRequestException(
        'Passkey origin must use HTTPS outside local development',
      );
    }
    const rpId = settings.rpId
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
    if (
      !rpId ||
      /\s/.test(rpId) ||
      rpId.includes('/') ||
      (rpId.includes(':') && !local) ||
      hostname !== rpId
    ) {
      throw new BadRequestException(
        'Passkey RP ID must exactly match the origin hostname',
      );
    }
  }

  private assertMailSettingsValid(settings: MailSettings) {
    if (settings.port < 1 || settings.port > 65535) {
      throw new BadRequestException('SMTP port must be between 1 and 65535');
    }
    if (!settings.enabled) return;
    if (!settings.host) {
      throw new BadRequestException('SMTP host is required');
    }
    if (!settings.fromEmail) {
      throw new BadRequestException('SMTP sender email is required');
    }
    if (!settings.username || !settings.password) {
      throw new BadRequestException(
        'SMTP username and password are required when mail delivery is enabled',
      );
    }
  }

  private mailTransportChanged(current: MailSettings, next: MailSettings) {
    return (
      current.host !== next.host ||
      current.port !== next.port ||
      current.secure !== next.secure ||
      current.username !== next.username ||
      current.password !== next.password ||
      current.fromName !== next.fromName ||
      current.fromEmail !== next.fromEmail ||
      current.replyTo !== next.replyTo
    );
  }
}
