// E.164 normalization: drop spaces/dashes/parens, ensure leading '+'
export function normalizePhone(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned) return null;
  const withPlus = cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
  // Must be + followed by 8 to 15 digits per E.164.
  if (!/^\+\d{8,15}$/.test(withPlus)) return null;
  return withPlus;
}
