import { Router, type IRouter } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, playersTable, usersTable, tripsTable, roundsTable, roundGroupAssignmentsTable,
} from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { optionalAuth, type OptionallyAuthedRequest } from "../middlewares/optional-auth";
import { groupConnections, type CoPlayerRow } from "../lib/connections";
import { canClaim } from "../lib/claim";

const router: IRouter = Router();

// GET /users/me/connections — co-players grouped into accounts + pending.
router.get("/users/me/connections", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;
  const rows = await db.execute<{
    player_id: number; round_id: number; trip_id: number | null;
    user_id: number | null; name: string; user_full_name: string | null;
    invited_phone: string | null; has_invite: boolean;
  }>(sql`
    WITH my_player_ids AS (
      SELECT id FROM ${playersTable} WHERE user_id = ${me}
    ),
    my_round_ids AS (
      SELECT DISTINCT round_id FROM ${roundGroupAssignmentsTable}
      WHERE player_id IN (SELECT id FROM my_player_ids)
    )
    SELECT
      p.id AS player_id, a.round_id AS round_id, p.trip_id AS trip_id,
      p.user_id AS user_id, p.name AS name, u.full_name AS user_full_name,
      p.invited_phone AS invited_phone, (p.claim_code IS NOT NULL) AS has_invite
    FROM ${roundGroupAssignmentsTable} a
    JOIN ${playersTable} p ON p.id = a.player_id
    LEFT JOIN ${usersTable} u ON u.id = p.user_id
    WHERE a.round_id IN (SELECT round_id FROM my_round_ids)
      AND p.id NOT IN (SELECT id FROM my_player_ids)
  `);

  const coRows: CoPlayerRow[] = (rows.rows ?? []).map(r => ({
    playerId: r.player_id, roundId: r.round_id, tripId: r.trip_id,
    userId: r.user_id, name: r.name, userFullName: r.user_full_name,
    invitedPhone: r.invited_phone, hasInvite: r.has_invite,
  }));
  res.json(groupConnections(coRows)); // invited_phone consumed for grouping, never emitted
});

// Build claimable/preview context (trip name, rounds, tagger) for a set of player rows.
async function claimContext(playerIds: number[]) {
  if (playerIds.length === 0) return new Map<number, { tripId: number | null; tripName: string | null; taggedBy: string | null; rounds: { roundId: number; name: string; date: string | null }[] }>();
  const assigns = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    roundId: roundsTable.id, roundName: roundsTable.name, date: roundsTable.date,
    tripId: roundsTable.tripId, tripName: tripsTable.name,
    taggedBy: usersTable.fullName,
  })
    .from(roundGroupAssignmentsTable)
    .innerJoin(roundsTable, eq(roundsTable.id, roundGroupAssignmentsTable.roundId))
    .leftJoin(tripsTable, eq(tripsTable.id, roundsTable.tripId))
    .leftJoin(usersTable, eq(usersTable.id, roundsTable.createdByUserId))
    .where(inArray(roundGroupAssignmentsTable.playerId, playerIds));

  const map = new Map<number, { tripId: number | null; tripName: string | null; taggedBy: string | null; rounds: { roundId: number; name: string; date: string | null }[] }>();
  for (const a of assigns) {
    const e = map.get(a.playerId) ?? { tripId: a.tripId, tripName: a.tripName, taggedBy: a.taggedBy, rounds: [] };
    e.rounds.push({ roundId: a.roundId, name: a.roundName, date: a.date });
    map.set(a.playerId, e);
  }
  return map;
}

// GET /users/me/claimable — rows tagged to MY phone (auto-discovery on sign-in).
router.get("/users/me/claimable", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, me));
  if (!u) { res.json([]); return; }
  const rows = await db.select().from(playersTable)
    .where(and(eq(playersTable.invitedPhone, u.phone), sql`${playersTable.userId} IS NULL`));
  const ctx = await claimContext(rows.map(r => r.id));
  // Hand-built field whitelist is load-bearing: it is what keeps invitedPhone/claimCode (present
  // on the raw `rows`) out of the response — there is no Zod backstop on this endpoint.
  res.json(rows.map(r => {
    const c = ctx.get(r.id);
    return {
      playerId: r.id, name: r.name,
      tripId: c?.tripId ?? r.tripId ?? null, tripName: c?.tripName ?? null,
      taggedBy: c?.taggedBy ?? null, rounds: c?.rounds ?? [],
    };
  }));
});

type ClaimOutcome = { status: "claimed" } | { status: "skipped"; reason: string };

// Resolve a single accepted row for the caller. Re-fetches the row, re-validates authorization
// server-side via canClaim, enforces one-identity-per-trip (and per-user solo), and links the
// row race-safely. Returns the outcome; never trusts the client's claim about the row.
async function claimOnePlayer(
  me: number,
  u: { phone: string; fullName: string },
  playerId: number,
  code: string | null,
): Promise<ClaimOutcome> {
  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!row) return { status: "skipped", reason: "not_found" };
  if (!canClaim(row, { callerPhone: u.phone, code })) return { status: "skipped", reason: "not_authorized" };

  // Identity guard: at most one linked row per user per trip — and (for tripless solo rows) at
  // most one solo row per user. This application check is the primary guard for trip rows (there
  // is no UNIQUE(trip_id, user_id) index); for solo rows the partial unique index
  // `players_solo_per_user` is a durable DB backstop, caught below.
  const dupeWhere = row.tripId !== null
    ? and(eq(playersTable.tripId, row.tripId), eq(playersTable.userId, me))
    : and(sql`${playersTable.tripId} IS NULL`, eq(playersTable.userId, me));
  const dupe = await db.select({ id: playersTable.id }).from(playersTable).where(dupeWhere);
  if (dupe.length > 0) return { status: "skipped", reason: "already_in_trip" };

  try {
    // `userId IS NULL` in the WHERE closes the TOCTOU window since canClaim above; .returning()
    // lets us report a row that lost the race (0 rows changed) as skipped, not falsely as claimed.
    const updated = await db.update(playersTable)
      .set({ userId: me, name: u.fullName, invitedPhone: null, claimCode: null })
      .where(and(eq(playersTable.id, playerId), sql`${playersTable.userId} IS NULL`))
      .returning({ id: playersTable.id });
    return updated.length > 0 ? { status: "claimed" } : { status: "skipped", reason: "already_in_trip" };
  } catch (err) {
    // Lost a concurrent race to the solo-per-user unique index — degrade gracefully. Postgres
    // unique-violation is 23505; re-throw anything else so a genuine failure isn't masked.
    if ((err as { code?: string }).code === "23505") return { status: "skipped", reason: "already_in_trip" };
    throw err;
  }
}

// POST /users/me/claims — accept/decline, re-validated server-side per row.
router.post("/users/me/claims", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;
  const accepts: number[] = Array.isArray(req.body?.accepts) ? req.body.accepts : [];
  const declines: number[] = Array.isArray(req.body?.declines) ? req.body.declines : [];
  const code: string | null = typeof req.body?.code === "string" ? req.body.code : null;

  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, me));
  if (!u) { res.status(401).json({ error: "Unknown user" }); return; }

  const claimed: number[] = [];
  const skipped: { playerId: number; reason: string }[] = [];

  for (const playerId of accepts) {
    const outcome = await claimOnePlayer(me, { phone: u.phone, fullName: u.fullName }, playerId, code);
    if (outcome.status === "claimed") claimed.push(playerId);
    else skipped.push({ playerId, reason: outcome.reason });
  }

  for (const playerId of declines) {
    // Only clear a reservation actually addressed to this caller — their verified phone, or the
    // share code they hold — so an arbitrary id can't null out a stranger's tag/invite.
    const addressedToMe = code
      ? or(eq(playersTable.invitedPhone, u.phone), eq(playersTable.claimCode, code))
      : eq(playersTable.invitedPhone, u.phone);
    await db.update(playersTable)
      .set({ invitedPhone: null, claimCode: null })
      .where(and(eq(playersTable.id, playerId), sql`${playersTable.userId} IS NULL`, addressedToMe));
  }

  res.json({ claimed, skipped });
});

// GET /claim/:code — public preview of what a share code grants.
router.get("/claim/:code", optionalAuth, async (req: OptionallyAuthedRequest, res): Promise<void> => {
  const code = String(req.params.code);
  const [row] = await db.select().from(playersTable)
    .where(and(eq(playersTable.claimCode, code), sql`${playersTable.userId} IS NULL`));
  if (!row) { res.status(404).json({ error: "This invite is no longer valid" }); return; }
  const ctx = await claimContext([row.id]);
  const c = ctx.get(row.id);
  res.json({
    playerId: row.id, name: row.name,
    tripName: c?.tripName ?? null, taggedBy: c?.taggedBy ?? null, rounds: c?.rounds ?? [],
  });
});

export default router;
