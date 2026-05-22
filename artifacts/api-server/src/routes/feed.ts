import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  roundsTable,
  playersTable,
  scoresTable,
  userFollowsTable,
  usersTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { summarizeFeedItems } from "../lib/feed";

const router: IRouter = Router();

const SORT_KEY = sql`coalesce(${roundsTable.completedAt}, ${roundsTable.updatedAt})`;

router.get("/feed", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const tabRaw = String(req.query.tab ?? "");
  const tab: "buddies" | "following" | "all" =
    tabRaw === "buddies" || tabRaw === "following" || tabRaw === "all" ? tabRaw : "all";
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const beforeRaw = req.query.before ? String(req.query.before) : null;
  const before = beforeRaw ? new Date(beforeRaw) : null;
  const me = req.user!.id;

  // Resolve the set of "interesting" userIds for this tab.
  let interestingUserIds: number[] | null = null; // null = "no filter"
  if (tab === "following") {
    const rows = await db
      .select({ id: userFollowsTable.followedId })
      .from(userFollowsTable)
      .where(eq(userFollowsTable.followerId, me));
    interestingUserIds = rows.map(r => r.id);
    if (interestingUserIds.length === 0) {
      res.json({ items: [], nextBefore: null });
      return;
    }
  } else if (tab === "buddies") {
    const rows = await db.execute<{ user_id: number }>(sql`
      WITH my_player_ids AS (
        SELECT id FROM ${playersTable} WHERE user_id = ${me}
      ),
      my_round_ids AS (
        SELECT DISTINCT round_id FROM ${scoresTable}
        WHERE player_id IN (SELECT id FROM my_player_ids)
      )
      SELECT DISTINCT p.user_id
      FROM ${scoresTable} s
      JOIN ${playersTable} p ON p.id = s.player_id
      WHERE s.round_id IN (SELECT round_id FROM my_round_ids)
        AND p.user_id IS NOT NULL
        AND p.user_id <> ${me}
    `);
    interestingUserIds = (rows.rows ?? []).map(r => r.user_id);
    if (interestingUserIds.length === 0) {
      res.json({ items: [], nextBefore: null });
      return;
    }
  }

  // Find rounds whose player list intersects with `interestingUserIds` (or all rounds for tab=all).
  // For all-tab, exclude rounds where every linked player has profileVisibility=private OR userId is null.
  // For buddies/following, filter rounds to those that include any player with userId in interestingUserIds.

  // Build the set of candidate round IDs.
  let candidateRoundIds: number[];
  if (interestingUserIds == null) {
    // All public rounds, regardless of player linkage.
    const rows = await db
      .select({ id: roundsTable.id })
      .from(roundsTable)
      .where(and(
        eq(roundsTable.visibility, "public"),
        before ? lt(SORT_KEY, before) : undefined,
      ))
      .orderBy(desc(SORT_KEY))
      .limit(limit * 3); // overfetch to allow visibility filter below
    candidateRoundIds = rows.map(r => r.id);
  } else {
    const rows = await db
      .selectDistinct({ id: roundsTable.id, sortKey: SORT_KEY })
      .from(roundsTable)
      .innerJoin(playersTable, eq(playersTable.tripId, roundsTable.tripId))
      .where(and(
        eq(roundsTable.visibility, "public"),
        inArray(playersTable.userId, interestingUserIds),
        before ? lt(SORT_KEY, before) : undefined,
      ))
      .orderBy(desc(SORT_KEY))
      .limit(limit * 3);
    candidateRoundIds = rows.map(r => r.id);
  }

  if (candidateRoundIds.length === 0) {
    res.json({ items: [], nextBefore: null });
    return;
  }

  // Load the round rows, ordered.
  const rounds = await db
    .select()
    .from(roundsTable)
    .where(inArray(roundsTable.id, candidateRoundIds))
    .orderBy(desc(SORT_KEY));

  // For tab=all, exclude rounds where every linked player is private OR has null userId.
  let filteredRounds = rounds;
  if (tab === "all") {
    const tripIds = Array.from(new Set(rounds.map(r => r.tripId)));
    const rPlayers = await db.select().from(playersTable).where(inArray(playersTable.tripId, tripIds));
    const userIds = Array.from(new Set(rPlayers.map(p => p.userId).filter((id): id is number => id != null)));
    const users = userIds.length === 0 ? [] : await db.select({ id: usersTable.id, profileVisibility: usersTable.profileVisibility }).from(usersTable).where(inArray(usersTable.id, userIds));
    const visById = new Map(users.map(u => [u.id, u.profileVisibility]));
    filteredRounds = rounds.filter(r => {
      const playersOnRound = rPlayers.filter(p => p.tripId === r.tripId);
      // Keep round if at least one player has a userId AND public profile.
      return playersOnRound.some(p => p.userId != null && visById.get(p.userId) === "public");
    });
  }

  const page = filteredRounds.slice(0, limit);
  const items = await summarizeFeedItems(page, me);
  const last = page[page.length - 1];
  const nextBefore = page.length === limit && last ? ser(last.completedAt ?? last.updatedAt) : null;

  res.json({ items, nextBefore });
});

export default router;
