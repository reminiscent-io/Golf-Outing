import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, playersTable, usersTable, tripsTable, roundsTable, roundGroupAssignmentsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { normalizePhone } from "../lib/otp";
import { isClaimableByPhone, generateClaimCode, publicPlayer } from "../lib/claim";
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
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/trips/:tripId/players", async (req, res): Promise<void> => {
  const params = ListPlayersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const players = await db.select().from(playersTable).where(eq(playersTable.tripId, params.data.tripId)).orderBy(playersTable.createdAt);
  res.json(ListPlayersResponse.parse(ser(players.map(publicPlayer))));
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
  // Optional phone tag: normalize to E.164; ignore garbage. Only meaningful on unclaimed rows.
  const invitedPhone = userId === null && parsed.data.invitedPhone
    ? normalizePhone(parsed.data.invitedPhone)
    : null;
  const [player] = await db.insert(playersTable).values({
    tripId: params.data.tripId,
    userId,
    name: parsed.data.name,
    handicap: parsed.data.handicap,
    invitedPhone,
  }).returning();
  // publicPlayer is load-bearing here: unlike GET/PATCH this 201 has no Zod response backstop,
  // so this strip is the only thing keeping invitedPhone/claimCode out of the create response.
  res.status(201).json(publicPlayer(player));
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

  // Load the existing row first — the claim guard needs its invited_phone / user_id.
  const [existing] = await db.select().from(playersTable)
    .where(and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId)));
  if (!existing) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.handicap !== undefined) updateData.handicap = parsed.data.handicap;

  // Linking a row to a user is explicit AND gated by the claim guard: a tagged row is
  // reserved for its phone, so a self-claim only succeeds on an open or phone-matched row.
  if (parsed.data.userId !== undefined && req.user) {
    if (parsed.data.userId === null) {
      updateData.userId = null;
    } else if (parsed.data.userId === req.user.id) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
      if (u && isClaimableByPhone(existing, u.phone)) {
        updateData.userId = req.user.id;
        // Claiming adopts the caller's profile name unless they also sent a name edit.
        if (parsed.data.name === undefined) updateData.name = u.fullName;
        updateData.invitedPhone = null;
        updateData.claimCode = null;
      } else {
        res.status(403).json({ error: "This player is reserved for someone else" });
        return;
      }
    }
  }

  // Phone tag may only be set/cleared by an authed caller on an unclaimed row.
  if (parsed.data.invitedPhone !== undefined && req.user && existing.userId === null && updateData.userId === undefined) {
    updateData.invitedPhone = parsed.data.invitedPhone ? normalizePhone(parsed.data.invitedPhone) : null;
  }

  // When claiming (linking a real userId), require the row to still be unclaimed in the
  // UPDATE's WHERE — closes the TOCTOU window between the SELECT above and this write so two
  // concurrent claimers (or a racing /claim redemption) can't double-link.
  const isClaiming = typeof updateData.userId === "number";
  const whereClause = isClaiming
    ? and(
        eq(playersTable.id, params.data.playerId),
        eq(playersTable.tripId, params.data.tripId),
        sql`${playersTable.userId} IS NULL`,
      )
    : and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId));
  const [player] = await db.update(playersTable).set(updateData).where(whereClause).returning();
  if (!player) {
    // Row vanished between SELECT and UPDATE, or (when claiming) someone else claimed it first.
    res.status(isClaiming ? 409 : 404).json({
      error: isClaiming ? "This player was just claimed by someone else" : "Player not found",
    });
    return;
  }
  res.json(UpdatePlayerResponse.parse(ser(publicPlayer(player))));
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

router.post("/trips/:tripId/players/:playerId/invite", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const playerId = Number(req.params.playerId);
  const me = req.user!.id;
  if (!Number.isFinite(playerId)) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!row) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  if (row.userId !== null) {
    res.status(409).json({ error: "Already claimed" });
    return;
  }

  // Participant check: trip creator OR a linked player in the trip OR the creator of a
  // round that includes this player (covers solo/tripless rows too).
  let isParticipant = false;
  if (row.tripId !== null) {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, row.tripId));
    const myPlayers = await db.select({ id: playersTable.id }).from(playersTable)
      .where(and(eq(playersTable.tripId, row.tripId), eq(playersTable.userId, me)));
    isParticipant = trip?.createdByUserId === me || myPlayers.length > 0;
  }
  if (!isParticipant) {
    const mine = await db.select({ id: roundsTable.id })
      .from(roundGroupAssignmentsTable)
      .innerJoin(roundsTable, eq(roundsTable.id, roundGroupAssignmentsTable.roundId))
      .where(and(eq(roundGroupAssignmentsTable.playerId, playerId), eq(roundsTable.createdByUserId, me)));
    isParticipant = mine.length > 0;
  }
  if (!isParticipant) {
    res.status(403).json({ error: "Not a participant in this trip" });
    return;
  }

  const code = generateClaimCode();
  await db.update(playersTable).set({ claimCode: code }).where(eq(playersTable.id, playerId));
  res.json({ code, path: `/claim/${code}` });
});

export default router;
