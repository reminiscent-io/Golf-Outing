import { Router, type IRouter } from "express";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  userFollowsTable,
  playersTable,
  scoresTable,
  roundsTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { summarizeFeedItems, type FeedItem } from "../lib/feed";

const router: IRouter = Router();

router.get("/users/:userId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  const viewerId = req.user!.id;

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Private profiles return a minimal payload.
  if (target.profileVisibility === "private" && target.id !== viewerId) {
    res.json({
      id: target.id,
      fullName: target.fullName,
      profileVisibility: "private",
      createdAt: ser(target.createdAt),
      followerCount: 0,
      followingCount: 0,
      viewerRelation: { isSelf: false, isFollowing: false, isFollowedBy: false },
    });
    return;
  }

  // Follower / following counts.
  const [{ followerCount }] = await db
    .select({ followerCount: sql<number>`count(*)::int` })
    .from(userFollowsTable)
    .where(eq(userFollowsTable.followedId, userId));
  const [{ followingCount }] = await db
    .select({ followingCount: sql<number>`count(*)::int` })
    .from(userFollowsTable)
    .where(eq(userFollowsTable.followerId, userId));

  const [followingRow] = await db
    .select()
    .from(userFollowsTable)
    .where(and(eq(userFollowsTable.followerId, viewerId), eq(userFollowsTable.followedId, userId)))
    .limit(1);
  const [followedByRow] = await db
    .select()
    .from(userFollowsTable)
    .where(and(eq(userFollowsTable.followerId, userId), eq(userFollowsTable.followedId, viewerId)))
    .limit(1);

  // Lifetime stats: aggregate over the user's player rows -> scores -> rounds.
  const myPlayers = await db.select().from(playersTable).where(eq(playersTable.userId, userId));
  const myPlayerIds = myPlayers.map(p => p.id);
  let stats = { roundsPlayed: 0, bestNet: null as number | null, avgNetLast10: null as number | null, coursesPlayed: 0 };
  let recentRounds: FeedItem[] = [];

  if (myPlayerIds.length > 0) {
    const myScoreRows = await db.select().from(scoresTable).where(inArray(scoresTable.playerId, myPlayerIds));
    const myRoundIds = Array.from(new Set(myScoreRows.map(s => s.roundId)));
    if (myRoundIds.length > 0) {
      const courseRows = await db
        .select({ course: roundsTable.course })
        .from(roundsTable)
        .where(and(inArray(roundsTable.id, myRoundIds), eq(roundsTable.visibility, "public")));
      const coursesSet = new Set(courseRows.map(r => r.course?.trim().toLowerCase()).filter(Boolean) as string[]);
      stats.coursesPlayed = coursesSet.size;
      stats.roundsPlayed = myRoundIds.length;

      const recentRows = await db
        .select()
        .from(roundsTable)
        .where(and(inArray(roundsTable.id, myRoundIds), eq(roundsTable.visibility, "public")))
        .orderBy(desc(sql`coalesce(${roundsTable.completedAt}, ${roundsTable.updatedAt})`))
        .limit(20);
      recentRounds = await summarizeFeedItems(recentRows, viewerId);
    }
  }

  res.json({
    id: target.id,
    fullName: target.fullName,
    handicap: target.handicap,
    profileVisibility: target.profileVisibility,
    createdAt: ser(target.createdAt),
    stats,
    recentRounds,
    followerCount,
    followingCount,
    viewerRelation: {
      isSelf: viewerId === target.id,
      isFollowing: !!followingRow,
      isFollowedBy: !!followedByRow,
    },
  });
});

router.get("/users/search", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  if (q.length < 1) {
    res.json([]);
    return;
  }

  // pg_trgm similarity search. We use `%` (the trigram-similarity operator)
  // and rank by similarity descending. Exclude private profiles.
  const nameHits = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, handicap: usersTable.handicap })
    .from(usersTable)
    .where(and(
      sql`${usersTable.fullName} % ${q}`,
      eq(usersTable.profileVisibility, "public"),
    ))
    .orderBy(desc(sql`similarity(${usersTable.fullName}, ${q})`))
    .limit(limit);

  // E.164 phone lookup if the query parses as a phone number. Treat anything
  // with a leading + and >= 7 digits as a phone candidate. Honor discoverableByPhone.
  const phoneCandidate = q.startsWith("+") && q.length >= 8 ? q : null;
  let phoneHits: typeof nameHits = [];
  if (phoneCandidate) {
    phoneHits = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, handicap: usersTable.handicap })
      .from(usersTable)
      .where(and(
        eq(usersTable.phone, phoneCandidate),
        eq(usersTable.discoverableByPhone, true),
        eq(usersTable.profileVisibility, "public"),
      ))
      .limit(1);
  }

  // Merge, dedupe by id, cap to limit.
  const byId = new Map<number, typeof nameHits[number]>();
  for (const u of [...phoneHits, ...nameHits]) {
    if (!byId.has(u.id)) byId.set(u.id, u);
    if (byId.size >= limit) break;
  }
  res.json(Array.from(byId.values()));
});

router.get("/users/me/buddies", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;

  // Buddies = users who share a round with me. Join scores to map player -> round,
  // then self-join scores by roundId to find co-players, then join players to get userId.
  // Group by other userId, count distinct rounds, capture max round.updatedAt as last_played.
  const rows = await db.execute<{
    user_id: number;
    full_name: string;
    handicap: number | null;
    rounds_together: number;
    last_played_at: string | null;
  }>(sql`
    WITH my_players AS (
      SELECT id FROM ${playersTable} WHERE user_id = ${me}
    ),
    my_round_ids AS (
      SELECT DISTINCT round_id FROM ${scoresTable}
      WHERE player_id IN (SELECT id FROM my_players)
    ),
    co_player_rounds AS (
      SELECT DISTINCT s.round_id, p.user_id
      FROM ${scoresTable} s
      JOIN ${playersTable} p ON p.id = s.player_id
      WHERE s.round_id IN (SELECT round_id FROM my_round_ids)
        AND p.user_id IS NOT NULL
        AND p.user_id <> ${me}
    )
    SELECT
      cp.user_id        AS user_id,
      u.full_name       AS full_name,
      u.handicap        AS handicap,
      COUNT(DISTINCT cp.round_id)::int AS rounds_together,
      MAX(r.updated_at) AS last_played_at
    FROM co_player_rounds cp
    JOIN ${usersTable} u ON u.id = cp.user_id
    JOIN ${roundsTable} r ON r.id = cp.round_id
    GROUP BY cp.user_id, u.full_name, u.handicap
    ORDER BY rounds_together DESC, last_played_at DESC NULLS LAST
  `);

  const items = (rows.rows ?? []).map(r => ({
    userId: r.user_id,
    fullName: r.full_name,
    handicap: r.handicap,
    roundsTogether: r.rounds_together,
    lastPlayedAt: r.last_played_at,
  }));
  res.json(items);
});

export default router;
