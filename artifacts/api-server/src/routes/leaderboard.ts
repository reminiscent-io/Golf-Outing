import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, roundsTable, playersTable, scoresTable, tripsTable, roundGroupAssignmentsTable, scrambleScoresTable } from "@workspace/db";
import {
  GetRoundLeaderboardParams,
  GetRoundLeaderboardResponse,
  GetTripLeaderboardParams,
  GetTripLeaderboardResponse,
} from "@workspace/api-zod";
import { computePlayerStats, computeSkins, computeTeamNassau, fieldMinHandicap, computeScramble } from "../lib/scoring";
import type { ScrambleType, ScrambleTeamSide } from "../lib/scoring";

const router: IRouter = Router();

router.get("/trips/:tripId/rounds/:roundId/leaderboard", async (req, res): Promise<void> => {
  const params = GetRoundLeaderboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { tripId, roundId } = params.data;

  const [round] = await db.select().from(roundsTable)
    .where(and(eq(roundsTable.id, roundId), eq(roundsTable.tripId, tripId)));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }

  const players = await db.select().from(playersTable).where(eq(playersTable.tripId, tripId));
  const scoreRows = await db.select().from(scoresTable).where(eq(scoresTable.roundId, roundId));

  const par = round.par as number[];
  const holeHcp = round.holeHcp as number[];

  const allHoleScoresMap = new Map<number, (number | null)[]>();
  scoreRows.forEach(s => {
    allHoleScoresMap.set(s.playerId, s.holeScores as (number | null)[]);
  });

  const minHcp = fieldMinHandicap(players);
  const mode = (round.handicapMode ?? "net") as "net" | "gross";
  const course = {
    slope: round.courseSlope,
    rating: round.courseRating,
    totalPar: par.reduce((a, b) => a + b, 0),
  };
  const stats = players.map(p => {
    const holeScores = allHoleScoresMap.get(p.id) || Array(18).fill(null);
    return computePlayerStats(p, holeScores, par, holeHcp, minHcp, mode, course);
  });

  const { skinsWon, perHole } = computeSkins(players, allHoleScoresMap, holeHcp, minHcp, mode, course);

  const assignments = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    groupNumber: roundGroupAssignmentsTable.groupNumber,
    slotIndex: roundGroupAssignmentsTable.slotIndex,
  }).from(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, roundId));

  const playerById = new Map(players.map(p => [p.id, p]));
  const slots = assignments
    .map(a => {
      const p = playerById.get(a.playerId);
      return p ? { playerId: p.id, playerName: p.name, handicap: p.handicap, groupNumber: a.groupNumber, slotIndex: a.slotIndex } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

  const nassau = computeTeamNassau(slots, allHoleScoresMap, par, holeHcp, minHcp, mode, course);

  const gamesConfig = (round.gamesConfig ?? {}) as { scramble?: boolean; scrambleType?: ScrambleType | null };
  const scrambleType: ScrambleType | null = gamesConfig.scramble && gamesConfig.scrambleType ? gamesConfig.scrambleType : null;

  const scrambleRows = scrambleType
    ? await db.select().from(scrambleScoresTable).where(eq(scrambleScoresTable.roundId, roundId))
    : [];
  const scramble = computeScramble(
    scrambleType,
    slots,
    scrambleRows.map(r => ({
      groupNumber: r.groupNumber,
      teamSide: r.teamSide as ScrambleTeamSide,
      holeScores: r.holeScores as (number | null)[],
    }))
  );

  const entries = stats.map(s => ({
    playerId: s.playerId,
    playerName: s.playerName,
    handicap: s.handicap,
    grossTotal: s.grossTotal,
    netTotal: s.netTotal,
    stablefordTotal: s.sfTotal,
    skinsWon: skinsWon[s.playerId] || 0,
    holesPlayed: s.holesPlayed,
  }));

  const result = {
    roundId,
    entries,
    skinResults: perHole.map(h => ({
      hole: h.hole,
      winnerId: h.winnerId,
      winnerName: h.winnerName,
      carry: h.carry,
      tied: h.tied,
    })),
    nassauResult: { matches: nassau.matches },
    scrambleResult: { type: scramble.type, teams: scramble.teams },
  };

  res.json(GetRoundLeaderboardResponse.parse(result));
});

router.get("/trips/:tripId/leaderboard", async (req, res): Promise<void> => {
  const params = GetTripLeaderboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { tripId } = params.data;

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }

  const players = await db.select().from(playersTable).where(eq(playersTable.tripId, tripId));
  const rounds = await db.select().from(roundsTable).where(eq(roundsTable.tripId, tripId));

  // Aggregate per player across all rounds
  const playerTotals: Record<number, {
    roundsPlayed: number;
    totalGross: number | null;
    totalNet: number | null;
    totalStableford: number | null;
    totalSkinsWon: number;
    bestRoundGross: number | null;
  }> = {};

  players.forEach(p => {
    playerTotals[p.id] = {
      roundsPlayed: 0,
      totalGross: null,
      totalNet: null,
      totalStableford: null,
      totalSkinsWon: 0,
      bestRoundGross: null,
    };
  });

  for (const round of rounds) {
    const scoreRows = await db.select().from(scoresTable).where(eq(scoresTable.roundId, round.id));
    const par = round.par as number[];
    const holeHcp = round.holeHcp as number[];

    const allHoleScoresMap = new Map<number, (number | null)[]>();
    scoreRows.forEach(s => {
      allHoleScoresMap.set(s.playerId, s.holeScores as (number | null)[]);
    });

    const minHcp = fieldMinHandicap(players);
    const mode = (round.handicapMode ?? "net") as "net" | "gross";
    const course = {
      slope: round.courseSlope,
      rating: round.courseRating,
      totalPar: par.reduce((a, b) => a + b, 0),
    };
    const stats = players.map(p => {
      const holeScores = allHoleScoresMap.get(p.id) || Array(18).fill(null);
      return computePlayerStats(p, holeScores, par, holeHcp, minHcp, mode, course);
    });

    const { skinsWon } = computeSkins(players, allHoleScoresMap, holeHcp, minHcp, mode, course);

    stats.forEach(s => {
      if (s.holesPlayed === 0) return;
      const t = playerTotals[s.playerId];
      if (!t) return;
      t.roundsPlayed++;
      if (s.grossTotal != null) {
        t.totalGross = (t.totalGross ?? 0) + s.grossTotal;
        t.bestRoundGross = t.bestRoundGross == null ? s.grossTotal : Math.min(t.bestRoundGross, s.grossTotal);
      }
      if (s.netTotal != null) {
        t.totalNet = (t.totalNet ?? 0) + s.netTotal;
      }
      t.totalStableford = (t.totalStableford ?? 0) + s.sfTotal;
      t.totalSkinsWon += skinsWon[s.playerId] || 0;
    });
  }

  const playerSummaries = players.map(p => ({
    playerId: p.id,
    playerName: p.name,
    handicap: p.handicap,
    ...playerTotals[p.id],
  }));

  res.json(GetTripLeaderboardResponse.parse({
    tripId,
    tripName: trip.name,
    players: playerSummaries,
  }));
});

export default router;
