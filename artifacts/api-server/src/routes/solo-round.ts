import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tripsTable, roundsTable, playersTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

const DEFAULT_PAR = Array(18).fill(4);
const DEFAULT_HCP = Array.from({ length: 18 }, (_, i) => i + 1);

router.post("/users/me/personal-trip/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const body = req.body ?? {};
  const name = String(body.name ?? "").trim();
  if (name.length === 0) { res.status(400).json({ error: "name required" }); return; }

  // Fetch the authenticated user's full record for fullName and handicap.
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!me) { res.status(401).json({ error: "User not found" }); return; }

  // Find-or-create personal trip.
  const [existing] = await db.select().from(tripsTable)
    .where(and(eq(tripsTable.createdByUserId, me.id), eq(tripsTable.kind, "personal")))
    .limit(1);

  let trip = existing;
  if (!trip) {
    [trip] = await db.insert(tripsTable).values({
      name: `${me.fullName}'s rounds`,
      kind: "personal",
      createdByUserId: me.id,
    }).returning();
  }

  // Create the round.
  const [round] = await db.insert(roundsTable).values({
    tripId: trip.id,
    name,
    course: body.course ?? null,
    date: body.date ?? null,
    par: Array.isArray(body.par) ? body.par : DEFAULT_PAR,
    holeHcp: Array.isArray(body.holeHcp) ? body.holeHcp : DEFAULT_HCP,
    teeBox: body.teeBox ?? null,
    courseRating: body.courseRating ?? null,
    courseSlope: body.courseSlope ?? null,
  }).returning();

  // Ensure the user has a player row in their personal trip.
  const [existingPlayer] = await db.select().from(playersTable)
    .where(and(eq(playersTable.tripId, trip.id), eq(playersTable.userId, me.id)))
    .limit(1);
  let player = existingPlayer;
  if (!player) {
    [player] = await db.insert(playersTable).values({
      tripId: trip.id,
      userId: me.id,
      name: me.fullName,
      handicap: me.handicap ?? 18,
    }).returning();
  }

  res.status(201).json({ tripId: trip.id, roundId: round.id, playerId: player.id });
});

export default router;
