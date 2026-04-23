import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, roundsTable, playersTable, scoresTable, tripsTable } from "@workspace/db";
import {
  GetRoundLeaderboardParams,
  GetRoundLeaderboardResponse,
  GetTripLeaderboardParams,
  GetTripLeaderboardResponse,
} from "@workspace/api-zod";
import { computePlayerStats, computeSkins, computeNassau, fieldMinHandicap } from "../lib/scoring";

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
  const stats = players.map(p => {
    const holeScores = allHoleScoresMap.get(p.id) || Array(18).fill(null);
    return computePlayerStats(p, holeScores, par, holeHcp, minHcp);
  });

  const { skinsWon, perHole } = computeSkins(players, allHoleScoresMap, holeHcp, minHcp);
  const nassau = computeNassau(stats);

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
    nassauResult: {
      frontWinnerIds: nassau.frontWinnerIds,
      backWinnerIds: nassau.backWinnerIds,
      totalWinnerIds: nassau.totalWinnerIds,
    },
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
    const stats = players.map(p => {
      const holeScores = allHoleScoresMap.get(p.id) || Array(18).fill(null);
      return computePlayerStats(p, holeScores, par, holeHcp, minHcp);
    });

    const { skinsWon } = computeSkins(players, allHoleScoresMap, holeHcp, minHcp);

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
