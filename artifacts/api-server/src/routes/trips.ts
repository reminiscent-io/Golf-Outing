import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tripsTable, userTripFollowsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  CreateTripBody,
  GetTripParams,
  GetTripResponse,
  UpdateTripParams,
  UpdateTripBody,
  UpdateTripResponse,
  DeleteTripParams,
  ListTripsResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/trips", async (_req, res): Promise<void> => {
  const trips = await db.select().from(tripsTable).orderBy(tripsTable.createdAt);
  res.json(ListTripsResponse.parse(ser(trips)));
});

router.post("/trips", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateTripBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [trip] = await db.insert(tripsTable).values(parsed.data).returning();
  // Auto-follow the creator so the trip immediately shows up in their "My Trips".
  await db
    .insert(userTripFollowsTable)
    .values({ userId: req.user.id, tripId: trip.id })
    .onConflictDoNothing();
  res.status(201).json(GetTripResponse.parse(ser(trip)));
});

router.get("/trips/:tripId", async (req, res): Promise<void> => {
  const params = GetTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  res.json(GetTripResponse.parse(ser(trip)));
});

router.patch("/trips/:tripId", async (req, res): Promise<void> => {
  const params = UpdateTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTripBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [trip] = await db.update(tripsTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(tripsTable.id, params.data.tripId)).returning();
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  res.json(UpdateTripResponse.parse(ser(trip)));
});

router.delete("/trips/:tripId", async (req, res): Promise<void> => {
  const params = DeleteTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  res.sendStatus(204);
});

export default router;
