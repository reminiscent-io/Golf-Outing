import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import { db, roundsTable, roundCommentsTable, usersTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/rounds/:roundId/comments", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const rows = await db
    .select({
      id: roundCommentsTable.id,
      roundId: roundCommentsTable.roundId,
      userId: roundCommentsTable.userId,
      userFullName: usersTable.fullName,
      parentCommentId: roundCommentsTable.parentCommentId,
      body: roundCommentsTable.body,
      createdAt: roundCommentsTable.createdAt,
    })
    .from(roundCommentsTable)
    .innerJoin(usersTable, eq(usersTable.id, roundCommentsTable.userId))
    .where(eq(roundCommentsTable.roundId, roundId))
    .orderBy(asc(roundCommentsTable.createdAt));

  res.json(rows.map(r => ({ ...r, createdAt: ser(r.createdAt) })));
});

router.post("/rounds/:roundId/comments", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const body = String(req.body?.body ?? "").trim();
  if (body.length === 0 || body.length > 1000) {
    res.status(400).json({ error: "body required (1..1000 chars)" });
    return;
  }
  const parentCommentId = req.body?.parentCommentId == null ? null : Number(req.body.parentCommentId);

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.visibility === "private") {
    res.status(403).json({ error: "Round is private" });
    return;
  }

  // If replying, the parent must (a) be on the same round and (b) have null parentCommentId.
  if (parentCommentId != null) {
    const [parent] = await db.select().from(roundCommentsTable).where(eq(roundCommentsTable.id, parentCommentId));
    if (!parent || parent.roundId !== roundId || parent.parentCommentId != null) {
      res.status(400).json({ error: "Invalid parentCommentId" });
      return;
    }
  }

  const [row] = await db.insert(roundCommentsTable).values({
    roundId,
    userId: req.user!.id,
    parentCommentId,
    body,
  }).returning();

  const [user] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, req.user!.id));
  res.status(201).json({
    id: row.id,
    roundId: row.roundId,
    userId: row.userId,
    userFullName: user.fullName,
    parentCommentId: row.parentCommentId,
    body: row.body,
    createdAt: ser(row.createdAt),
  });
});

router.delete("/comments/:commentId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const commentId = Number(req.params.commentId);
  if (!Number.isFinite(commentId)) { res.status(400).json({ error: "Invalid commentId" }); return; }
  const [row] = await db.select().from(roundCommentsTable).where(eq(roundCommentsTable.id, commentId));
  if (!row) { res.status(404).json({ error: "Comment not found" }); return; }
  if (row.userId !== req.user!.id) {
    res.status(403).json({ error: "Not the author" });
    return;
  }
  await db.delete(roundCommentsTable).where(eq(roundCommentsTable.id, commentId));
  res.sendStatus(204);
});

export default router;
