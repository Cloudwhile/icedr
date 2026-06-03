import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import {
  AdminSettingsResponse,
  DatabaseProfile,
  MailSettings,
  MailSettingsResponse,
  OAuthSettings,
  OAuthSettingsResponse,
  PasskeySettings,
  PublicSiteSettings,
  SetupStatusResponse,
  TranslationSettings,
  UpdateMailSettingsDto,
  UpdateOAuthSettingsDto,
  UpdatePasskeySettingsDto,
  UpdateSiteSettingsDto,
  UpsertTranslationBundleDto,
} from './settings.dto';
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
  ) {}

  async getSetupStatus(): Promise<SetupStatusResponse> {
    const databaseAvailable = await this.databaseReachable();
    const bootstrapCompleted = await this.bootstrapCompleted();
    return {
      databaseAvailable,
      needsSetup: !bootstrapCompleted,
      bootstrapCompleted,
      databaseProfile: await this.getDatabaseProfile(),
      site: await this.getPublicSiteSettings(),
      oauth: this.toOAuthResponse(await this.getOAuthSettings()),
      passkey: await this.getPasskeySettings(),
      mail: this.toMailResponse(await this.getMailSettings()),
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

  async verifyDatabase() {
    await this.assertSetupOpen();
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
      passwordSource: 'env',
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

  async getOAuthSettings(): Promise<OAuthSettings> {
    const stored = await this.repository.get<OAuthSettings>(
      settingsParentMeta,
      oauthMeta,
      this.defaultOAuthSettings(),
    );
    return {
      ...this.defaultOAuthSettings(),
      ...stored,
      enabled: Boolean(stored.enabled),
      providerProfile: ['oidc', 'icetowne-blog'].includes(
        String(stored.providerProfile),
      )
        ? stored.providerProfile
        : this.defaultOAuthSettings().providerProfile,
      issuerUrl: String(stored.issuerUrl ?? ''),
      clientId: String(stored.clientId ?? ''),
      clientSecret: stored.clientSecret ? String(stored.clientSecret) : '',
      audience: String(stored.audience ?? ''),
      scopes: String(stored.scopes ?? 'openid email profile'),
      redirectUri: String(stored.redirectUri ?? ''),
    };
  }

  async updateOAuthSettings(dto: UpdateOAuthSettingsDto) {
    const current = await this.getOAuthSettings();
    const next: OAuthSettings = {
      ...current,
      ...dto,
      enabled: dto.enabled ?? current.enabled,
      providerProfile: dto.providerProfile ?? current.providerProfile,
      issuerUrl: (dto.issuerUrl ?? current.issuerUrl).trim(),
      clientId: (dto.clientId ?? current.clientId).trim(),
      clientSecret:
        dto.clientSecret === undefined
          ? current.clientSecret
          : dto.clientSecret.trim(),
      audience: (dto.audience ?? current.audience).trim(),
      scopes: (dto.scopes ?? current.scopes).trim() || 'openid email profile',
      redirectUri: (dto.redirectUri ?? current.redirectUri).trim(),
    };
    if (next.enabled && (!next.issuerUrl || !next.clientId)) {
      throw new BadRequestException(
        'OAuth issuer URL and client ID are required when OAuth is enabled',
      );
    }
    if (
      next.enabled &&
      next.providerProfile === 'icetowne-blog' &&
      !next.clientSecret
    ) {
      throw new BadRequestException(
        'OAuth client secret is required for ICETOWNE BLOG OAuth',
      );
    }
    await this.repository.set(settingsParentMeta, oauthMeta, next);
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
      enabled: Boolean(stored.enabled),
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
      enabled: dto.enabled ?? current.enabled,
      rpName: (dto.rpName ?? current.rpName).trim() || 'ICEDR',
      rpId: (dto.rpId ?? current.rpId).trim(),
      origin: (dto.origin ?? current.origin).trim(),
    };
    if (next.enabled) this.assertPasskeyOrigin(next.origin);
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
      enabled: settings.enabled,
      providerProfile: settings.providerProfile,
      providerMode: this.oauthProviderMode(settings.providerProfile),
      issuerUrl: settings.issuerUrl,
      clientId: settings.clientId,
      audience: settings.audience,
      scopes: settings.scopes,
      redirectUri: settings.redirectUri,
      clientSecretConfigured: Boolean(settings.clientSecret),
    };
  }

  private oauthProviderMode(providerProfile: OAuthSettings['providerProfile']) {
    return providerProfile === 'icetowne-blog'
      ? ('compatibility' as const)
      : ('standard' as const);
  }

  oauthConfigured(settings: OAuthSettings) {
    return Boolean(
      settings.enabled &&
      settings.issuerUrl &&
      settings.clientId &&
      (settings.providerProfile !== 'icetowne-blog' || settings.clientSecret),
    );
  }

  passkeyConfigured(settings: PasskeySettings) {
    return Boolean(
      settings.enabled && settings.rpName && settings.rpId && settings.origin,
    );
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
    return {
      host: this.config.get<string>('database.host') ?? '',
      port: this.config.get<number>('database.port') ?? 5432,
      dbName: this.config.get<string>('database.dbName') ?? '',
      user: this.config.get<string>('database.user') ?? '',
      passwordProvided: Boolean(this.config.get<string>('database.password')),
      passwordSource: 'env',
      verified: false,
      verifiedAt: null,
    };
  }

  private defaultSiteSettings(): PublicSiteSettings {
    return {
      siteName: process.env.SITE_NAME ?? 'ICEDR',
      authLogoDataUrl: null,
    };
  }

  private defaultOAuthSettings(): OAuthSettings {
    const redirectBase =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    return {
      enabled: false,
      providerProfile:
        this.config.get<OAuthSettings['providerProfile']>(
          'identity.providerProfile',
        ) ?? 'oidc',
      issuerUrl: this.config.get<string>('identity.issuerUrl') ?? '',
      clientId: this.config.get<string>('identity.clientId') ?? '',
      clientSecret: process.env.ICA_OAUTH_CLIENT_SECRET ?? '',
      audience: this.config.get<string>('identity.audience') ?? 'icedr-api',
      scopes:
        this.config.get<string>('identity.scopes') ?? 'openid email profile',
      redirectUri:
        this.config.get<string>('identity.redirectUri') ??
        `${redirectBase.replace(/\/$/, '')}/callback`,
    };
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
      enabled: false,
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

  private assertPasskeyOrigin(origin: string) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new BadRequestException('Passkey origin must be a valid URL');
    }
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw new BadRequestException(
        'Passkey origin must use HTTPS outside local development',
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
