import { randomBytes } from "node:crypto";

/** The minimal player-row shape the claim guard reasons about. */
export type ClaimRow = {
  userId: number | null;
  invitedPhone: string | null;
  claimCode: string | null;
};

/**
 * THE security boundary. A row may be claimed by a caller's verified phone iff it is
 * unclaimed AND either open (no tag) or tagged to exactly that phone.
 */
export function isClaimableByPhone(row: ClaimRow, callerPhone: string): boolean {
  if (row.userId !== null) return false;
  return row.invitedPhone === null || row.invitedPhone === callerPhone;
}

/** A row may be claimed via a share code iff it is unclaimed and the code matches exactly. */
export function isClaimableByCode(row: ClaimRow, code: string | null | undefined): boolean {
  if (row.userId !== null) return false;
  if (!code) return false;
  return row.claimCode !== null && row.claimCode === code;
}

/** Combined authorization used by the claim endpoint. */
export function canClaim(row: ClaimRow, opts: { callerPhone: string; code?: string | null }): boolean {
  return isClaimableByPhone(row, opts.callerPhone) || isClaimableByCode(row, opts.code);
}

/** Unguessable, URL-safe, single-use share token. */
export function generateClaimCode(): string {
  return randomBytes(18).toString("base64url");
}

/** Strip server-side-only fields so a player row is never leaked to clients. */
export function publicPlayer<T extends Record<string, unknown>>(
  row: T,
): Omit<T, "invitedPhone" | "claimCode"> {
  const rest = { ...row };
  delete (rest as Record<string, unknown>).invitedPhone;
  delete (rest as Record<string, unknown>).claimCode;
  return rest as Omit<T, "invitedPhone" | "claimCode">;
}
