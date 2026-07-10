import {
  getAppEnv,
  isProductionEnv,
  validateProductionEnv,
} from './production-env';

function readBoolean(value: string | undefined, defaultValue = false) {
  const next = readOptionalString(value);
  if (next === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(next.toLowerCase());
}

function readNumber(value: string | undefined, defaultValue: number) {
  const trimmed = readOptionalString(value);
  if (!trimmed) return defaultValue;
  const next = Number(trimmed);
  return Number.isFinite(next) ? next : defaultValue;
}

function readOptionalNumber(value: string | undefined) {
  const trimmed = readOptionalString(value);
  if (!trimmed) return null;
  const next = Number(trimmed);
  return Number.isFinite(next) && next >= 0 ? next : null;
}

function readOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readString(value: string | undefined, defaultValue = '') {
  return readOptionalString(value) ?? defaultValue;
}

function readFirstString(...values: Array<string | undefined>) {
  return values.map(readOptionalString).find(Boolean);
}

function readFirstHttpUrl(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = readOptionalString(value);
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return trimmed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function isProduction() {
  return isProductionEnv(process.env);
}

export default () => {
  validateProductionEnv(process.env);
  const apiHost = readString(process.env.API_HOST, '127.0.0.1');
  const apiPort = readNumber(
    readFirstString(process.env.API_PORT, process.env.PORT),
    13001,
  );
  const apiPublicBaseUrl =
    readFirstHttpUrl(
      process.env.API_PUBLIC_BASE_URL,
      process.env.VITE_API_BASE_URL,
      process.env.NEXT_PUBLIC_API_BASE_URL,
    ) ?? `http://${apiHost}:${apiPort}/api`;

  return {
    app: {
      env: getAppEnv(),
      production: isProduction(),
      defaultWorkspaceActor: readString(
        process.env.DEFAULT_WORKSPACE_ACTOR,
        'Workspace User',
      ),
    },
    api: {
      port: apiPort,
      host: apiHost,
      corsOrigin: readString(
        process.env.API_CORS_ORIGIN,
        'http://localhost:13000',
      ),
      publicBaseUrl: apiPublicBaseUrl,
    },
    identity: {
      providerProfile:
        process.env.ICA_OAUTH_PROVIDER_PROFILE === 'icetowne-blog'
          ? 'icetowne-blog'
          : 'oidc',
      issuerUrl: readString(process.env.ICA_OAUTH_ISSUER_URL),
      clientId: readString(process.env.ICA_OAUTH_CLIENT_ID),
      audience: readString(process.env.ICA_OAUTH_AUDIENCE, 'icedr-api'),
      scopes: readOptionalString(process.env.ICA_OAUTH_SCOPES),
      redirectUri: readOptionalString(process.env.ICA_OAUTH_REDIRECT_URI),
    },
    auth: {
      securitySecret: readString(
        process.env.AUTH_SECURITY_SECRET,
        'icedr-dev-auth-security-secret',
      ),
    },
    database: {
      host: readString(process.env.DATABASE_HOST),
      port: readNumber(process.env.DATABASE_PORT, 5432),
      dbName: readString(process.env.DATABASE_DBNAME),
      user: readString(process.env.DATABASE_USER),
      password: readString(process.env.DATABASE_PASSWORD),
      configured: Boolean(
        readOptionalString(process.env.DATABASE_HOST) &&
        readOptionalString(process.env.DATABASE_PORT) &&
        readOptionalString(process.env.DATABASE_DBNAME) &&
        readOptionalString(process.env.DATABASE_USER) &&
        readOptionalString(process.env.DATABASE_PASSWORD),
      ),
    },
    redis: {
      host: readString(process.env.REDIS_HOST),
      port: readNumber(process.env.REDIS_PORT, 6379),
      dbName: readString(process.env.REDIS_DBNAME),
      user: readString(process.env.REDIS_USER),
      password: readString(process.env.REDIS_PASSWORD),
      configured: Boolean(
        readOptionalString(process.env.REDIS_HOST) &&
        readOptionalString(process.env.REDIS_PORT) &&
        readOptionalString(process.env.REDIS_DBNAME),
      ),
    },
    storage: {
      endpoint: readString(process.env.S3_ENDPOINT),
      publicEndpoint: readString(process.env.S3_PUBLIC_ENDPOINT),
      region: readString(process.env.S3_REGION, 'us-east-1'),
      bucket: readString(process.env.S3_BUCKET, 'icedr-drive'),
      accessKeyId: readString(process.env.S3_ACCESS_KEY_ID),
      secretAccessKey: readString(process.env.S3_SECRET_ACCESS_KEY),
      forcePathStyle: readBoolean(process.env.S3_FORCE_PATH_STYLE, true),
      localRoot: readString(process.env.LOCAL_STORAGE_ROOT, 'data/local-files'),
      metricsBearerToken:
        readFirstString(
          process.env.MINIO_METRICS_BEARER_TOKEN,
          process.env.S3_METRICS_BEARER_TOKEN,
        ) ?? '',
      metricsEndpoint:
        readFirstString(
          process.env.MINIO_METRICS_ENDPOINT,
          process.env.S3_METRICS_ENDPOINT,
        ) ?? '',
      quotaBytes: readOptionalNumber(process.env.STORAGE_QUOTA_BYTES),
    },
    share: {
      publicBaseUrl:
        readFirstHttpUrl(process.env.PUBLIC_SHARE_BASE_URL) ??
        'http://localhost:13000/share/s',
      emailProvider:
        readOptionalString(process.env.SHARE_EMAIL_PROVIDER) ??
        (isProduction() ? '' : 'dev-log'),
      visitorHashSecret: readString(process.env.SHARE_VISITOR_HASH_SECRET),
      rateLimit: {
        defaultProfile: readString(
          process.env.SHARE_RATE_LIMIT_PROFILE,
          'default',
        ),
        windowSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_WINDOW_SECONDS,
          60,
        ),
        viewMax: readNumber(process.env.SHARE_RATE_LIMIT_VIEW_MAX, 120),
        viewWindowSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_VIEW_WINDOW_SECONDS,
          60,
        ),
        emailCodeMax: readNumber(
          process.env.SHARE_RATE_LIMIT_EMAIL_CODE_MAX,
          5,
        ),
        emailCodeWindowSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_EMAIL_CODE_WINDOW_SECONDS,
          600,
        ),
        emailVerifyMax: readNumber(
          process.env.SHARE_RATE_LIMIT_EMAIL_VERIFY_MAX,
          5,
        ),
        emailVerifyWindowSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_EMAIL_VERIFY_WINDOW_SECONDS,
          900,
        ),
        emailVerifyLockSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_EMAIL_VERIFY_LOCK_SECONDS,
          900,
        ),
        downloadIntentMax: readNumber(
          process.env.SHARE_RATE_LIMIT_DOWNLOAD_INTENT_MAX,
          60,
        ),
        downloadIntentWindowSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_DOWNLOAD_INTENT_WINDOW_SECONDS,
          60,
        ),
        downloadMax: readNumber(process.env.SHARE_RATE_LIMIT_DOWNLOAD_MAX, 60),
        downloadWindowSeconds: readNumber(
          process.env.SHARE_RATE_LIMIT_DOWNLOAD_WINDOW_SECONDS,
          60,
        ),
      },
    },
    mail: {
      enabled: readBoolean(
        process.env.SMTP_ENABLED,
        Boolean(readOptionalString(process.env.SMTP_HOST)),
      ),
      host: readString(process.env.SMTP_HOST),
      port: readNumber(process.env.SMTP_PORT, 587),
      secure: readBoolean(process.env.SMTP_SECURE, false),
      username: readString(process.env.SMTP_USERNAME),
      password: readString(process.env.SMTP_PASSWORD),
      fromName:
        readFirstString(process.env.SMTP_FROM_NAME, process.env.SITE_NAME) ??
        'ICEDR',
      fromEmail: readString(process.env.SMTP_FROM_EMAIL),
      replyTo: readString(process.env.SMTP_REPLY_TO),
    },
  };
};
