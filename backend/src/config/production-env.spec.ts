import configuration from './configuration';
import {
  validateProductionEnv,
  type EnvironmentVariables,
} from './production-env';

const validProductionEnv: EnvironmentVariables = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  AUTH_SECURITY_SECRET: 'icedr-production-auth-security-secret-2026',
  SHARE_VISITOR_HASH_SECRET: 'icedr-production-share-visitor-hash-secret-2026',
  API_CORS_ORIGIN: 'https://drive.icedr.test',
  API_PUBLIC_BASE_URL: 'https://api.icedr.test/api',
  DATABASE_HOST: 'postgres',
  DATABASE_PORT: '5432',
  DATABASE_DBNAME: 'icedr',
  DATABASE_USER: 'icedr_app',
  DATABASE_PASSWORD: 'strong-database-password',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
  REDIS_DBNAME: '0',
  S3_ENDPOINT: 'https://s3.icedr.test',
  S3_BUCKET: 'icedr-drive',
  S3_ACCESS_KEY_ID: 'icedr-access-key',
  S3_SECRET_ACCESS_KEY: 'icedr-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  PUBLIC_SHARE_BASE_URL: 'https://drive.icedr.test/share/s',
  SHARE_EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.icedr.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'true',
  SMTP_USERNAME: 'mail-user',
  SMTP_PASSWORD: 'mail-password',
  SMTP_FROM_EMAIL: 'noreply@icedr.test',
};

describe('production environment validation', () => {
  it('allows local development settings', () => {
    expect(() =>
      validateProductionEnv({
        NODE_ENV: 'development',
        APP_ENV: 'development',
        ALLOW_DEV_MEMORY_STORE: 'true',
        SEED_DEMO_DATA: 'true',
        SHARE_EMAIL_PROVIDER: 'dev-log',
      }),
    ).not.toThrow();
  });

  it('generates one process-scoped visitor hash secret for development', () => {
    const originalEnv = process.env;
    process.env = {
      NODE_ENV: 'development',
      AUTH_SECURITY_SECRET: 'development-auth-secret',
    };

    try {
      const first = configuration();
      const second = configuration();

      expect(first.share.visitorHashSecret).toBe(
        second.share.visitorHashSecret,
      );
      expect(first.share.visitorHashSecret).toHaveLength(43);
      expect(first.share.visitorHashSecret).not.toBe(first.auth.securitySecret);
    } finally {
      process.env = originalEnv;
    }
  });

  it('maps the setup bootstrap token without generating a default', () => {
    const originalEnv = process.env;
    process.env = {
      NODE_ENV: 'development',
      SETUP_BOOTSTRAP_TOKEN: 'configured-setup-bootstrap-token-2026',
    };

    try {
      expect(configuration().setup.bootstrapToken).toBe(
        'configured-setup-bootstrap-token-2026',
      );
    } finally {
      process.env = originalEnv;
    }
  });

  it('rejects development-only flags in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        ALLOW_DEV_MEMORY_STORE: 'true',
        SEED_DEMO_DATA: 'true',
        SHARE_EMAIL_PROVIDER: 'dev-log',
      }),
    ).toThrow(/ALLOW_DEV_MEMORY_STORE.*SEED_DEMO_DATA.*SHARE_EMAIL_PROVIDER/s);
  });

  it('allows production startup before setup-owned services are configured', () => {
    expect(() =>
      validateProductionEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        AUTH_SECURITY_SECRET: validProductionEnv.AUTH_SECURITY_SECRET,
        SHARE_VISITOR_HASH_SECRET: validProductionEnv.SHARE_VISITOR_HASH_SECRET,
      }),
    ).not.toThrow();
  });

  it('allows SMTP to stay disabled in production', () => {
    expect(() =>
      validateProductionEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
        AUTH_SECURITY_SECRET: validProductionEnv.AUTH_SECURITY_SECRET,
        SHARE_VISITOR_HASH_SECRET: validProductionEnv.SHARE_VISITOR_HASH_SECRET,
        SMTP_ENABLED: 'false',
      }),
    ).not.toThrow();
  });

  it('rejects placeholder values in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        API_PUBLIC_BASE_URL: 'https://api.example.com/api',
        DATABASE_USER: 'user',
        DATABASE_PASSWORD: 'password',
        SHARE_EMAIL_PROVIDER: 'your-provider',
      }),
    ).toThrow(
      /DATABASE_USER.*DATABASE_PASSWORD.*API_PUBLIC_BASE_URL.*SHARE_EMAIL_PROVIDER/s,
    );
  });

  it('rejects example domains in email and non-url strings', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SMTP_FROM_EMAIL: 'noreply@example.org',
        SHARE_EMAIL_PROVIDER: 'smtp.example.net',
      }),
    ).toThrow(/SMTP_FROM_EMAIL.*SHARE_EMAIL_PROVIDER/s);
  });

  it('rejects malformed URLs, ports, and email addresses', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        API_CORS_ORIGIN: 'drive.icedr.test',
        REDIS_PORT: 'not-a-port',
        SMTP_FROM_EMAIL: 'noreply',
      }),
    ).toThrow(/API_CORS_ORIGIN.*REDIS_PORT.*SMTP_FROM_EMAIL/s);
  });

  it('allows same-origin browser API base URLs in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        NEXT_PUBLIC_API_BASE_URL: '/api',
        VITE_API_BASE_URL: '/api/',
      }),
    ).not.toThrow();
  });

  it('rejects malformed browser API base URLs in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        NEXT_PUBLIC_API_BASE_URL: 'api',
      }),
    ).toThrow(/NEXT_PUBLIC_API_BASE_URL/s);
  });

  it('rejects localhost or loopback IPs in public-facing URLs in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        API_PUBLIC_BASE_URL: 'http://localhost:13001/api',
        PUBLIC_SHARE_BASE_URL: 'http://[::1]:13000/share/s',
      }),
    ).toThrow(/API_PUBLIC_BASE_URL.*PUBLIC_SHARE_BASE_URL/s);
  });

  it('accepts supported share rate-limit settings in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_VISITOR_HASH_SECRET:
          'icedr-production-share-visitor-hash-secret-2026',
        SHARE_RATE_LIMIT_PROFILE: 'strict',
        SHARE_RATE_LIMIT_WINDOW_SECONDS: '60',
        SHARE_RATE_LIMIT_VIEW_MAX: '0',
        SHARE_RATE_LIMIT_VIEW_WINDOW_SECONDS: '120',
        SHARE_RATE_LIMIT_EMAIL_CODE_MAX: '5',
        SHARE_RATE_LIMIT_EMAIL_CODE_WINDOW_SECONDS: '600',
        SHARE_RATE_LIMIT_EMAIL_VERIFY_MAX: '5',
        SHARE_RATE_LIMIT_EMAIL_VERIFY_WINDOW_SECONDS: '900',
        SHARE_RATE_LIMIT_EMAIL_VERIFY_LOCK_SECONDS: '900',
        SHARE_RATE_LIMIT_DOWNLOAD_INTENT_MAX: '60',
        SHARE_RATE_LIMIT_DOWNLOAD_INTENT_WINDOW_SECONDS: '60',
        SHARE_RATE_LIMIT_DOWNLOAD_MAX: '60',
        SHARE_RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS: '60',
      }),
    ).not.toThrow();
  });

  it('rejects unsupported share rate-limit profiles in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_RATE_LIMIT_PROFILE: 'custom',
      }),
    ).toThrow(/SHARE_RATE_LIMIT_PROFILE/s);
  });

  it('rejects invalid explicit share rate-limit numbers in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_RATE_LIMIT_VIEW_MAX: '-1',
        SHARE_RATE_LIMIT_EMAIL_CODE_MAX: '1.5',
        SHARE_RATE_LIMIT_DOWNLOAD_MAX: '2147483648',
        SHARE_RATE_LIMIT_WINDOW_SECONDS: '0',
        SHARE_RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS: 'not-a-number',
      }),
    ).toThrow(
      /SHARE_RATE_LIMIT_VIEW_MAX.*SHARE_RATE_LIMIT_EMAIL_CODE_MAX.*SHARE_RATE_LIMIT_DOWNLOAD_MAX.*SHARE_RATE_LIMIT_WINDOW_SECONDS.*SHARE_RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS/s,
    );
  });

  it('rejects weak or placeholder visitor hash secrets in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_VISITOR_HASH_SECRET: 'replace-me',
      }),
    ).toThrow(/SHARE_VISITOR_HASH_SECRET/s);

    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_VISITOR_HASH_SECRET: 'short-share-secret',
      }),
    ).toThrow(/SHARE_VISITOR_HASH_SECRET.*at least 32 characters/s);
  });

  it('requires an independent visitor hash secret in production', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_VISITOR_HASH_SECRET: undefined,
      }),
    ).toThrow(/SHARE_VISITOR_HASH_SECRET.*required/s);

    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SHARE_VISITOR_HASH_SECRET: validProductionEnv.AUTH_SECURITY_SECRET,
      }),
    ).toThrow(/SHARE_VISITOR_HASH_SECRET.*must differ/s);
  });

  it('rejects unsafe setup bootstrap tokens when one is configured', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SETUP_BOOTSTRAP_TOKEN: 'short-token',
      }),
    ).toThrow(/SETUP_BOOTSTRAP_TOKEN.*at least 32 bytes/s);

    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SETUP_BOOTSTRAP_TOKEN: 'replace-me',
      }),
    ).toThrow(/SETUP_BOOTSTRAP_TOKEN.*placeholder/s);
  });

  it('requires the setup bootstrap token to differ from long-lived secrets', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SETUP_BOOTSTRAP_TOKEN: validProductionEnv.AUTH_SECURITY_SECRET,
      }),
    ).toThrow(/SETUP_BOOTSTRAP_TOKEN.*AUTH_SECURITY_SECRET/s);

    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        SETUP_BOOTSTRAP_TOKEN: validProductionEnv.SHARE_VISITOR_HASH_SECRET,
      }),
    ).toThrow(/SETUP_BOOTSTRAP_TOKEN.*SHARE_VISITOR_HASH_SECRET/s);
  });

  it('accepts complete production settings through the app configuration', () => {
    const originalEnv = process.env;
    process.env = { ...validProductionEnv };

    try {
      const config = configuration();
      expect(config.app.production).toBe(true);
      expect(config.database.configured).toBe(true);
      expect(config.redis.configured).toBe(true);
      expect(config.mail.enabled).toBe(true);
    } finally {
      process.env = originalEnv;
    }
  });

  it('rejects invalid production settings through the app configuration', () => {
    const originalEnv = process.env;
    process.env = {
      ...validProductionEnv,
      ALLOW_DEV_MEMORY_STORE: 'true',
      SHARE_EMAIL_PROVIDER: 'dev-log',
    };

    try {
      expect(() => configuration()).toThrow(
        /ALLOW_DEV_MEMORY_STORE.*SHARE_EMAIL_PROVIDER/s,
      );
    } finally {
      process.env = originalEnv;
    }
  });
});
