import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, roundsTable, roundKudosTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.post("/rounds/:roundId/kudos", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.visibility === "private") {
    res.status(403).json({ error: "Round is private" });
    return;
  }
  await db.insert(roundKudosTable)
    .values({ userId: req.user!.id, roundId })
    .onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/rounds/:roundId/kudos", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  await db.delete(roundKudosTable)
    .where(and(eq(roundKudosTable.userId, req.user!.id), eq(roundKudosTable.roundId, roundId)));
  res.sendStatus(204);
});

export default router;
