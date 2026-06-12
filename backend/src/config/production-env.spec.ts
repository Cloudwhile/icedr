import configuration from './configuration';
import {
  validateProductionEnv,
  type EnvironmentVariables,
} from './production-env';

const validProductionEnv: EnvironmentVariables = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
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
      }),
    ).not.toThrow();
  });

  it('allows SMTP to stay disabled in production', () => {
    expect(() =>
      validateProductionEnv({
        NODE_ENV: 'production',
        APP_ENV: 'production',
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
