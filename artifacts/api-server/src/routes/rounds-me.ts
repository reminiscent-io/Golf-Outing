import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  roundsTable,
  playersTable,
  tripsTable,
  scoresTable,
  userTripFollowsTable,
  usersTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { verifySession } from "../lib/jwt";
import { CreateRoundV2Body, UpdateRoundBody } from "@workspace/api-zod";

const DEFAULT_PAR = Array(18).fill(4);
const DEFAULT_HCP = Array.from({ length: 18 }, (_, i) => i + 1);

const router: IRouter = Router();

router.post("/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const parsed = CreateRoundV2Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const tripId = body.tripId ?? null;

  // Trip-attached round: caller must be a player OR a follower OR the trip creator.
  if (tripId !== null) {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
    if (!trip) { res.status(403).json({ error: "Not a member of this trip" }); return; }
    const [playerRow] = await db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.tripId, tripId), eq(playersTable.userId, userId)))
      .limit(1);
    const isCreator = trip.createdByUserId === userId;
    let allowed = !!playerRow || isCreator;
    if (!allowed) {
      const [followRow] = await db
        .select()
        .from(userTripFollowsTable)
        .where(and(eq(userTripFollowsTable.tripId, tripId), eq(userTripFollowsTable.userId, userId)))
        .limit(1);
      allowed = !!followRow;
    }
    if (!allowed) { res.status(403).json({ error: "Not a member of this trip" }); return; }
  }

  // Insert the round (tripId may be null for solo).
  const [round] = await db.insert(roundsTable).values({
    tripId,
    createdByUserId: userId,
    name: body.name,
    course: body.course ?? null,
    date: body.date ?? null,
    par: (body.par as number[] | undefined) ?? DEFAULT_PAR,
    holeHcp: (body.holeHcp as number[] | undefined) ?? DEFAULT_HCP,
    teeBox: body.teeBox ?? null,
    courseRating: body.courseRating ?? null,
    courseSlope: body.courseSlope ?? null,
  }).returning();

  // Find-or-create the caller's player row in the right scope.
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(500).json({ error: "User not found" }); return; }

  const playerWhere = tripId === null
    ? and(isNull(playersTable.tripId), eq(playersTable.userId, userId))
    : and(eq(playersTable.tripId, tripId), eq(playersTable.userId, userId));

  const [existingPlayer] = await db.select().from(playersTable).where(playerWhere).limit(1);
  let player = existingPlayer;
  if (!player) {
    [player] = await db.insert(playersTable).values({
      tripId,
      userId,
      name: me.fullName,
      handicap: me.handicap ?? 18,
    }).returning();
  }

  res.status(201).json({ tripId, roundId: round.id, playerId: player.id });
});

router.get("/rounds/:roundId", async (req, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId)).limit(1);
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }

  // Visibility rules:
  // - Trip rounds: defer to the existing /trips/:tripId/rounds/:roundId logic;
  //   here we mirror it (private rounds only visible to players in the same trip).
  // - Solo rounds (tripId null): the creator always sees it; everyone else
  //   needs the round to be public AND completed.
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const payload = token ? verifySession(token) : null;

  if (round.tripId === null) {
    const isCreator = !!payload && payload.userId === round.createdByUserId;
    if (!isCreator) {
      if (round.visibility !== "public" || !round.completedAt) {
        res.status(404).json({ error: "Round not found" });
        return;
      }
    }
  } else if (round.visibility === "private") {
    if (!payload) { res.status(404).json({ error: "Round not found" }); return; }
    const [callerPlayer] = await db.select().from(playersTable)
      .where(and(eq(playersTable.tripId, round.tripId), eq(playersTable.userId, payload.userId)))
      .limit(1);
    if (!callerPlayer) { res.status(404).json({ error: "Round not found" }); return; }
  }

  res.json(ser(round));
});

router.patch("/rounds/:roundId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  const parsed = UpdateRoundBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId)).limit(1);
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.tripId !== null) {
    // Use the trip-scoped endpoint for trip rounds.
    res.status(404).json({ error: "Round not found" });
    return;
  }
  if (round.createdByUserId !== userId) {
    res.status(403).json({ error: "Only the round creator can update this round" });
    return;
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.course !== undefined) updateData.course = data.course;
  if (data.date !== undefined) updateData.date = data.date;
  if (data.par !== undefined) updateData.par = data.par;
  if (data.holeHcp !== undefined) updateData.holeHcp = data.holeHcp;
  if (data.gamesConfig !== undefined) updateData.gamesConfig = data.gamesConfig;
  if (data.handicapMode !== undefined) updateData.handicapMode = data.handicapMode;
  if (data.teeBox !== undefined) updateData.teeBox = data.teeBox;
  if (data.courseRating !== undefined) updateData.courseRating = data.courseRating;
  if (data.courseSlope !== undefined) updateData.courseSlope = data.courseSlope;
  if (data.visibility !== undefined) updateData.visibility = data.visibility;
  if (data.completedAt !== undefined) {
    updateData.completedAt = data.completedAt == null ? null : new Date(data.completedAt);
  }

  const [updated] = await db.update(roundsTable).set(updateData).where(eq(roundsTable.id, roundId)).returning();
  res.json(ser(updated));
});

router.delete("/rounds/:roundId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const [round] = await db.select({
    id: roundsTable.id,
    tripId: roundsTable.tripId,
    createdByUserId: roundsTable.createdByUserId,
  }).from(roundsTable).where(eq(roundsTable.id, roundId)).limit(1);

  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.tripId !== null) {
    // Trip rounds delete via /trips/:tripId/rounds/:roundId.
    res.status(404).json({ error: "Round not found" });
    return;
  }
  if (round.createdByUserId !== userId) {
    res.status(403).json({ error: "Only the round creator can delete this round" });
    return;
  }

  await db.delete(roundsTable).where(eq(roundsTable.id, roundId));
  res.sendStatus(204);
});

router.get("/users/me/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const filter = req.query["filter"];
  const filterValue = filter === "solo" ? "solo" : filter === "trip" ? "trip" : "all";

  // Caller's player rows — across all trips and the solo bucket (tripId null).
  const myPlayers = await db.select().from(playersTable).where(eq(playersTable.userId, userId));
  if (myPlayers.length === 0) { res.json([]); return; }
  const myPlayerIds = myPlayers.map(p => p.id);

  // Rounds the caller has a player row in (via scores). For a round with no scores yet,
  // the caller is included by being the creator.
  const myScoreRows = await db
    .select({ roundId: scoresTable.roundId, playerId: scoresTable.playerId, holeScores: scoresTable.holeScores })
    .from(scoresTable)
    .where(inArray(scoresTable.playerId, myPlayerIds));

  const scoredRoundIds = new Set(myScoreRows.map(r => r.roundId));
  const createdRows = await db
    .select({ id: roundsTable.id })
    .from(roundsTable)
    .where(eq(roundsTable.createdByUserId, userId));
  for (const r of createdRows) scoredRoundIds.add(r.id);

  if (scoredRoundIds.size === 0) { res.json([]); return; }

  const rounds = await db.select().from(roundsTable).where(inArray(roundsTable.id, Array.from(scoredRoundIds)));
  const filtered = rounds.filter(r => {
    if (filterValue === "solo") return r.tripId === null;
    if (filterValue === "trip") return r.tripId !== null;
    return true;
  });

  // Pull all trips referenced in one query.
  const tripIds = Array.from(new Set(filtered.map(r => r.tripId).filter((x): x is number => x !== null)));
  const trips = tripIds.length > 0
    ? await db.select().from(tripsTable).where(inArray(tripsTable.id, tripIds))
    : [];
  const tripById = new Map(trips.map(t => [t.id, t]));

  // Build a map of (roundId → caller's score row) so we can compute gross/net/holesPlayed.
  const scoreByRound = new Map<number, { holeScores: (number | null)[] }>();
  for (const row of myScoreRows) {
    const existing = scoreByRound.get(row.roundId);
    if (!existing) scoreByRound.set(row.roundId, { holeScores: row.holeScores as (number | null)[] });
  }

  const items = filtered
    .map(round => {
      const trip = round.tripId !== null ? tripById.get(round.tripId) ?? null : null;
      const score = scoreByRound.get(round.id);
      let gross: number | null = null;
      let net: number | null = null;
      let holesPlayed = 0;
      if (score) {
        let sum = 0;
        let played = 0;
        for (let h = 0; h < 18; h++) {
          const s = score.holeScores[h];
          if (s != null) { sum += s; played++; }
        }
        holesPlayed = played;
        if (played === 18) {
          gross = sum;
          const parTotal = round.par.reduce((a, b) => a + b, 0);
          net = sum - parTotal;
        }
      }
      return { round: ser(round), trip: trip ? ser(trip) : null, gross, net, holesPlayed };
    })
    .sort((a, b) => {
      const aDate = a.round.date ?? a.round.createdAt;
      const bDate = b.round.date ?? b.round.createdAt;
      return String(bDate).localeCompare(String(aDate));
    });

  res.json(items);
});

export default router;
