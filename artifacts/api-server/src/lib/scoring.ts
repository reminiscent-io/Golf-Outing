export function strokesOnHole(playerHcp: number, holeHcpIdx: number): number {
  const h = Number(playerHcp) || 0;
  let strokes = 0;
  if (h >= holeHcpIdx) strokes += 1;
  if (h >= 18 + holeHcpIdx) strokes += 1;
  if (h >= 36 + holeHcpIdx) strokes += 1;
  return strokes;
}

export type HandicapMode = "net" | "gross";

export type CourseInputs = {
  slope?: number | null;
  rating?: number | null;
  totalPar?: number | null;
};

// WHS Course Handicap = Index × (Slope/113) + (Course Rating − Par), rounded.
// When slope/rating aren't supplied, falls back to a straight rounded index.
export function whsCourseHandicap(handicapIndex: number, course: CourseInputs = {}): number {
  const idx = Number(handicapIndex) || 0;
  const slopeAdjust = (course.slope ?? 113) / 113;
  const ratingDiff = (course.rating != null && course.totalPar != null)
    ? (course.rating - course.totalPar)
    : 0;
  return Math.round(idx * slopeAdjust + ratingDiff);
}

export function fieldMinHandicap(players: { handicap: number }[]): number {
  if (players.length === 0) return 0;
  return Math.min(...players.map(p => Number(p.handicap) || 0));
}

// Resolve the playing handicap used for per-hole stroke allocation. In "net"
// mode each player's WHS Course Handicap is collapsed against a reference
// minimum (typically the lowest handicap in their group) so that low
// handicap plays scratch; in "gross" mode every player plays their full
// Course Handicap.
export function effectiveHandicap(
  playerHcp: number,
  refMinHcp: number,
  mode: HandicapMode,
  course: CourseInputs = {}
): number {
  const ch = whsCourseHandicap(playerHcp, course);
  if (mode === "gross") return Math.max(0, ch);
  const minCh = whsCourseHandicap(refMinHcp, course);
  return Math.max(0, ch - minCh);
}

// Build a map of playerId -> reference minimum handicap. For each player
// assigned to a group, the reference is the lowest handicap in that group;
// for players not assigned to any group, the reference falls back to the
// field-wide minimum.
export function buildPlayerMinHcp(
  players: { id: number; handicap: number }[],
  assignments: { playerId: number; groupNumber: number }[]
): Map<number, number> {
  const playerById = new Map(players.map(p => [p.id, p]));
  const groupMin = new Map<number, number>();
  for (const a of assignments) {
    const p = playerById.get(a.playerId);
    if (!p) continue;
    const h = Number(p.handicap) || 0;
    const cur = groupMin.get(a.groupNumber);
    if (cur == null || h < cur) groupMin.set(a.groupNumber, h);
  }
  const fieldMin = fieldMinHandicap(players);
  const playerGroup = new Map(assignments.map(a => [a.playerId, a.groupNumber]));
  const result = new Map<number, number>();
  for (const p of players) {
    const grp = playerGroup.get(p.id);
    const min = grp != null ? groupMin.get(grp) ?? fieldMin : fieldMin;
    result.set(p.id, min);
  }
  return result;
}

export function netForHole(gross: number | null, playerHcp: number, holeHcpIdx: number): number | null {
  if (gross == null) return null;
  return gross - strokesOnHole(playerHcp, holeHcpIdx);
}

export function stablefordPoints(net: number | null, par: number): number {
  if (net == null) return 0;
  const diff = net - par;
  if (diff <= -3) return 5;
  if (diff === -2) return 4;
  if (diff === -1) return 3;
  if (diff === 0) return 2;
  if (diff === 1) return 1;
  return 0;
}

export type PlayerRoundStats = {
  playerId: number;
  playerName: string;
  handicap: number;
  grossHoles: (number | null)[];
  netHoles: (number | null)[];
  sfPointsHoles: (number | null)[];
  grossOut: number;
  grossIn: number;
  grossTotal: number | null;
  netOut: number;
  netIn: number;
  netTotal: number | null;
  sfTotal: number;
  holesPlayed: number;
  complete: boolean;
};

export type HoleScore = { playerId: number; holeScores: (number | null)[] };

export function computePlayerStats(
  player: { id: number; name: string; handicap: number },
  holeScores: (number | null)[],
  par: number[],
  holeHcp: number[],
  refMinHcp: number = 0,
  mode: HandicapMode = "net",
  course: CourseInputs = {}
): PlayerRoundStats {
  const grossHoles: (number | null)[] = [];
  const netHoles: (number | null)[] = [];
  const sfPointsHoles: (number | null)[] = [];
  let grossOut = 0, grossIn = 0;
  let netOut = 0, netIn = 0;
  let sfTotal = 0;
  let holesPlayed = 0;
  let hasGross = false;
  const playingHcp = effectiveHandicap(player.handicap, refMinHcp, mode, course);

  for (let h = 0; h < 18; h++) {
    const g = holeScores[h] ?? null;
    if (g != null) {
      const n = g - strokesOnHole(playingHcp, holeHcp[h]);
      const sf = stablefordPoints(n, par[h]);
      grossHoles[h] = g;
      netHoles[h] = n;
      sfPointsHoles[h] = sf;
      sfTotal += sf;
      if (h < 9) { grossOut += g; netOut += n; }
      else { grossIn += g; netIn += n; }
      holesPlayed++;
      hasGross = true;
    } else {
      grossHoles[h] = null;
      netHoles[h] = null;
      sfPointsHoles[h] = null;
    }
  }

  const front9Complete = grossHoles.slice(0, 9).every(g => g != null);
  const back9Complete = grossHoles.slice(9).every(g => g != null);
  const complete = holesPlayed === 18;

  return {
    playerId: player.id,
    playerName: player.name,
    handicap: player.handicap,
    grossHoles,
    netHoles,
    sfPointsHoles,
    grossOut,
    grossIn,
    grossTotal: hasGross ? grossOut + grossIn : null,
    netOut,
    netIn,
    netTotal: complete ? netOut + netIn : null,
    sfTotal,
    holesPlayed,
    complete,
  };
}

export type SkinHoleResult = {
  hole: number;
  winnerId: number | null;
  winnerName: string | null;
  carry: number;
  tied: boolean;
};

export function computeSkins(
  players: { id: number; name: string; handicap: number }[],
  allHoleScores: Map<number, (number | null)[]>,
  holeHcp: number[],
  minHcpByPlayer: Map<number, number> = new Map(),
  mode: HandicapMode = "net",
  course: CourseInputs = {}
): { skinsWon: Record<number, number>; perHole: SkinHoleResult[] } {
  const skinsWon: Record<number, number> = {};
  players.forEach(p => { skinsWon[p.id] = 0; });
  let carry = 1;
  const perHole: SkinHoleResult[] = [];
  const playingHcps = new Map<number, number>(
    players.map(p => [p.id, effectiveHandicap(p.handicap, minHcpByPlayer.get(p.id) ?? 0, mode, course)])
  );

  for (let h = 0; h < 18; h++) {
    const entries = players.map(p => {
      const scores = allHoleScores.get(p.id) || [];
      const g = scores[h] ?? null;
      if (g == null) return null;
      return { id: p.id, name: p.name, net: g - strokesOnHole(playingHcps.get(p.id) ?? 0, holeHcp[h]) };
    }).filter((e): e is { id: number; name: string; net: number } => e != null);

    if (entries.length < 2) {
      perHole.push({ hole: h + 1, winnerId: null, winnerName: null, carry, tied: false });
      continue;
    }

    const low = Math.min(...entries.map(e => e.net));
    const winners = entries.filter(e => e.net === low);
    if (winners.length === 1) {
      skinsWon[winners[0].id] = (skinsWon[winners[0].id] || 0) + carry;
      perHole.push({ hole: h + 1, winnerId: winners[0].id, winnerName: winners[0].name, carry, tied: false });
      carry = 1;
    } else {
      perHole.push({ hole: h + 1, winnerId: null, winnerName: null, carry, tied: true });
      carry += 1;
    }
  }

  return { skinsWon, perHole };
}

export type TeamNassauSlot = {
  playerId: number;
  playerName: string;
  handicap: number;
  groupNumber: number;
  slotIndex: number; // 1..4
};

export type TeamNassauMatch = {
  groupNumber: number;
  teamA: number;
  teamB: number;
  teamAPlayerIds: number[];
  teamBPlayerIds: number[];
  front: "A" | "B" | "halved" | null;
  back: "A" | "B" | "halved" | null;
  total: "A" | "B" | "halved" | null;
  frontMargin: number;
  backMargin: number;
  totalMargin: number;
};

export function computeTeamNassau(
  slots: TeamNassauSlot[],
  allHoleScores: Map<number, (number | null)[]>,
  _par: number[],
  holeHcp: number[],
  mode: HandicapMode,
  course: CourseInputs
): { matches: TeamNassauMatch[] } {
  // Group slots by group number.
  const byGroup = new Map<number, TeamNassauSlot[]>();
  for (const s of slots) {
    const arr = byGroup.get(s.groupNumber) ?? [];
    arr.push(s);
    byGroup.set(s.groupNumber, arr);
  }

  // In net mode each group's lowest handicap plays scratch within that group.
  const groupMinHcp = new Map<number, number>();
  for (const [g, ss] of byGroup) {
    groupMinHcp.set(g, Math.min(...ss.map(s => Number(s.handicap) || 0)));
  }

  const playingHcp = new Map<number, number>();
  for (const s of slots) {
    const min = groupMinHcp.get(s.groupNumber) ?? 0;
    playingHcp.set(s.playerId, effectiveHandicap(s.handicap, min, mode, course));
  }

  // For each hole, each player's score in the chosen mode (net or gross).
  function playerHoleScore(playerId: number, h: number): number | null {
    const g = (allHoleScores.get(playerId) ?? [])[h] ?? null;
    if (g == null) return null;
    if (mode === "gross") return g;
    return g - strokesOnHole(playingHcp.get(playerId) ?? 0, holeHcp[h]);
  }

  // Best-ball for a set of player ids on hole h — min of their scores, ignoring nulls.
  function teamHoleScore(ids: number[], h: number): number | null {
    let best: number | null = null;
    for (const id of ids) {
      const s = playerHoleScore(id, h);
      if (s == null) continue;
      if (best == null || s < best) best = s;
    }
    return best;
  }

  const matches: TeamNassauMatch[] = [];

  for (const groupNumber of [...byGroup.keys()].sort((a, b) => a - b)) {
    const groupSlots = byGroup.get(groupNumber)!;
    const teamA = (groupNumber - 1) * 2 + 1;
    const teamB = (groupNumber - 1) * 2 + 2;
    const teamAPlayerIds = groupSlots.filter(s => s.slotIndex <= 2).map(s => s.playerId);
    const teamBPlayerIds = groupSlots.filter(s => s.slotIndex >= 3).map(s => s.playerId);

    // Activity rule: both sides must have at least one player.
    if (teamAPlayerIds.length === 0 || teamBPlayerIds.length === 0) continue;

    let frontA = 0, frontB = 0;
    let backA = 0, backB = 0;
    let frontHolesScored = 0, backHolesScored = 0;

    for (let h = 0; h < 18; h++) {
      const a = teamHoleScore(teamAPlayerIds, h);
      const b = teamHoleScore(teamBPlayerIds, h);
      if (a == null || b == null) continue;
      const aWins = a < b;
      const bWins = b < a;
      if (h < 9) {
        frontHolesScored++;
        if (aWins) frontA++;
        else if (bWins) frontB++;
      } else {
        backHolesScored++;
        if (aWins) backA++;
        else if (bWins) backB++;
      }
    }

    const decide = (aWins: number, bWins: number, scored: number): { side: "A" | "B" | "halved" | null; margin: number } => {
      if (scored === 0) return { side: null, margin: 0 };
      if (aWins > bWins) return { side: "A", margin: aWins - bWins };
      if (bWins > aWins) return { side: "B", margin: bWins - aWins };
      return { side: "halved", margin: 0 };
    };

    const frontOutcome = decide(frontA, frontB, frontHolesScored);
    const backOutcome = decide(backA, backB, backHolesScored);
    const totalOutcome = decide(frontA + backA, frontB + backB, frontHolesScored + backHolesScored);

    matches.push({
      groupNumber,
      teamA,
      teamB,
      teamAPlayerIds,
      teamBPlayerIds,
      front: frontOutcome.side,
      back: backOutcome.side,
      total: totalOutcome.side,
      frontMargin: frontOutcome.margin,
      backMargin: backOutcome.margin,
      totalMargin: totalOutcome.margin,
    });
  }

  return { matches };
}
