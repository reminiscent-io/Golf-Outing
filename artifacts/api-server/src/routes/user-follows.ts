import { Router, type IRouter } from "express";
import { and, eq, lt, desc } from "drizzle-orm";
import { db, usersTable, userFollowsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.post("/users/:userId/follow", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const followedId = Number(req.params.userId);
  if (!Number.isFinite(followedId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  const followerId = req.user!.id;
  if (followerId === followedId) {
    res.status(400).json({ error: "Cannot follow yourself" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, followedId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.profileVisibility === "private") {
    res.status(403).json({ error: "Profile is private" });
    return;
  }

  await db
    .insert(userFollowsTable)
    .values({ followerId, followedId })
    .onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/users/:userId/follow", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const followedId = Number(req.params.userId);
  if (!Number.isFinite(followedId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  await db
    .delete(userFollowsTable)
    .where(and(eq(userFollowsTable.followerId, req.user!.id), eq(userFollowsTable.followedId, followedId)));
  res.sendStatus(204);
});

router.get("/users/:userId/followers", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  const rows = await db
    .select({
      userId: usersTable.id,
      fullName: usersTable.fullName,
      handicap: usersTable.handicap,
      followedAt: userFollowsTable.createdAt,
    })
    .from(userFollowsTable)
    .innerJoin(usersTable, eq(usersTable.id, userFollowsTable.followerId))
    .where(and(
      eq(userFollowsTable.followedId, userId),
      eq(usersTable.profileVisibility, "public"),
      before ? lt(userFollowsTable.createdAt, before) : undefined,
    ))
    .orderBy(desc(userFollowsTable.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({ ...r, followedAt: ser(r.followedAt) })));
});

router.get("/users/:userId/following", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  const rows = await db
    .select({
      userId: usersTable.id,
      fullName: usersTable.fullName,
      handicap: usersTable.handicap,
      followedAt: userFollowsTable.createdAt,
    })
    .from(userFollowsTable)
    .innerJoin(usersTable, eq(usersTable.id, userFollowsTable.followedId))
    .where(and(
      eq(userFollowsTable.followerId, userId),
      eq(usersTable.profileVisibility, "public"),
      before ? lt(userFollowsTable.createdAt, before) : undefined,
    ))
    .orderBy(desc(userFollowsTable.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({ ...r, followedAt: ser(r.followedAt) })));
});

export default router;
