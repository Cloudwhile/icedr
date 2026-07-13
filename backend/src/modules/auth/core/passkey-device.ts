export function detectPasskeyDeviceName(userAgent?: string | null) {
  const value = userAgent?.trim() ?? '';
  if (!value) return 'Passkey';

  const platform = detectPlatform(value);
  const browser = detectBrowser(value);
  return [platform, browser].filter(Boolean).join(' · ') || 'Passkey';
}

function detectPlatform(userAgent: string) {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iPhone / iPad';
  if (/android/i.test(userAgent)) return 'Android';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/macintosh|mac os x/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return '';
}

function detectBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) {
    return 'Chrome';
  }
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (
    /safari\//i.test(userAgent) &&
    !/chrome|chromium|android/i.test(userAgent)
  ) {
    return 'Safari';
  }
  return '';
}
