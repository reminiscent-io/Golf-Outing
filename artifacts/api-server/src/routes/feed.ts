import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  roundsTable,
  playersTable,
  scoresTable,
  usersTable,
  type Round,
} from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { summarizeFeedItems } from "../lib/feed";

const router: IRouter = Router();

// Feed order: most recent round first. Sort by the played date (a "YYYY-MM-DD"
// text column, so it sorts lexically), falling back to the created day when a
// round has no date, then break ties by created time.
const DATE_KEY = sql<string>`coalesce(${roundsTable.date}, to_char(${roundsTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD'))`;
const ORDER_BY = sql`${DATE_KEY} desc, ${roundsTable.createdAt} desc`;

// The keyset cursor packs both sort components: "<dateKey>|<createdAt ISO>".
function dateKeyOf(r: Round): string {
  return r.date ?? r.createdAt.toISOString().slice(0, 10);
}

router.get("/feed", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const tabRaw = String(req.query.tab ?? "");
  const tab: "buddies" | "mine" | "all" =
    tabRaw === "buddies" || tabRaw === "mine" || tabRaw === "all" ? tabRaw : "all";
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const beforeRaw = req.query.before ? String(req.query.before) : null;
  let before: { dateKey: string; createdAt: Date } | null = null;
  if (beforeRaw) {
    const sep = beforeRaw.indexOf("|");
    const createdAt = sep > 0 ? new Date(beforeRaw.slice(sep + 1)) : new Date(Number.NaN);
    // Malformed or legacy single-timestamp cursors are ignored (treated as page 1).
    if (sep > 0 && !Number.isNaN(createdAt.getTime())) {
      before = { dateKey: beforeRaw.slice(0, sep), createdAt };
    }
  }
  const beforeCond = before
    ? sql`(${DATE_KEY}, ${roundsTable.createdAt}) < (${before.dateKey}, ${before.createdAt})`
    : undefined;
  const me = req.user!.id;

  // Resolve the set of "interesting" userIds for this tab.
  let interestingUserIds: number[] | null = null; // null = "no filter"
  if (tab === "mine") {
    // Rounds I'm part of: any round in a trip where I have a linked player,
    // plus tripless rounds I created (resolved in candidate path (b) below).
    interestingUserIds = [me];
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
        beforeCond,
      ))
      .orderBy(ORDER_BY)
      .limit(limit * 3); // overfetch to allow visibility filter below
    candidateRoundIds = rows.map(r => r.id);
  } else {
    // (a) Rounds where a player in the trip has userId in interestingUserIds.
    const tripRoundRows = await db
      .selectDistinct({ id: roundsTable.id, dateKey: DATE_KEY, createdAt: roundsTable.createdAt })
      .from(roundsTable)
      .innerJoin(playersTable, eq(playersTable.tripId, roundsTable.tripId))
      .where(and(
        eq(roundsTable.visibility, "public"),
        inArray(playersTable.userId, interestingUserIds),
        beforeCond,
      ))
      .orderBy(ORDER_BY)
      .limit(limit * 3);
    // (b) Tripless rounds created by an interesting user.
    const triplessRoundRows = await db
      .selectDistinct({ id: roundsTable.id, dateKey: DATE_KEY, createdAt: roundsTable.createdAt })
      .from(roundsTable)
      .where(and(
        eq(roundsTable.visibility, "public"),
        isNull(roundsTable.tripId),
        inArray(roundsTable.createdByUserId, interestingUserIds),
        beforeCond,
      ))
      .orderBy(ORDER_BY)
      .limit(limit * 3);
    // Merge and dedupe by id, then re-apply the (dateKey desc, createdAt desc) order.
    const seen = new Set<number>();
    const merged: { id: number; dateKey: string; createdAt: Date }[] = [];
    for (const r of [...tripRoundRows, ...triplessRoundRows]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    merged.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    candidateRoundIds = merged.slice(0, limit * 3).map(r => r.id);
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
    .orderBy(ORDER_BY);

  // For tab=all, exclude rounds where every linked player is private OR has null userId.
  let filteredRounds = rounds;
  if (tab === "all") {
    const tripIds = Array.from(new Set(rounds.map(r => r.tripId).filter((x): x is number => x !== null)));
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
  const nextBefore = page.length === limit && last
    ? `${dateKeyOf(last)}|${last.createdAt.toISOString()}`
    : null;

  res.json({ items, nextBefore });
});

export default router;
