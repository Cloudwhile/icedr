export type ShareExpiryValidation = {
  error: "below-minimum" | "over-limit" | "required" | null;
  value: number | null;
};

export function validateShareExpiryDays(
  input: string,
  maxDays: number,
): ShareExpiryValidation {
  const normalized = input.trim();
  if (!normalized) return { error: "required", value: null };
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < 1) {
    return { error: "below-minimum", value: null };
  }
  if (value > maxDays) return { error: "over-limit", value: null };
  return { error: null, value };
}
