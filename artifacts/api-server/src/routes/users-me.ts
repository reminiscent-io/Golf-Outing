import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tripsTable, playersTable, userTripFollowsTable } from "@workspace/db";
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

  const result = Array.from(byTripId.values())
    .sort((a, b) => b.trip.createdAt.getTime() - a.trip.createdAt.getTime())
    .map(e => ({ trip: ser(e.trip), via: e.via, players: ser(e.players) }));

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

export default router;
