import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, roundCommentsTable, roundKudosTable, roundsTable, usersTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/rounds/:roundId/social", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }

  const [kudosCountRow, viewerKudosRow, recentKudosRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(roundKudosTable).where(eq(roundKudosTable.roundId, roundId)),
    db.select().from(roundKudosTable)
      .where(and(eq(roundKudosTable.roundId, roundId), eq(roundKudosTable.userId, req.user!.id))).limit(1),
    db.select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        handicap: usersTable.handicap,
        createdAt: roundKudosTable.createdAt,
      })
      .from(roundKudosTable)
      .innerJoin(usersTable, eq(usersTable.id, roundKudosTable.userId))
      .where(eq(roundKudosTable.roundId, roundId))
      .orderBy(desc(roundKudosTable.createdAt))
      .limit(5),
  ]);

  const [commentCountRow, commentItems] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(roundCommentsTable).where(eq(roundCommentsTable.roundId, roundId)),
    db.select({
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
      .orderBy(asc(roundCommentsTable.createdAt)),
  ]);

  res.json({
    kudos: {
      count: kudosCountRow[0]?.n ?? 0,
      viewerHasKudosed: !!viewerKudosRow[0],
      recentUsers: recentKudosRows.map(r => ({ id: r.id, fullName: r.fullName, handicap: r.handicap })),
    },
    comments: {
      count: commentCountRow[0]?.n ?? 0,
      items: commentItems.map(c => ({ ...c, createdAt: ser(c.createdAt) })),
    },
  });
});

export default router;
