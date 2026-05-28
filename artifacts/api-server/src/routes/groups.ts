import { Router, type IRouter } from "express";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import {
  db,
  roundsTable,
  tripsTable,
  playersTable,
  roundGroupAssignmentsTable,
  roundGroupCompletionsTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  ListRoundGroupsParams,
  PutRoundGroupsParams,
  PutRoundGroupsBody,
  ListRoundGroupsResponse,
  PutRoundGroupsResponse,
  PutRoundGroupCompletionParams,
  PutRoundGroupCompletionBody,
  PutRoundGroupCompletionResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

// Anything that can run queries: the shared pool or a transaction handle.
type DbExecutor = typeof db;

// Load both the foursome assignments and per-group completion status for a round.
async function loadRoundGroups(exec: DbExecutor, roundId: number) {
  const [assignments, completions] = await Promise.all([
    exec.select({
      playerId: roundGroupAssignmentsTable.playerId,
      groupNumber: roundGroupAssignmentsTable.groupNumber,
      slotIndex: roundGroupAssignmentsTable.slotIndex,
    }).from(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, roundId)),
    exec.select({
      groupNumber: roundGroupCompletionsTable.groupNumber,
      completedAt: roundGroupCompletionsTable.completedAt,
      completedByUserId: roundGroupCompletionsTable.completedByUserId,
    }).from(roundGroupCompletionsTable).where(eq(roundGroupCompletionsTable.roundId, roundId)),
  ]);
  return { assignments, completions };
}

// Roll the per-group completions up to the round-level `completedAt`. The round
// only counts as finished once every assigned group has completed; reopening any
// group clears it again. Rounds with no group assignments are left untouched so
// the round-level "mark complete" flow keeps governing them.
async function recomputeRoundCompletion(exec: DbExecutor, roundId: number): Promise<void> {
  const assigns = await exec
    .select({ groupNumber: roundGroupAssignmentsTable.groupNumber })
    .from(roundGroupAssignmentsTable)
    .where(eq(roundGroupAssignmentsTable.roundId, roundId));
  const distinctGroups = Array.from(new Set(assigns.map(a => a.groupNumber)));
  if (distinctGroups.length === 0) return;

  const comps = await exec
    .select({ groupNumber: roundGroupCompletionsTable.groupNumber, completedAt: roundGroupCompletionsTable.completedAt })
    .from(roundGroupCompletionsTable)
    .where(eq(roundGroupCompletionsTable.roundId, roundId));
  const completedAtByGroup = new Map(comps.map(c => [c.groupNumber, c.completedAt]));

  const allComplete = distinctGroups.every(g => completedAtByGroup.has(g));
  let roundCompletedAt: Date | null = null;
  if (allComplete) {
    for (const g of distinctGroups) {
      const t = completedAtByGroup.get(g);
      if (t && (roundCompletedAt === null || t > roundCompletedAt)) roundCompletedAt = t;
    }
  }
  await exec.update(roundsTable)
    .set({ completedAt: roundCompletedAt, updatedAt: new Date() })
    .where(eq(roundsTable.id, roundId));
}

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
  const groups = await loadRoundGroups(db, params.data.roundId);
  res.json(ListRoundGroupsResponse.parse(ser(groups)));
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

  // Reject duplicate (groupNumber, slotIndex) pairs within the request.
  const slotKey = (groupNumber: number, slotIndex: number) => `${groupNumber}:${slotIndex}`;
  const seenSlots = new Set<string>();
  for (const a of parsed.data.assignments) {
    const k = slotKey(a.groupNumber, a.slotIndex);
    if (seenSlots.has(k)) {
      res.status(400).json({ error: `Duplicate slot ${a.slotIndex} in group ${a.groupNumber}` });
      return;
    }
    seenSlots.add(k);
  }

  const remainingGroups = Array.from(new Set(parsed.data.assignments.map(a => a.groupNumber)));

  await db.transaction(async (tx) => {
    await tx.delete(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, params.data.roundId));
    if (parsed.data.assignments.length > 0) {
      await tx.insert(roundGroupAssignmentsTable).values(
        parsed.data.assignments.map(a => ({
          roundId: params.data.roundId,
          playerId: a.playerId,
          groupNumber: a.groupNumber,
          slotIndex: a.slotIndex,
        }))
      );
    }
    // Drop completion rows for groups that no longer exist after reassignment.
    if (remainingGroups.length > 0) {
      await tx.delete(roundGroupCompletionsTable).where(and(
        eq(roundGroupCompletionsTable.roundId, params.data.roundId),
        notInArray(roundGroupCompletionsTable.groupNumber, remainingGroups),
      ));
    } else {
      await tx.delete(roundGroupCompletionsTable).where(eq(roundGroupCompletionsTable.roundId, params.data.roundId));
    }
    await recomputeRoundCompletion(tx as unknown as DbExecutor, params.data.roundId);
  });

  const groups = await loadRoundGroups(db, params.data.roundId);
  res.json(PutRoundGroupsResponse.parse(ser(groups)));
});

router.put("/trips/:tripId/rounds/:roundId/groups/:groupNumber/completion", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const params = PutRoundGroupCompletionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = PutRoundGroupCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  const [round] = await db.select().from(roundsTable)
    .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }

  // Only players in the trip (or the trip creator) can mark a group complete —
  // mirrors the round-level completion rule in rounds.ts.
  const [callerPlayer] = await db.select().from(playersTable)
    .where(and(eq(playersTable.tripId, params.data.tripId), eq(playersTable.userId, req.user!.id)))
    .limit(1);
  const isTripCreator = trip.createdByUserId === req.user!.id;
  if (!callerPlayer && !isTripCreator) {
    res.status(403).json({ error: "Only players in this round can mark a group complete" });
    return;
  }

  // The group must actually have players assigned to it.
  const [groupAssignment] = await db.select({ id: roundGroupAssignmentsTable.id })
    .from(roundGroupAssignmentsTable)
    .where(and(
      eq(roundGroupAssignmentsTable.roundId, params.data.roundId),
      eq(roundGroupAssignmentsTable.groupNumber, params.data.groupNumber),
    ))
    .limit(1);
  if (!groupAssignment) { res.status(404).json({ error: "No players assigned to this group" }); return; }

  await db.transaction(async (tx) => {
    if (parsed.data.completed) {
      await tx.insert(roundGroupCompletionsTable)
        .values({
          roundId: params.data.roundId,
          groupNumber: params.data.groupNumber,
          completedAt: new Date(),
          completedByUserId: req.user!.id,
        })
        .onConflictDoUpdate({
          target: [roundGroupCompletionsTable.roundId, roundGroupCompletionsTable.groupNumber],
          set: { completedAt: new Date(), completedByUserId: req.user!.id },
        });
    } else {
      await tx.delete(roundGroupCompletionsTable).where(and(
        eq(roundGroupCompletionsTable.roundId, params.data.roundId),
        eq(roundGroupCompletionsTable.groupNumber, params.data.groupNumber),
      ));
    }
    await recomputeRoundCompletion(tx as unknown as DbExecutor, params.data.roundId);
  });

  const groups = await loadRoundGroups(db, params.data.roundId);
  res.json(PutRoundGroupCompletionResponse.parse(ser(groups)));
});

export default router;
