import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, tripsTable, playersTable, userTripFollowsTable, roundsTable, scoresTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/users/me/trips", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = req.user.id;

  // Trips where the user has a linked player.
  const viaPlayers = await db
    .select({ trip: tripsTable, player: playersTable })
    .from(playersTable)
    .innerJoin(tripsTable, eq(tripsTable.id, playersTable.tripId))
    .where(eq(playersTable.userId, userId));

  // Trips the user has explicitly saved.
  const viaSaved = await db
    .select({ trip: tripsTable })
    .from(userTripFollowsTable)
    .innerJoin(tripsTable, eq(tripsTable.id, userTripFollowsTable.tripId))
    .where(eq(userTripFollowsTable.userId, userId));

  type Acc = {
    trip: typeof tripsTable.$inferSelect;
    via: "player" | "saved" | "both";
    players: (typeof playersTable.$inferSelect)[];
  };
  const byTripId = new Map<number, Acc>();

  for (const row of viaPlayers) {
    const existing = byTripId.get(row.trip.id);
    if (existing) {
      existing.players.push(row.player);
    } else {
      byTripId.set(row.trip.id, { trip: row.trip, via: "player", players: [row.player] });
    }
  }
  for (const row of viaSaved) {
    const existing = byTripId.get(row.trip.id);
    if (existing) {
      existing.via = existing.via === "player" ? "both" : existing.via;
    } else {
      byTripId.set(row.trip.id, { trip: row.trip, via: "saved", players: [] });
    }
  }

  // Hide personal (solo-round) trips — they live in the feed instead of My Trips.
  for (const [id, e] of byTripId) {
    if (e.trip.kind === "personal") byTripId.delete(id);
  }

  // Pull every round's date for these trips so we can show a date range per trip
  // and sort My Trips by when they were actually played (not when the trip row
  // was created).
  const tripIds = Array.from(byTripId.keys());
  const rangeByTripId = new Map<number, { start: string; end: string }>();
  if (tripIds.length > 0) {
    const roundRows = await db
      .select({ tripId: roundsTable.tripId, date: roundsTable.date })
      .from(roundsTable)
      .where(inArray(roundsTable.tripId, tripIds));
    for (const row of roundRows) {
      if (!row.date || row.tripId === null) continue;
      const existing = rangeByTripId.get(row.tripId);
      if (!existing) {
        rangeByTripId.set(row.tripId, { start: row.date, end: row.date });
      } else {
        if (row.date < existing.start) existing.start = row.date;
        if (row.date > existing.end) existing.end = row.date;
      }
    }
  }

  // Sort most-recent first using the trip's latest round date (falling back to
  // the trip's createdAt when no rounds have a date yet).
  const sortKey = (e: Acc): number => {
    const range = rangeByTripId.get(e.trip.id);
    if (range) return Date.parse(`${range.end}T00:00:00Z`);
    return e.trip.createdAt.getTime();
  };

  const result = Array.from(byTripId.values())
    .sort((a, b) => sortKey(b) - sortKey(a))
    .map(e => {
      const range = rangeByTripId.get(e.trip.id) ?? null;
      return {
        trip: ser(e.trip),
        via: e.via,
        players: ser(e.players),
        dateRange: range,
      };
    });

  res.json(result);
});

router.post("/users/me/trips/:tripId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const tripId = Number(req.params.tripId);
  if (!Number.isFinite(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  await db
    .insert(userTripFollowsTable)
    .values({ userId: req.user.id, tripId })
    .onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/users/me/trips/:tripId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const tripId = Number(req.params.tripId);
  if (!Number.isFinite(tripId)) {
    res.status(400).json({ error: "Invalid tripId" });
    return;
  }
  await db
    .delete(userTripFollowsTable)
    .where(and(eq(userTripFollowsTable.userId, req.user.id), eq(userTripFollowsTable.tripId, tripId)));
  res.sendStatus(204);
});

router.get("/users/me/stats", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = req.user.id;

  const tripsCreatedRows = await db
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(eq(tripsTable.createdByUserId, userId));
  const tripsCreated = tripsCreatedRows.length;

  const myPlayers = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.userId, userId));
  const myPlayerIds = myPlayers.map(p => p.id);

  const empty = {
    tripsCreated,
    roundsPlayed: 0,
    holesPlayed: 0,
    scoring: { bestGross: null, worstGross: null, avgGross: null, completedRounds: 0 },
    holeOutcomes: { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, triples: 0, quadPlus: 0 },
    playersPlayedWith: [],
    roundHistory: [],
  };

  if (myPlayerIds.length === 0) {
    res.json(empty);
    return;
  }

  // Score rows for the user across every trip they have a player in.
  const myScoreRows = await db
    .select()
    .from(scoresTable)
    .where(inArray(scoresTable.playerId, myPlayerIds));

  const myRoundIds = Array.from(new Set(myScoreRows.map(s => s.roundId)));

  if (myRoundIds.length === 0) {
    res.json(empty);
    return;
  }

  const rounds = await db
    .select()
    .from(roundsTable)
    .where(inArray(roundsTable.id, myRoundIds));
  const roundById = new Map(rounds.map(r => [r.id, r]));

  // Aggregate the user's own scoring: hole outcomes vs par, gross totals per round.
  const outcomes = { eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0, triples: 0, quadPlus: 0 };
  let holesPlayed = 0;
  let bestGross: number | null = null;
  let worstGross: number | null = null;
  let completedGrossSum = 0;
  let completedRounds = 0;
  // A user may have multiple players in the same round only across different trips,
  // but score rows are keyed (roundId, playerId) — multiple rows for one user in one
  // round shouldn't happen in practice. Defensively, sum holes per (round, hole) only once.
  const countedHoles = new Set<string>();
  type PerRound = { sum: number; played: number; handicap: number };
  const userRoundComplete = new Map<number, PerRound>();
  const myPlayerById = new Map(myPlayers.map(p => [p.id, p]));

  for (const row of myScoreRows) {
    const round = roundById.get(row.roundId);
    if (!round) continue;
    const par = round.par;
    const holes = row.holeScores;
    let roundSum = 0;
    let roundPlayed = 0;
    for (let h = 0; h < 18; h++) {
      const g = holes[h];
      if (g == null) continue;
      const dedupeKey = `${row.roundId}:${h}`;
      if (countedHoles.has(dedupeKey)) continue;
      countedHoles.add(dedupeKey);
      const diff = g - par[h];
      if (diff <= -2) outcomes.eagles++;
      else if (diff === -1) outcomes.birdies++;
      else if (diff === 0) outcomes.pars++;
      else if (diff === 1) outcomes.bogeys++;
      else if (diff === 2) outcomes.doubles++;
      else if (diff === 3) outcomes.triples++;
      else outcomes.quadPlus++;
      holesPlayed++;
      roundSum += g;
      roundPlayed++;
    }
    const prev = userRoundComplete.get(row.roundId);
    const hcp = myPlayerById.get(row.playerId)?.handicap ?? prev?.handicap ?? 0;
    userRoundComplete.set(row.roundId, {
      sum: (prev?.sum ?? 0) + roundSum,
      played: (prev?.played ?? 0) + roundPlayed,
      handicap: hcp,
    });
  }

  type RoundHistoryEntry = {
    roundId: number;
    tripId: number | null;
    name: string;
    course: string | null;
    date: string | null;
    playedAt: Date;
    gross: number;
    par: number;
    handicap: number;
  };
  const roundHistory: RoundHistoryEntry[] = [];
  for (const [roundId, { sum, played, handicap }] of userRoundComplete) {
    if (played !== 18) continue;
    completedRounds++;
    completedGrossSum += sum;
    if (bestGross == null || sum < bestGross) bestGross = sum;
    if (worstGross == null || sum > worstGross) worstGross = sum;
    const round = roundById.get(roundId);
    if (!round) continue;
    const totalPar = round.par.reduce((a, b) => a + b, 0);
    roundHistory.push({
      roundId,
      tripId: round.tripId,
      name: round.name,
      course: round.course,
      date: round.date,
      playedAt: round.completedAt ?? round.updatedAt,
      gross: sum,
      par: totalPar,
      handicap,
    });
  }
  roundHistory.sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());
  const avgGross = completedRounds > 0 ? completedGrossSum / completedRounds : null;

  // Co-players: distinct other players in the same rounds. Roll up by userId when both sides
  // have one; fall back to a name-based key otherwise.
  const coPlayerScoreRows = await db
    .select()
    .from(scoresTable)
    .where(inArray(scoresTable.roundId, myRoundIds));
  const coPlayerIds = Array.from(new Set(coPlayerScoreRows.map(r => r.playerId)));
  const coPlayers = coPlayerIds.length > 0
    ? await db.select().from(playersTable).where(inArray(playersTable.id, coPlayerIds))
    : [];
  const playerById = new Map(coPlayers.map(p => [p.id, p]));

  // For each (round, otherPlayer) pair where the other player isn't us, count 1 shared round.
  type CoPlayerAgg = { name: string; rounds: Set<number> };
  const coPlayerAgg = new Map<string, CoPlayerAgg>();
  const myPlayerIdSet = new Set(myPlayerIds);
  for (const row of coPlayerScoreRows) {
    if (myPlayerIdSet.has(row.playerId)) continue;
    const p = playerById.get(row.playerId);
    if (!p) continue;
    if (p.userId != null && p.userId === userId) continue; // safety: same user under a different player row
    const key = p.userId != null ? `u:${p.userId}` : `n:${p.name.trim().toLowerCase()}`;
    const existing = coPlayerAgg.get(key);
    if (existing) {
      existing.rounds.add(row.roundId);
    } else {
      coPlayerAgg.set(key, { name: p.name, rounds: new Set([row.roundId]) });
    }
  }

  const playersPlayedWith = Array.from(coPlayerAgg.values())
    .map(v => ({ name: v.name, rounds: v.rounds.size }))
    .sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name));

  res.json(ser({
    tripsCreated,
    roundsPlayed: myRoundIds.length,
    holesPlayed,
    scoring: { bestGross, worstGross, avgGross, completedRounds },
    holeOutcomes: outcomes,
    playersPlayedWith,
    roundHistory,
  }));
});

export default router;
