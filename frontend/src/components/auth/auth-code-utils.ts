const defaultAuthCodeLength = 6;

export function normalizeAuthCodeValue(value: string, length = defaultAuthCodeLength) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, length);
}
