import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, roundsTable, playersTable, roundGroupAssignmentsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  ListRoundGroupsParams,
  PutRoundGroupsParams,
  PutRoundGroupsBody,
  ListRoundGroupsResponse,
  PutRoundGroupsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trips/:tripId/rounds/:roundId/groups", async (req, res): Promise<void> => {
  const params = ListRoundGroupsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [round] = await db.select().from(roundsTable).where(and(
    eq(roundsTable.id, params.data.roundId),
    eq(roundsTable.tripId, params.data.tripId),
  ));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  const rows = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    groupNumber: roundGroupAssignmentsTable.groupNumber,
  }).from(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, params.data.roundId));
  res.json(ListRoundGroupsResponse.parse(ser({ assignments: rows })));
});

router.put("/trips/:tripId/rounds/:roundId/groups", async (req, res): Promise<void> => {
  const params = PutRoundGroupsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = PutRoundGroupsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Verify round belongs to trip
  const [round] = await db.select().from(roundsTable).where(and(
    eq(roundsTable.id, params.data.roundId),
    eq(roundsTable.tripId, params.data.tripId),
  ));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }

  const playerIds = parsed.data.assignments.map(a => a.playerId);

  // Verify every player belongs to the trip (empty array short-circuits)
  if (playerIds.length > 0) {
    const validPlayers = await db.select({ id: playersTable.id })
      .from(playersTable)
      .where(and(eq(playersTable.tripId, params.data.tripId), inArray(playersTable.id, playerIds)));
    if (validPlayers.length !== new Set(playerIds).size) {
      res.status(400).json({ error: "One or more players do not belong to this trip" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, params.data.roundId));
    if (parsed.data.assignments.length > 0) {
      await tx.insert(roundGroupAssignmentsTable).values(
        parsed.data.assignments.map(a => ({
          roundId: params.data.roundId,
          playerId: a.playerId,
          groupNumber: a.groupNumber,
        }))
      );
    }
  });

  res.json(PutRoundGroupsResponse.parse(ser({ assignments: parsed.data.assignments })));
});

export default router;
