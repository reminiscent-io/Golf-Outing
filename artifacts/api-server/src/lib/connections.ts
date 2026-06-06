/** One co-player participation row (a placeholder/account assigned to a round I played). */
export type CoPlayerRow = {
  playerId: number;
  roundId: number;
  tripId: number | null;
  userId: number | null;
  name: string;                 // players.name (placeholder label)
  userFullName: string | null;  // linked user's profile name, when userId is set
  invitedPhone: string | null;  // SERVER-SIDE ONLY — used as a grouping key, never emitted
  hasInvite: boolean;           // a claim_code exists on the row
};

export type ConnectionAccount = {
  userId: number;
  name: string;
  sharedRounds: number;
};

export type ConnectionPending = {
  id: string;          // synthetic, PII-free client key
  name: string;
  tripId: number | null; // representative row's trip; phone-less groups are single-trip so this is unambiguous
  hasPhone: boolean;
  hasInvite: boolean;
  playerIds: number[];
  sharedRounds: number;
};

export type ConnectionsResult = {
  accounts: ConnectionAccount[];
  pending: ConnectionPending[];
};

export function groupConnections(rows: CoPlayerRow[]): ConnectionsResult {
  const accounts = new Map<number, { name: string; rounds: Set<number> }>();
  const pending = new Map<string, {
    name: string; tripId: number | null; hasPhone: boolean; hasInvite: boolean;
    playerIds: Set<number>; rounds: Set<number>; minPlayerId: number;
  }>();

  for (const r of rows) {
    if (r.userId !== null) {
      const a = accounts.get(r.userId) ?? { name: r.userFullName ?? r.name, rounds: new Set<number>() };
      a.rounds.add(r.roundId);
      accounts.set(r.userId, a);
      continue;
    }
    // Pending: group by phone when present, else by (tripId, lowercased name).
    // Solo (tripId null) without a phone stays per-row so distinct people never merge.
    const key = r.invitedPhone
      ? `phone:${r.invitedPhone}`
      : r.tripId === null
        ? `solo:${r.playerId}`
        : `trip:${r.tripId}:name:${r.name.trim().toLowerCase()}`;
    const p = pending.get(key) ?? {
      name: r.name, tripId: r.tripId, hasPhone: r.invitedPhone !== null, hasInvite: false,
      playerIds: new Set<number>(), rounds: new Set<number>(), minPlayerId: r.playerId,
    };
    p.playerIds.add(r.playerId);
    p.rounds.add(r.roundId);
    p.hasInvite = p.hasInvite || r.hasInvite;
    // Anchor the display name + trip to the lowest-playerId row, so id/name/tripId form a
    // consistent representative regardless of query row order (the connections query has no
    // ORDER BY, and a phone-grouped person can carry different placeholder names per trip).
    if (r.playerId < p.minPlayerId) {
      p.minPlayerId = r.playerId;
      p.name = r.name;
      p.tripId = r.tripId;
    }
    pending.set(key, p);
  }

  return {
    accounts: [...accounts.entries()]
      .map(([userId, a]) => ({ userId, name: a.name, sharedRounds: a.rounds.size }))
      .sort((x, y) => y.sharedRounds - x.sharedRounds || x.userId - y.userId),
    pending: [...pending.values()]
      .map(p => ({
        id: `pending:${p.minPlayerId}`,
        name: p.name,
        tripId: p.tripId,
        hasPhone: p.hasPhone,
        hasInvite: p.hasInvite,
        playerIds: [...p.playerIds].sort((a, b) => a - b),
        sharedRounds: p.rounds.size,
      }))
      .sort((x, y) => y.sharedRounds - x.sharedRounds || x.playerIds[0]! - y.playerIds[0]!),
  };
}
