import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, scoresTable, roundsTable, playersTable } from "@workspace/db";
import {
  GetScoresParams,
  GetScoresResponse,
  UpsertScoreParams,
  UpsertScoreBody,
  UpsertScoreResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trips/:tripId/rounds/:roundId/scores", async (req, res): Promise<void> => {
  const params = GetScoresParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const scores = await db.select().from(scoresTable)
    .where(eq(scoresTable.roundId, params.data.roundId));

  res.json(GetScoresResponse.parse(scores));
});

router.put("/trips/:tripId/rounds/:roundId/scores", async (req, res): Promise<void> => {
  const params = UpsertScoreParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpsertScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { playerId, hole, score } = parsed.data;
  const holeIdx = hole - 1; // 0-indexed

  if (holeIdx < 0 || holeIdx > 17) {
    res.status(400).json({ error: "Hole must be between 1 and 18" });
    return;
  }

  // Find existing score row or create
  const [existing] = await db.select().from(scoresTable)
    .where(and(eq(scoresTable.roundId, params.data.roundId), eq(scoresTable.playerId, playerId)));

  let scoreRow;
  if (existing) {
    const newHoleScores = [...(existing.holeScores as (number | null)[])];
    // Ensure array is 18 long
    while (newHoleScores.length < 18) newHoleScores.push(null);
    newHoleScores[holeIdx] = score ?? null;
    [scoreRow] = await db.update(scoresTable)
      .set({ holeScores: newHoleScores, updatedAt: new Date() })
      .where(eq(scoresTable.id, existing.id))
      .returning();
  } else {
    const newHoleScores: (number | null)[] = Array(18).fill(null);
    newHoleScores[holeIdx] = score ?? null;
    [scoreRow] = await db.insert(scoresTable)
      .values({ roundId: params.data.roundId, playerId, holeScores: newHoleScores })
      .returning();
  }

  res.json(UpsertScoreResponse.parse(scoreRow));
});

export default router;
