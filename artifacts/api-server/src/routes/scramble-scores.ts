import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, scrambleScoresTable, roundsTable } from "@workspace/db";
import {
  GetScrambleScoresParams,
  GetScrambleScoresResponse,
  UpsertScrambleScoreParams,
  UpsertScrambleScoreBody,
  UpsertScrambleScoreResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trips/:tripId/rounds/:roundId/scramble-scores", async (req, res): Promise<void> => {
  const params = GetScrambleScoresParams.safeParse(req.params);
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

  const rows = await db.select().from(scrambleScoresTable)
    .where(eq(scrambleScoresTable.roundId, params.data.roundId));

  res.json(GetScrambleScoresResponse.parse({
    scores: rows.map(r => ({
      groupNumber: r.groupNumber,
      teamSide: r.teamSide,
      holeScores: r.holeScores as (number | null)[],
    })),
  }));
});

router.put("/trips/:tripId/rounds/:roundId/scramble-scores", async (req, res): Promise<void> => {
  const params = UpsertScrambleScoreParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertScrambleScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { groupNumber, teamSide, hole, score } = parsed.data;
  const holeIdx = hole - 1;

  if (holeIdx < 0 || holeIdx > 17) {
    res.status(400).json({ error: "Hole must be between 1 and 18" });
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

  const [existing] = await db.select().from(scrambleScoresTable).where(and(
    eq(scrambleScoresTable.roundId, params.data.roundId),
    eq(scrambleScoresTable.groupNumber, groupNumber),
    eq(scrambleScoresTable.teamSide, teamSide),
  ));

  let row;
  if (existing) {
    const newHoleScores = [...(existing.holeScores as (number | null)[])];
    while (newHoleScores.length < 18) newHoleScores.push(null);
    newHoleScores[holeIdx] = score ?? null;
    [row] = await db.update(scrambleScoresTable)
      .set({ holeScores: newHoleScores, updatedAt: new Date() })
      .where(eq(scrambleScoresTable.id, existing.id))
      .returning();
  } else {
    const newHoleScores: (number | null)[] = Array(18).fill(null);
    newHoleScores[holeIdx] = score ?? null;
    [row] = await db.insert(scrambleScoresTable)
      .values({ roundId: params.data.roundId, groupNumber, teamSide, holeScores: newHoleScores })
      .returning();
  }

  res.json(UpsertScrambleScoreResponse.parse({
    groupNumber: row.groupNumber,
    teamSide: row.teamSide,
    holeScores: row.holeScores as (number | null)[],
  }));
});

export default router;
