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

// A player's complete tee card for scoring (own par/holeHcp + course inputs).
export type PlayerTee = {
  par: number[];        // length 18
  holeHcp: number[];    // length 18
  course: CourseInputs; // { slope, rating, totalPar }
};

export type ResolvedHandicap = { courseHandicap: number; playingHandicap: number };

// Compute each player's WHS Course Handicap from THEIR OWN tee, then the
// group-relative reference minimum (lowest Course Handicap within the player's
// assigned group; field-min Course Handicap for ungrouped players), and the
// resulting playing handicap used for per-hole stroke allocation:
//   net   => max(0, ownCH - refMinCH)
//   gross => max(0, ownCH)
// For a round with no overrides this reproduces the legacy result exactly,
// because round() is monotonic so min(round(h*k+c)) == round(min(h)*k+c).
export function resolvePlayingHandicaps(
  players: { id: number; handicap: number }[],
  teeByPlayer: Map<number, PlayerTee>,
  defaultTee: PlayerTee,
  assignments: { playerId: number; groupNumber: number }[],
  mode: HandicapMode
): Map<number, ResolvedHandicap> {
  const chById = new Map<number, number>();
  for (const p of players) {
    const tee = teeByPlayer.get(p.id) ?? defaultTee;
    chById.set(p.id, whsCourseHandicap(p.handicap, tee.course));
  }
  const groupMinCh = new Map<number, number>();
  for (const a of assignments) {
    const ch = chById.get(a.playerId);
    if (ch == null) continue;
    const cur = groupMinCh.get(a.groupNumber);
    if (cur == null || ch < cur) groupMinCh.set(a.groupNumber, ch);
  }
  const allCh = players.map(p => chById.get(p.id) ?? 0);
  const fieldMinCh = allCh.length ? Math.min(...allCh) : 0;
  const playerGroup = new Map(assignments.map(a => [a.playerId, a.groupNumber]));
  const result = new Map<number, ResolvedHandicap>();
  for (const p of players) {
    const ch = chById.get(p.id) ?? 0;
    const grp = playerGroup.get(p.id);
    const refMin = grp != null ? (groupMinCh.get(grp) ?? fieldMinCh) : fieldMinCh;
    const playing = mode === "gross" ? Math.max(0, ch) : Math.max(0, ch - refMin);
    result.set(p.id, { courseHandicap: ch, playingHandicap: playing });
  }
  return result;
}

export function fieldMinHandicap(players: { handicap: number }[]): number {
  if (players.length === 0) return 0;
  return Math.min(...players.map(p => Number(p.handicap) || 0));
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
  playingHandicap: number
): PlayerRoundStats {
  const grossHoles: (number | null)[] = [];
  const netHoles: (number | null)[] = [];
  const sfPointsHoles: (number | null)[] = [];
  let grossOut = 0, grossIn = 0;
  let netOut = 0, netIn = 0;
  let sfTotal = 0;
  let holesPlayed = 0;
  let hasGross = false;
  const playingHcp = playingHandicap;

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
  holeHcpByPlayer: Map<number, number[]>,
  playingHcpByPlayer: Map<number, number>
): { skinsWon: Record<number, number>; perHole: SkinHoleResult[] } {
  const skinsWon: Record<number, number> = {};
  players.forEach(p => { skinsWon[p.id] = 0; });
  let carry = 1;
  const perHole: SkinHoleResult[] = [];

  for (let h = 0; h < 18; h++) {
    const entries = players.map(p => {
      const scores = allHoleScores.get(p.id) || [];
      const g = scores[h] ?? null;
      if (g == null) return null;
      const ownHoleHcp = holeHcpByPlayer.get(p.id) ?? [];
      return { id: p.id, name: p.name, net: g - strokesOnHole(playingHcpByPlayer.get(p.id) ?? 0, ownHoleHcp[h] ?? (h + 1)) };
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
  holeHcpByPlayer: Map<number, number[]>,
  playingHcpByPlayer: Map<number, number>,
  mode: HandicapMode
): { matches: TeamNassauMatch[] } {
  // Group slots by group number.
  const byGroup = new Map<number, TeamNassauSlot[]>();
  for (const s of slots) {
    const arr = byGroup.get(s.groupNumber) ?? [];
    arr.push(s);
    byGroup.set(s.groupNumber, arr);
  }

  // For each hole, each player's score in the chosen mode (net or gross).
  function playerHoleScore(playerId: number, h: number): number | null {
    const g = (allHoleScores.get(playerId) ?? [])[h] ?? null;
    if (g == null) return null;
    if (mode === "gross") return g;
    const ownHoleHcp = holeHcpByPlayer.get(playerId) ?? [];
    return g - strokesOnHole(playingHcpByPlayer.get(playerId) ?? 0, ownHoleHcp[h] ?? (h + 1));
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

export type ScrambleType = "fourMan" | "twoMan";
export type ScrambleTeamSide = "A" | "B" | "G";

export type ScrambleTeamScoreInput = {
  groupNumber: number;
  teamSide: ScrambleTeamSide;
  holeScores: (number | null)[];
};

export type ScrambleTeamResult = {
  groupNumber: number;
  teamSide: ScrambleTeamSide;
  playerIds: number[];
  playerNames: string[];
  holeScores: (number | null)[];
  grossOut: number | null;
  grossIn: number | null;
  grossTotal: number | null;
  holesPlayed: number;
};

// Resolve scramble teams from group assignments + scramble type. Returns the
// expected (groupNumber, teamSide) pairs and the players that compose each.
export function listScrambleTeams(
  type: ScrambleType,
  slots: { playerId: number; playerName: string; groupNumber: number; slotIndex: number }[]
): { groupNumber: number; teamSide: ScrambleTeamSide; playerIds: number[]; playerNames: string[] }[] {
  const byGroup = new Map<number, typeof slots>();
  for (const s of slots) {
    const arr = byGroup.get(s.groupNumber) ?? [];
    arr.push(s);
    byGroup.set(s.groupNumber, arr);
  }

  const teams: { groupNumber: number; teamSide: ScrambleTeamSide; playerIds: number[]; playerNames: string[] }[] = [];
  for (const groupNumber of [...byGroup.keys()].sort((a, b) => a - b)) {
    const groupSlots = byGroup.get(groupNumber)!;
    if (type === "fourMan") {
      teams.push({
        groupNumber,
        teamSide: "G",
        playerIds: groupSlots.map(s => s.playerId),
        playerNames: groupSlots.map(s => s.playerName),
      });
    } else {
      const teamA = groupSlots.filter(s => s.slotIndex <= 2);
      const teamB = groupSlots.filter(s => s.slotIndex >= 3);
      if (teamA.length > 0) {
        teams.push({
          groupNumber,
          teamSide: "A",
          playerIds: teamA.map(s => s.playerId),
          playerNames: teamA.map(s => s.playerName),
        });
      }
      if (teamB.length > 0) {
        teams.push({
          groupNumber,
          teamSide: "B",
          playerIds: teamB.map(s => s.playerId),
          playerNames: teamB.map(s => s.playerName),
        });
      }
    }
  }
  return teams;
}

export function computeScramble(
  type: ScrambleType | null | undefined,
  slots: { playerId: number; playerName: string; groupNumber: number; slotIndex: number }[],
  scoreRows: ScrambleTeamScoreInput[]
): { type: ScrambleType | null; teams: ScrambleTeamResult[] } {
  if (!type) return { type: null, teams: [] };

  const scoresKey = (g: number, s: ScrambleTeamSide) => `${g}:${s}`;
  const scoresByKey = new Map<string, (number | null)[]>();
  for (const row of scoreRows) {
    scoresByKey.set(scoresKey(row.groupNumber, row.teamSide), row.holeScores);
  }

  const teams = listScrambleTeams(type, slots);
  const results: ScrambleTeamResult[] = teams.map(t => {
    const stored = scoresByKey.get(scoresKey(t.groupNumber, t.teamSide)) ?? Array(18).fill(null);
    const holeScores: (number | null)[] = [];
    let grossOut = 0, grossIn = 0;
    let outAny = false, inAny = false;
    let holesPlayed = 0;
    for (let h = 0; h < 18; h++) {
      const v = stored[h] ?? null;
      holeScores[h] = v;
      if (v != null) {
        holesPlayed++;
        if (h < 9) { grossOut += v; outAny = true; }
        else { grossIn += v; inAny = true; }
      }
    }
    const complete = holesPlayed === 18;
    return {
      groupNumber: t.groupNumber,
      teamSide: t.teamSide,
      playerIds: t.playerIds,
      playerNames: t.playerNames,
      holeScores,
      grossOut: outAny ? grossOut : null,
      grossIn: inAny ? grossIn : null,
      grossTotal: complete ? grossOut + grossIn : (outAny || inAny ? grossOut + grossIn : null),
      holesPlayed,
    };
  });

  return { type, teams: results };
}

export type SummarizeInputs = {
  roundId: number;
  par: number[];
  holeHcp: number[];
  handicapMode: HandicapMode;
  course: CourseInputs;
  players: { id: number; name: string; handicap: number }[];
  scores: Map<number, (number | null)[]>;
  assignments: { playerId: number; groupNumber: number }[];
  playerTees?: Map<number, PlayerTee>; // sparse per-player overrides
};

export type RoundSummary = {
  leaderName: string | null;
  leaderNet: number | null;
  leaderGross: number | null;
  holesPlayed: number;
  totalHoles: number;
};

// Compact "feed-card" view of a round: who's leading by net, plus how
// many holes have been entered. Reuses computePlayerStats so the scoring
// math stays in one place.
export function summarizeRound(inputs: SummarizeInputs): RoundSummary {
  const { par, holeHcp, handicapMode, course, players, scores, assignments } = inputs;
  const defaultTee: PlayerTee = { par, holeHcp, course };
  const teeByPlayer = inputs.playerTees ?? new Map<number, PlayerTee>();
  const resolved = resolvePlayingHandicaps(players, teeByPlayer, defaultTee, assignments, handicapMode);

  let bestNet: number | null = null;
  let bestGross: number | null = null;
  let leaderId: number | null = null;
  let leaderName: string | null = null;
  let holesPlayed = 0;

  for (const p of players) {
    const holes = scores.get(p.id) ?? Array(18).fill(null);
    const tee = teeByPlayer.get(p.id) ?? defaultTee;
    const stats = computePlayerStats(p, holes, tee.par, tee.holeHcp, resolved.get(p.id)?.playingHandicap ?? 0);
    holesPlayed = Math.max(holesPlayed, stats.holesPlayed);

    // Rank by netTotal when the player has completed; otherwise skip for the leader pick.
    const candidate = stats.netTotal;
    if (candidate == null) continue;
    if (bestNet == null || candidate < bestNet || (candidate === bestNet && (leaderId == null || p.id < leaderId))) {
      bestNet = candidate;
      bestGross = stats.grossTotal;
      leaderId = p.id;
      leaderName = stats.playerName;
    }
  }

  return {
    leaderName,
    leaderNet: bestNet,
    leaderGross: bestGross,
    holesPlayed,
    totalHoles: 18,
  };
}
