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
import { CreateRoundV2Body } from "@workspace/api-zod";

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

export default router;
