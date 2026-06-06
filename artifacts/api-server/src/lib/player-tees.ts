import type { PlayerTee } from "./scoring";
import type { RoundPlayerTee } from "@workspace/db";

// The override shape accepted on the PATCH body (matches the generated RoundPlayerTee).
export type DesiredPlayerTee = {
  playerId: number;
  teeBox?: string | null;
  courseRating?: number | null;
  courseSlope?: number | null;
  par: number[];
  holeHcp: number[];
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Validate the full-replace override array against the round's trip roster.
export function validatePlayerTees(desired: DesiredPlayerTee[], tripPlayerIds: Set<number>): ValidationResult {
  const seen = new Set<number>();
  for (const t of desired) {
    if (!tripPlayerIds.has(t.playerId)) return { ok: false, error: `Player ${t.playerId} is not in this round's trip` };
    if (seen.has(t.playerId)) return { ok: false, error: `Duplicate override for player ${t.playerId}` };
    seen.add(t.playerId);
    if (!Array.isArray(t.par) || t.par.length !== 18) return { ok: false, error: `par must have 18 values for player ${t.playerId}` };
    if (!Array.isArray(t.holeHcp) || t.holeHcp.length !== 18) return { ok: false, error: `holeHcp must have 18 values for player ${t.playerId}` };
  }
  return { ok: true };
}

// Existing override playerIds that should be deleted given the desired full-replace set.
export function playerTeeIdsToDelete(existingPlayerIds: number[], desiredPlayerIds: number[]): number[] {
  const desired = new Set(desiredPlayerIds);
  return existingPlayerIds.filter(id => !desired.has(id));
}

// Map a DB override row to the API response shape (drops timestamps).
export function toApiPlayerTee(row: RoundPlayerTee) {
  return {
    playerId: row.playerId,
    teeBox: row.teeBox,
    courseRating: row.courseRating,
    courseSlope: row.courseSlope,
    par: row.par,
    holeHcp: row.holeHcp,
  };
}

// Build the sparse Map<playerId, PlayerTee> used by the scoring engine.
export function teeMapFromRows(rows: RoundPlayerTee[]): Map<number, PlayerTee> {
  const m = new Map<number, PlayerTee>();
  for (const r of rows) {
    const par = r.par as number[];
    m.set(r.playerId, {
      par,
      holeHcp: r.holeHcp as number[],
      course: { slope: r.courseSlope, rating: r.courseRating, totalPar: par.reduce((a, b) => a + b, 0) },
    });
  }
  return m;
}
