import {
  getAppEnv,
  isProductionEnv,
  validateProductionEnv,
} from './production-env';

function readBoolean(value: string | undefined, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumber(value: string | undefined, defaultValue: number) {
  if (!value) return defaultValue;
  const next = Number(value);
  return Number.isFinite(next) ? next : defaultValue;
}

function readOptionalNumber(value: string | undefined) {
  if (!value) return null;
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : null;
}

function isProduction() {
  return isProductionEnv(process.env);
}

export default () => {
  validateProductionEnv(process.env);

  return {
    app: {
      env: getAppEnv(),
      production: isProduction(),
      defaultWorkspaceActor:
        process.env.DEFAULT_WORKSPACE_ACTOR ?? 'Workspace User',
    },
    api: {
      port: Number(process.env.API_PORT ?? process.env.PORT ?? 13001),
      host: process.env.API_HOST ?? '127.0.0.1',
      corsOrigin: process.env.API_CORS_ORIGIN ?? 'http://localhost:13000',
      publicBaseUrl:
        process.env.API_PUBLIC_BASE_URL ??
        process.env.VITE_API_BASE_URL ??
        process.env.NEXT_PUBLIC_API_BASE_URL ??
        `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? process.env.PORT ?? 13001}/api`,
    },
    identity: {
      providerProfile:
        process.env.ICA_OAUTH_PROVIDER_PROFILE === 'icetowne-blog'
          ? 'icetowne-blog'
          : 'oidc',
      issuerUrl: process.env.ICA_OAUTH_ISSUER_URL ?? '',
      clientId: process.env.ICA_OAUTH_CLIENT_ID ?? '',
      audience: process.env.ICA_OAUTH_AUDIENCE ?? 'icedr-api',
      scopes: process.env.ICA_OAUTH_SCOPES ?? undefined,
      redirectUri: process.env.ICA_OAUTH_REDIRECT_URI ?? undefined,
    },
    database: {
      host: process.env.DATABASE_HOST ?? '',
      port: readNumber(process.env.DATABASE_PORT, 5432),
      dbName: process.env.DATABASE_DBNAME ?? '',
      user: process.env.DATABASE_USER ?? '',
      password: process.env.DATABASE_PASSWORD ?? '',
      configured: Boolean(
        process.env.DATABASE_HOST &&
        process.env.DATABASE_PORT &&
        process.env.DATABASE_DBNAME &&
        process.env.DATABASE_USER &&
        process.env.DATABASE_PASSWORD,
      ),
    },
    redis: {
      host: process.env.REDIS_HOST ?? '',
      port: readNumber(process.env.REDIS_PORT, 6379),
      dbName: process.env.REDIS_DBNAME ?? '',
      user: process.env.REDIS_USER ?? '',
      password: process.env.REDIS_PASSWORD ?? '',
      configured: Boolean(
        process.env.REDIS_HOST &&
        process.env.REDIS_PORT &&
        process.env.REDIS_DBNAME,
      ),
    },
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'icedr-drive',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      localRoot: process.env.LOCAL_STORAGE_ROOT ?? 'data/local-files',
      quotaBytes: readOptionalNumber(process.env.STORAGE_QUOTA_BYTES),
    },
    share: {
      publicBaseUrl:
        process.env.PUBLIC_SHARE_BASE_URL ?? 'http://localhost:13000/share/s',
      emailProvider:
        process.env.SHARE_EMAIL_PROVIDER ?? (isProduction() ? '' : 'dev-log'),
    },
    mail: {
      enabled: readBoolean(
        process.env.SMTP_ENABLED,
        Boolean(process.env.SMTP_HOST),
      ),
      host: process.env.SMTP_HOST ?? '',
      port: readNumber(process.env.SMTP_PORT, 587),
      secure: readBoolean(process.env.SMTP_SECURE, false),
      username: process.env.SMTP_USERNAME ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
      fromName: process.env.SMTP_FROM_NAME ?? process.env.SITE_NAME ?? 'ICEDR',
      fromEmail: process.env.SMTP_FROM_EMAIL ?? '',
      replyTo: process.env.SMTP_REPLY_TO ?? '',
    },
  };
};
