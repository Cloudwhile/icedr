export type EnvironmentVariables = Record<string, string | undefined>;

const setupOwnedProductionEnv = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_DBNAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_DBNAME',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'PUBLIC_SHARE_BASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
] as const;

const publicApiBaseUrlEnv = [
  'API_PUBLIC_BASE_URL',
  'VITE_API_BASE_URL',
  'NEXT_PUBLIC_API_BASE_URL',
] as const;

const forbiddenProductionBooleans = [
  'ALLOW_DEV_MEMORY_STORE',
  'SEED_DEMO_DATA',
] as const;

const urlEnv = [
  'API_CORS_ORIGIN',
  'API_PUBLIC_BASE_URL',
  'VITE_API_BASE_URL',
  'NEXT_PUBLIC_API_BASE_URL',
  'MINIO_METRICS_ENDPOINT',
  'S3_ENDPOINT',
  'PUBLIC_SHARE_BASE_URL',
] as const;

const publicUrlEnv = [
  'API_CORS_ORIGIN',
  'API_PUBLIC_BASE_URL',
  'VITE_API_BASE_URL',
  'NEXT_PUBLIC_API_BASE_URL',
  'PUBLIC_SHARE_BASE_URL',
] as const;

const portEnv = [
  'API_PORT',
  'PORT',
  'DATABASE_PORT',
  'REDIS_PORT',
  'SMTP_PORT',
] as const;

const placeholderEnv = [
  ...setupOwnedProductionEnv,
  ...publicApiBaseUrlEnv,
  'SHARE_EMAIL_PROVIDER',
] as const;

const genericPlaceholders = new Set([
  '...',
  '<value>',
  'changeme',
  'change-me',
  'replace-me',
  'your-provider',
  'your-value',
  'example',
  'example-value',
]);

const sensitivePlaceholders = new Set([
  'password',
  'secret',
  'token',
  'key',
  'admin',
  'user',
  'test',
  '123456',
]);

export function getAppEnv(env: EnvironmentVariables = process.env) {
  return env.APP_ENV ?? env.NODE_ENV ?? 'development';
}

export function isProductionEnv(env: EnvironmentVariables = process.env) {
  return getAppEnv(env) === 'production' || env.NODE_ENV === 'production';
}

export function validateProductionEnv(env: EnvironmentVariables = process.env) {
  if (!isProductionEnv(env)) return;

  const errors: string[] = [];

  for (const name of forbiddenProductionBooleans) {
    if (readBooleanFlag(env[name])) {
      errors.push(`${name} must not be true in production`);
    }
  }

  if (normalize(env.SHARE_EMAIL_PROVIDER) === 'dev-log') {
    errors.push('SHARE_EMAIL_PROVIDER=dev-log is not allowed in production');
  }

  if (env.SMTP_ENABLED !== undefined && !readBooleanFlag(env.SMTP_ENABLED)) {
    errors.push('SMTP_ENABLED must not disable mail delivery in production');
  }

  for (const name of placeholderEnv) {
    const value = env[name];
    if (hasValue(value) && isPlaceholderValue(name, value)) {
      errors.push(`${name} must not use an example or placeholder value`);
    }
  }

  for (const name of urlEnv) {
    const value = env[name];
    if (hasValue(value) && !isHttpUrl(value)) {
      errors.push(`${name} must be a valid HTTP(S) URL`);
    }
  }

  for (const name of publicUrlEnv) {
    const value = env[name];
    if (hasValue(value) && isLocalhostUrl(value)) {
      errors.push(`${name} must not point to localhost in production`);
    }
  }

  for (const name of portEnv) {
    const value = env[name];
    if (hasValue(value) && !isPort(value)) {
      errors.push(`${name} must be a valid TCP port`);
    }
  }

  if (hasValue(env.SMTP_FROM_EMAIL) && !isEmailAddress(env.SMTP_FROM_EMAIL)) {
    errors.push('SMTP_FROM_EMAIL must be a valid email address');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid production environment: ${errors.join('; ')}`);
  }
}

function hasValue(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function readBooleanFlag(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(normalize(value));
}

function isPlaceholderValue(name: string, value: string) {
  const normalized = normalize(value);
  if (genericPlaceholders.has(normalized)) return true;
  if (normalized.includes('<') || normalized.includes('>')) return true;
  if (normalized.startsWith('your-') || normalized.startsWith('replace-')) {
    return true;
  }
  if (hasExampleHostname(value)) return true;
  if (isSensitiveName(name) && sensitivePlaceholders.has(normalized)) {
    return true;
  }
  return false;
}

function isSensitiveName(name: string) {
  return (
    name.includes('PASSWORD') ||
    name.includes('SECRET') ||
    name.includes('ACCESS_KEY') ||
    name.endsWith('_USER') ||
    name.endsWith('_USERNAME')
  );
}

function hasExampleHostname(value: string) {
  const normalized = normalize(value);
  let domain = normalized;
  if (normalized.includes('@')) {
    domain = normalized.split('@').pop() ?? '';
  } else {
    try {
      const url = new URL(value);
      domain = url.hostname.toLowerCase();
    } catch {
      domain = normalized;
    }
  }
  return isExampleDomain(domain);
}

function isExampleDomain(domain: string) {
  return ['example.com', 'example.net', 'example.org'].some(
    (exampleDomain) =>
      domain === exampleDomain || domain.endsWith(`.${exampleDomain}`),
  );
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalhostUrl(value: string) {
  try {
    const url = new URL(value);
    return isLocalhostHostname(url.hostname);
  } catch {
    return isLocalhostHostname(normalize(value));
  }
}

function isLocalhostHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  );
}

function isPort(value: string) {
  if (!/^\d+$/.test(value.trim())) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
