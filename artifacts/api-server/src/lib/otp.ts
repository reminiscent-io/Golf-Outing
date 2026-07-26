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

/**
 * Redact a phone number for logging: keeps the leading country digits and the
 * last four so a support request stays traceable, hides the rest.
 * `+15551234567` → `+15*****4567`
 */
export function maskPhone(raw: string): string {
  if (typeof raw !== "string" || raw === "") return "(none)";
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 6) return `${plus}${"*".repeat(digits.length)}`;
  const head = digits.slice(0, 2);
  const tail = digits.slice(-4);
  return `${plus}${head}${"*".repeat(digits.length - 6)}${tail}`;
}
