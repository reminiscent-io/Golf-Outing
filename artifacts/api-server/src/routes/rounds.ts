import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, roundsTable, playersTable, userTripFollowsTable, tripsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  CreateRoundBody,
  CreateRoundParams,
  ListRoundsParams,
  ListRoundsResponse,
  GetRoundParams,
  GetRoundResponse,
  UpdateRoundParams,
  UpdateRoundBody,
  UpdateRoundResponse,
  DeleteRoundParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { verifySession } from "../lib/jwt";

const DEFAULT_PAR = Array(18).fill(4);
const DEFAULT_HCP = Array.from({ length: 18 }, (_, i) => i + 1);
const DEFAULT_GAMES = {
  stableford: true,
  skins: true,
  nassau: true,
  netStroke: true,
  bestBall: false,
  bestBallTeams: [],
  matchPlay: false,
  matchPlayMatches: [],
};

const router: IRouter = Router();

router.get("/trips/:tripId/rounds", async (req, res): Promise<void> => {
  const params = ListRoundsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rounds = await db.select().from(roundsTable).where(eq(roundsTable.tripId, params.data.tripId)).orderBy(roundsTable.createdAt);
  res.json(ListRoundsResponse.parse(ser(rounds)));
});

router.post("/trips/:tripId/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = CreateRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateRoundBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Membership check: caller must have a player in the trip OR a saved-trip row.
  const [playerRow] = await db
    .select()
    .from(playersTable)
    .where(and(eq(playersTable.tripId, params.data.tripId), eq(playersTable.userId, req.user.id)))
    .limit(1);
  let hasMembership = !!playerRow;
  if (!hasMembership) {
    const [followRow] = await db
      .select()
      .from(userTripFollowsTable)
      .where(and(
        eq(userTripFollowsTable.tripId, params.data.tripId),
        eq(userTripFollowsTable.userId, req.user.id),
      ))
      .limit(1);
    hasMembership = !!followRow;
  }
  if (!hasMembership) {
    res.status(403).json({ error: "Not a member of this trip" });
    return;
  }

  const [round] = await db.insert(roundsTable).values({
    tripId: params.data.tripId,
    name: parsed.data.name,
    course: parsed.data.course ?? null,
    date: parsed.data.date ?? null,
    par: (parsed.data.par as number[] | undefined) ?? DEFAULT_PAR,
    holeHcp: (parsed.data.holeHcp as number[] | undefined) ?? DEFAULT_HCP,
    gamesConfig: parsed.data.gamesConfig ?? DEFAULT_GAMES,
    handicapMode: parsed.data.handicapMode ?? "net",
    teeBox: parsed.data.teeBox ?? null,
    courseRating: parsed.data.courseRating ?? null,
    courseSlope: parsed.data.courseSlope ?? null,
  }).returning();
  res.status(201).json(GetRoundResponse.parse(ser(round)));
});

router.get("/trips/:tripId/rounds/:roundId", async (req, res): Promise<void> => {
  const params = GetRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [round] = await db.select().from(roundsTable).where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  // Private rounds: only players in the same trip can fetch the round.
  // Anonymous and non-player callers see a 404 (not 403) so the route
  // doesn't leak round existence.
  if (round.visibility === "private") {
    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const payload = token ? verifySession(token) : null;
    if (!payload) { res.status(404).json({ error: "Round not found" }); return; }
    const [callerPlayer] = await db.select().from(playersTable)
      .where(and(eq(playersTable.tripId, round.tripId), eq(playersTable.userId, payload.userId)))
      .limit(1);
    if (!callerPlayer) { res.status(404).json({ error: "Round not found" }); return; }
  }
  res.json(GetRoundResponse.parse(ser(round)));
});

router.patch("/trips/:tripId/rounds/:roundId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const params = UpdateRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRoundBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Load the trip + round + caller's player to decide what they're allowed to change.
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  const [round] = await db.select().from(roundsTable)
    .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  const [callerPlayer] = await db.select().from(playersTable)
    .where(and(eq(playersTable.tripId, params.data.tripId), eq(playersTable.userId, req.user!.id)))
    .limit(1);

  const isTripCreator = trip.createdByUserId === req.user!.id;
  const isPlayerInRound = !!callerPlayer;

  // Visibility flips: trip creator only.
  if (parsed.data.visibility !== undefined && !isTripCreator) {
    res.status(403).json({ error: "Only the trip creator can change visibility" });
    return;
  }
  // completedAt: any player in the trip can mark complete.
  if (parsed.data.completedAt !== undefined && !isPlayerInRound && !isTripCreator) {
    res.status(403).json({ error: "Only players in this round can mark it complete" });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.course !== undefined) updateData.course = parsed.data.course;
  if (parsed.data.date !== undefined) updateData.date = parsed.data.date;
  if (parsed.data.par !== undefined) updateData.par = parsed.data.par;
  if (parsed.data.holeHcp !== undefined) updateData.holeHcp = parsed.data.holeHcp;
  if (parsed.data.gamesConfig !== undefined) updateData.gamesConfig = parsed.data.gamesConfig;
  if (parsed.data.handicapMode !== undefined) updateData.handicapMode = parsed.data.handicapMode;
  if (parsed.data.teeBox !== undefined) updateData.teeBox = parsed.data.teeBox;
  if (parsed.data.courseRating !== undefined) updateData.courseRating = parsed.data.courseRating;
  if (parsed.data.courseSlope !== undefined) updateData.courseSlope = parsed.data.courseSlope;
  if (parsed.data.visibility !== undefined) updateData.visibility = parsed.data.visibility;
  if (parsed.data.completedAt !== undefined) {
    updateData.completedAt = parsed.data.completedAt == null ? null : new Date(parsed.data.completedAt);
  }

  const [updated] = await db.update(roundsTable).set(updateData)
    .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)))
    .returning();
  res.json(UpdateRoundResponse.parse(ser(updated)));
});

router.delete("/trips/:tripId/rounds/:roundId", async (req, res): Promise<void> => {
  const params = DeleteRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(roundsTable).where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  res.sendStatus(204);
});

export default router;
