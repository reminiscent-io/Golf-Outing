import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, playersTable, usersTable } from "@workspace/db";
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
import { optionalAuth, type OptionallyAuthedRequest } from "../middlewares/optional-auth";

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

router.post("/trips/:tripId/players", optionalAuth, async (req: OptionallyAuthedRequest, res): Promise<void> => {
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
  // If caller is authed, auto-stamp the userId. Explicit body userId is also honored.
  const userId = parsed.data.userId ?? req.user?.id ?? null;
  const [player] = await db.insert(playersTable).values({
    tripId: params.data.tripId,
    userId,
    name: parsed.data.name,
    handicap: parsed.data.handicap,
  }).returning();
  res.status(201).json(player);
});

router.patch("/trips/:tripId/players/:playerId", optionalAuth, async (req: OptionallyAuthedRequest, res): Promise<void> => {
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

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.handicap !== undefined) updateData.handicap = parsed.data.handicap;

  // Allow setting userId only when the caller is authed and matches the requested userId
  // (i.e. the user is claiming a row created earlier by someone else). We don't allow
  // arbitrary impersonation here; if the body sends a userId that isn't req.user.id, we
  // ignore it. Setting userId=null is allowed for explicit unlinking by the same user.
  if (parsed.data.userId !== undefined && req.user) {
    if (parsed.data.userId === null) {
      updateData.userId = null;
    } else if (parsed.data.userId === req.user.id) {
      // Optional sanity: verify user exists.
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
      if (u) updateData.userId = req.user.id;
    }
  } else if (req.user) {
    // No explicit userId in the body but caller is authed and the row is currently unlinked → claim it.
    const [existing] = await db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId)));
    if (existing && existing.userId == null) {
      updateData.userId = req.user.id;
    }
  }

  const [player] = await db.update(playersTable).set(updateData)
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
