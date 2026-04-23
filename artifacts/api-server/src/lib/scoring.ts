export function strokesOnHole(playerHcp: number, holeHcpIdx: number): number {
  const h = Number(playerHcp) || 0;
  let strokes = 0;
  if (h >= holeHcpIdx) strokes += 1;
  if (h >= 18 + holeHcpIdx) strokes += 1;
  if (h >= 36 + holeHcpIdx) strokes += 1;
  return strokes;
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
  holeHcp: number[]
): PlayerRoundStats {
  const grossHoles: (number | null)[] = [];
  const netHoles: (number | null)[] = [];
  const sfPointsHoles: (number | null)[] = [];
  let grossOut = 0, grossIn = 0;
  let netOut = 0, netIn = 0;
  let sfTotal = 0;
  let holesPlayed = 0;
  let hasGross = false;

  for (let h = 0; h < 18; h++) {
    const g = holeScores[h] ?? null;
    if (g != null) {
      const n = g - strokesOnHole(player.handicap, holeHcp[h]);
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
  holeHcp: number[]
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
      return { id: p.id, name: p.name, net: g - strokesOnHole(p.handicap, holeHcp[h]) };
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

export function computeNassau(
  stats: PlayerRoundStats[]
): { frontWinnerIds: number[]; backWinnerIds: number[]; totalWinnerIds: number[] } {
  const frontPlayers = stats.filter(s => s.grossHoles.slice(0, 9).every(g => g != null));
  const backPlayers = stats.filter(s => s.grossHoles.slice(9).every(g => g != null));
  const totalPlayers = stats.filter(s => s.complete);

  let frontWinnerIds: number[] = [];
  let backWinnerIds: number[] = [];
  let totalWinnerIds: number[] = [];

  if (frontPlayers.length > 0) {
    const low = Math.min(...frontPlayers.map(s => s.netOut));
    frontWinnerIds = frontPlayers.filter(s => s.netOut === low).map(s => s.playerId);
  }
  if (backPlayers.length > 0) {
    const low = Math.min(...backPlayers.map(s => s.netIn));
    backWinnerIds = backPlayers.filter(s => s.netIn === low).map(s => s.playerId);
  }
  if (totalPlayers.length > 0) {
    const low = Math.min(...totalPlayers.map(s => s.netTotal!));
    totalWinnerIds = totalPlayers.filter(s => s.netTotal === low).map(s => s.playerId);
  }

  return { frontWinnerIds, backWinnerIds, totalWinnerIds };
}
