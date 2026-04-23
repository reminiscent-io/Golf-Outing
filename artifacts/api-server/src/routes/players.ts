import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, playersTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  CreatePlayerBody,
  CreatePlayerParams,
  ListPlayersParams,
  ListPlayersResponse,
  UpdatePlayerBody,
  UpdatePlayerParams,
  UpdatePlayerResponse,
  DeletePlayerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trips/:tripId/players", async (req, res): Promise<void> => {
  const params = ListPlayersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const players = await db.select().from(playersTable).where(eq(playersTable.tripId, params.data.tripId)).orderBy(playersTable.createdAt);
  res.json(ListPlayersResponse.parse(ser(players)));
});

router.post("/trips/:tripId/players", async (req, res): Promise<void> => {
  const params = CreatePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [player] = await db.insert(playersTable).values({
    tripId: params.data.tripId,
    name: parsed.data.name,
    handicap: parsed.data.handicap,
  }).returning();
  res.status(201).json(player);
});

router.patch("/trips/:tripId/players/:playerId", async (req, res): Promise<void> => {
  const params = UpdatePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [player] = await db.update(playersTable).set(parsed.data)
    .where(and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId)))
    .returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(UpdatePlayerResponse.parse(ser(player)));
});

router.delete("/trips/:tripId/players/:playerId", async (req, res): Promise<void> => {
  const params = DeletePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(playersTable).where(and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId)));
  res.sendStatus(204);
});

export default router;
