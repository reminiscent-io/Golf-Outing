# Per-Player Tee Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a round assign a different tee box to individual players, with WHS cross-tee net scoring computed from each player's own slope/rating/par/holeHcp, fully backward compatible with existing single-tee rounds.

**Architecture:** Keep the round-level tee columns as the *default tee*. Add a sparse `round_player_tees` override table (PK `(roundId, playerId)`, cascade). Refactor the server scoring engine so each player's Course Handicap is computed from their own tee and the net "play off low" reference is the minimum *Course Handicap* within their group (group-relative is preserved; field-min is the fallback for ungrouped players). Surface overrides through the existing `Round` response + `UpdateRoundBody` PATCH (full-replace diff). The Setup tab gains a per-player override list; the scorecard grid and round leaderboard show each player's tee.

**Tech Stack:** pnpm workspace · Drizzle ORM + Postgres (push, no migrations) · Express 5 · OpenAPI 3.1 + Orval (React Query hooks + Zod v4 validators) · React 19 + Vite + TanStack Query · Node built-in test runner via tsx.

---

## Design Decisions & Clarifications (resolved before coding)

These resolve under-specifications/contradictions found while mapping the codebase. **Review these first** — they shape every task.

1. **Group-relative, NOT field-wide, reference minimum.** The design §2 says "field minimum CH," but the implemented-and-tested behavior (server `buildPlayerMinHcp`, client `round.tsx:1002-1020`, and Nassau) is **group-relative**: each player plays off the lowest handicap *in their assigned group*, with the field-wide minimum only as a fallback for ungrouped players. Switching to a single field-wide min would change net scores for existing multi-group rounds — violating the design's own backward-compat goal ("identical leaderboards to the pre-change implementation"). **We preserve group-relative semantics** and change only the *basis* of the minimum from raw handicap index to per-player Course Handicap. The design's "field minimum" is interpreted as "the reference minimum (group-relative), taken over Course Handicaps."

2. **Parity is mathematically exact.** Because `Math.round` is monotonic non-decreasing and the WHS map `h → round(h·slope/113 + (rating−par))` is monotonic in `h`, the minimum of the per-player Course Handicaps in a group equals `round(minIndex·slope/113 + (rating−par))` — i.e. exactly what the old code computed by mining the index first and converting via the shared course. So for a round with **zero overrides**, every leaderboard number is byte-identical. The refactor's parity test asserts this.

3. **Named OpenAPI component `RoundPlayerTee`** (not the inline form in the design). Every array-of-objects in `openapi.yaml` uses a `$ref` to a named component; inline would mint two divergent anonymous orval types. One shared `RoundPlayerTee` is referenced by both `Round` and `UpdateRoundBody`.

4. **Client-side grid is made tee-aware (in scope).** `round.tsx` has its **own inline copy** of the WHS helpers (`round.tsx:69-101`) and computes the grid's per-player Course HCP, Playing HCP, stroke dots and color coding client-side (`round.tsx:988-1028`). The server is not the only place scoring lives. If we change only the server, the scorecard grid would show uniform/stale Course HCP for overridden players while the leaderboard is correct — a visible inconsistency. Task 6 makes the client grid per-player-tee-aware so what the user sees matches the server. (This task is self-contained and may be deferred if the team chooses to ship server-correct first, but it is included here as the correct default.)

5. **Tee badges on round-level views only.** Round leaderboard (Results tab) + scorecard grid header get a tee badge, resolved client-side from `round.playerTees ?? round.teeBox` (no leaderboard-response schema change needed — `round` is already fetched there). The **trip-level** "Trip Standings" does NOT get a badge: it aggregates across multiple rounds/courses where a single tee is meaningless.

6. **Solo rounds: server emits `playerTees`, no solo UI.** Solo rounds are single-player; the override list is only built on the trip Setup tab. The solo GET/PATCH handlers (`rounds-me.ts`) still emit `playerTees` and apply the diff for shape consistency, but no solo-specific UI is added (design non-goal: solo creation unchanged).

7. **Authorization unchanged.** Tee overrides go through the same PATCH path as `par`/`holeHcp`/`teeBox`, which today has no per-field membership guard beyond `requireAuth` (trip PATCH) / creator-only (solo PATCH). We do not add new auth rules — overrides inherit the existing field-update authorization.

---

## File Structure

**Create:**
- `lib/db/src/schema/round-player-tees.ts` — the override table (Drizzle), insert schema, `RoundPlayerTee` row type.

**Modify (DB / contract):**
- `lib/db/src/schema/index.ts` — barrel export the new table.
- `lib/api-spec/openapi.yaml` — add `RoundPlayerTee` component; add `playerTees` to `Round` and `UpdateRoundBody`.
- `CLAUDE.md` — add `round_player_tees` to the `lib/db` table list.
- (regenerated, do not hand-edit) `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/api.ts`.

**Modify (server):**
- `artifacts/api-server/src/lib/scoring.ts` — new `PlayerTee` type + `resolvePlayingHandicaps`; refactor `computePlayerStats`, `computeSkins`, `computeTeamNassau`, `summarizeRound`/`SummarizeInputs`; remove superseded `effectiveHandicap`/`buildPlayerMinHcp`.
- `artifacts/api-server/src/lib/scoring.test.ts` — update call sites to new signatures; add parity + mixed-tee + per-player stroke/Stableford tests.
- `artifacts/api-server/src/lib/player-tees.ts` *(new)* — pure, unit-testable diff/validation helpers for the PATCH full-replace.
- `artifacts/api-server/src/lib/player-tees.test.ts` *(new)* — tests for the diff/validation helpers.
- `artifacts/api-server/src/routes/rounds.ts` — GET joins + emits `playerTees`; PATCH applies the diff in a transaction.
- `artifacts/api-server/src/routes/rounds-me.ts` — solo GET joins + emits `playerTees`; solo PATCH applies the diff.
- `artifacts/api-server/src/routes/leaderboard.ts` — round + trip assemblies load overrides and call the refactored scoring.
- `artifacts/api-server/src/lib/feed.ts` — bulk-load overrides and pass per-player tees to `summarizeRound`.

**Modify (frontend):**
- `artifacts/golf-scorecard/src/components/course-search-field.tsx` — already exposes `onCourseSelected`; no change needed (verify in Task 7).
- `artifacts/golf-scorecard/src/pages/round.tsx` — per-player override card + state; `playerTees` in `handleSaveSetup`; relabel default selector; client-side grid tee-awareness; tee badges.

---

## Conventions (read once)

- **Commit after every task** with the message shown in that task's final step.
- **Zod imports use `zod/v4`** (not `zod`) — project convention, do not "fix."
- **Generated code is checked in but never hand-edited** — edit `openapi.yaml`, then run codegen.
- **DB is push-based** — no `migrations/`; after a schema edit run `pnpm --filter @workspace/db run push`.
- **Tests live in `src/lib/*.test.ts`** and use `node:test` + `node:assert/strict`. Run with `pnpm --filter @workspace/api-server run test`. The route/DB layer has no test harness — that's why the diff logic is extracted into a pure `src/lib/player-tees.ts`.
- **Verification gates:** `pnpm --filter @workspace/api-server run test` (scoring + diff), `pnpm run typecheck` (whole repo), `pnpm run build`.

---

## Task 0: Isolated workspace

**Files:** none (environment only).

- [ ] **Step 1: Create an isolated worktree off the current branch HEAD**

The current working tree has **uncommitted feed work** (`feed.ts`, `feed.tsx`, `openapi.yaml`, etc.) unrelated to this feature. Use the `superpowers:using-git-worktrees` skill to create a worktree. Branch it off `social-build`'s committed HEAD (which contains the design spec at `docs/superpowers/specs/2026-06-06-per-player-tees-design.md` and excludes the uncommitted feed edits), or off `main` if the team prefers. Confirm `git status` in the worktree is clean before starting.

Run (in the worktree, once): ensure deps + a baseline green test:
```bash
pnpm install
pnpm --filter @workspace/api-server run test
```
Expected: `tests 14 / pass 14 / fail 0`.

---

## Task 1: Database schema — `round_player_tees`

**Files:**
- Create: `lib/db/src/schema/round-player-tees.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `CLAUDE.md` (table list)

- [ ] **Step 1: Create the schema file**

Create `lib/db/src/schema/round-player-tees.ts`:
```ts
import { pgTable, integer, real, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roundsTable } from "./rounds";
import { playersTable } from "./players";

// Sparse per-player tee overrides within a round. A player with NO row plays the
// round default tee (rounds.teeBox/courseRating/courseSlope/par/holeHcp). A row
// carries that player's COMPLETE tee card. Cascade-deletes with its round/player.
export const roundPlayerTeesTable = pgTable("round_player_tees", {
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  teeBox: text("tee_box"),
  courseRating: real("course_rating"),
  courseSlope: integer("course_slope"),
  par: jsonb("par").notNull().$type<number[]>(),
  holeHcp: jsonb("hole_hcp").notNull().$type<number[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.roundId, t.playerId] }),
]);

export const insertRoundPlayerTeeSchema = createInsertSchema(roundPlayerTeesTable).omit({ createdAt: true, updatedAt: true });
export type InsertRoundPlayerTee = z.infer<typeof insertRoundPlayerTeeSchema>;
export type RoundPlayerTee = typeof roundPlayerTeesTable.$inferSelect;
```

Notes: composite PK `(roundId, playerId)` leads with `roundId`, so the "all overrides for a round" query is index-covered — no secondary index needed. `par`/`holeHcp` are `NOT NULL` with **no default** (an override always writes the full card; a default would mask write bugs).

- [ ] **Step 2: Export from the barrel**

In `lib/db/src/schema/index.ts`, add next to the other `round-*` lines (after `export * from "./round-comments";`):
```ts
export * from "./round-player-tees";
```

- [ ] **Step 3: Typecheck the db package**

Run: `pnpm --filter @workspace/db run typecheck`
Expected: PASS (no errors). If `@workspace/db` has no `typecheck` script, run `pnpm run typecheck:libs` instead.

- [ ] **Step 4: Push the schema to the database**

Run: `pnpm --filter @workspace/db run push`
Expected: drizzle-kit creates the `round_player_tees` table with no destructive prompts (it is a brand-new table). Requires `DATABASE_URL` in the environment (sourced from `.env`).

- [ ] **Step 5: Update CLAUDE.md table list**

In `CLAUDE.md`, the `lib/db` row lists tables. Append `round_player_tees` to that list:
```
| [lib/db](lib/db/) | Drizzle schema + `pg.Pool`. Tables: `users`, `user_follows`, `user_trip_follows`, `trips`, `players`, `rounds`, `round_group_assignments`, `scores`, `scramble_scores`, `round_kudos`, `round_comments`, `round_player_tees`. |
```

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/round-player-tees.ts lib/db/src/schema/index.ts CLAUDE.md
git commit -m "feat(db): add round_player_tees override table"
```

---

## Task 2: API contract — `playerTees` on Round + UpdateRoundBody

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/api.ts`

- [ ] **Step 1: Add the `RoundPlayerTee` component schema**

In `lib/api-spec/openapi.yaml`, under `components.schemas`, add a new component (place it adjacent to `RoundGroupAssignment` for discoverability). Match the spec's 3.1 nullable style (`["string", "null"]`):
```yaml
    RoundPlayerTee:
      type: object
      properties:
        playerId:
          type: integer
        teeBox:
          type: ["string", "null"]
        courseRating:
          type: ["number", "null"]
        courseSlope:
          type: ["integer", "null"]
        par:
          type: array
          items:
            type: integer
          description: 18 values - par for each hole (this player's tee)
        holeHcp:
          type: array
          items:
            type: integer
          description: 18 values - handicap stroke index for each hole (this player's tee)
      required:
        - playerId
        - par
        - holeHcp
```

- [ ] **Step 2: Add `playerTees` to the `Round` response schema**

In the `Round` schema (currently `properties` end with `courseSlope` then `visibility`), add `playerTees` after `courseSlope` and before `visibility`:
```yaml
        courseSlope:
          type: ["integer", "null"]
        playerTees:
          type: array
          items:
            $ref: "#/components/schemas/RoundPlayerTee"
          description: Per-player tee overrides; only overridden players appear. Absent/empty means all players use the round default tee.
        visibility:
          type: string
          enum: [public, private]
```
**Do NOT add `playerTees` to the `Round` `required` list** — legacy rounds emit it as absent/empty and must still validate.

- [ ] **Step 3: Add `playerTees` to `UpdateRoundBody`**

In the `UpdateRoundBody` schema, add `playerTees` after `completedAt` (it has no `required` block, so it stays PATCH-optional):
```yaml
        completedAt:
          type: ["string", "null"]
          description: Send a timestamp to mark the round complete; send null to clear.
        playerTees:
          type: array
          items:
            $ref: "#/components/schemas/RoundPlayerTee"
          description: Full-replace array of per-player tee overrides. Absent = no change; present (even empty) = diff against existing (upsert listed, delete the rest).
```
Do **not** add `playerTees` to `CreateRoundV2Body` or `CreateRoundBody` — create stays default-tee only.

- [ ] **Step 4: Run codegen**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: orval regenerates `api-client-react` + `api-zod`, rewrites `api-zod/src/index.ts`, then `tsc --build` of libs PASSES. (Adding optional fields is additive; lib typecheck should be clean. If a consumer breaks, it will surface here.)

- [ ] **Step 5: Verify the generated types**

Run:
```bash
grep -n "RoundPlayerTee" lib/api-client-react/src/generated/api.schemas.ts
grep -n "playerTees" lib/api-client-react/src/generated/api.schemas.ts
grep -n "RoundPlayerTee\|playerTees" lib/api-zod/src/generated/api.ts | head
```
Expected: a generated `RoundPlayerTee` interface; `playerTees?: RoundPlayerTee[]` on both `Round` and `UpdateRoundBody`; a `RoundPlayerTee` zod object referenced by the `Round`/`UpdateRoundBody` zod schemas. **Record the exact generated type name** (`RoundPlayerTee`) for use in later tasks.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts
git commit -m "feat(api): add playerTees to Round and UpdateRoundBody"
```

---

## Task 3: Scoring engine — `PlayerTee` type + `resolvePlayingHandicaps` (TDD)

**Files:**
- Modify: `artifacts/api-server/src/lib/scoring.ts`
- Test: `artifacts/api-server/src/lib/scoring.test.ts`

This task adds the new per-player handicap resolver and proves no-override parity. The consuming functions are refactored in Task 4.

- [ ] **Step 1: Write the failing tests for `resolvePlayingHandicaps`**

Add to `artifacts/api-server/src/lib/scoring.test.ts` (import `resolvePlayingHandicaps`, `type PlayerTee` at the top alongside the existing imports):
```ts
import { resolvePlayingHandicaps, type PlayerTee } from "./scoring";

describe("resolvePlayingHandicaps", () => {
  const flatTee = (slope: number, rating: number): PlayerTee => ({
    par: Array(18).fill(4),
    holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
    course: { slope, rating, totalPar: 72 },
  });

  it("net: group-relative, plays off the lowest Course Handicap in the group", () => {
    const players = [{ id: 1, handicap: 10 }, { id: 2, handicap: 20 }];
    const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
    const def = flatTee(113, 72); // CR-Par = 0, slope 113 => CH == index
    const r = resolvePlayingHandicaps(players, new Map(), def, assignments, "net");
    assert.equal(r.get(1)!.courseHandicap, 10);
    assert.equal(r.get(2)!.courseHandicap, 20);
    assert.equal(r.get(1)!.playingHandicap, 0);  // low plays scratch
    assert.equal(r.get(2)!.playingHandicap, 10); // 20 - 10
  });

  it("gross: every player plays their full Course Handicap", () => {
    const players = [{ id: 1, handicap: 10 }, { id: 2, handicap: 20 }];
    const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
    const r = resolvePlayingHandicaps(players, new Map(), flatTee(113, 72), assignments, "gross");
    assert.equal(r.get(1)!.playingHandicap, 10);
    assert.equal(r.get(2)!.playingHandicap, 20);
  });

  it("ungrouped players fall back to the field-min Course Handicap", () => {
    const players = [{ id: 1, handicap: 5 }, { id: 2, handicap: 15 }];
    const r = resolvePlayingHandicaps(players, new Map(), flatTee(113, 72), [], "net");
    assert.equal(r.get(1)!.playingHandicap, 0);  // 5 - 5
    assert.equal(r.get(2)!.playingHandicap, 10); // 15 - 5
  });

  it("mixed tees: reference is the true min over per-player Course Handicaps", () => {
    // Player 1 index 12 on a tough tee (slope 140, CR 74 => CH = round(12*140/113 + (74-72)) = round(14.87+2)=17)
    // Player 2 index 12 on an easy tee (slope 100, CR 70 => CH = round(12*100/113 + (70-72)) = round(10.62-2)=9)
    const players = [{ id: 1, handicap: 12 }, { id: 2, handicap: 12 }];
    const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
    const tees = new Map<number, PlayerTee>([
      [1, flatTee(140, 74)],
      [2, flatTee(100, 70)],
    ]);
    const r = resolvePlayingHandicaps(players, tees, flatTee(113, 72), assignments, "net");
    assert.equal(r.get(1)!.courseHandicap, 17);
    assert.equal(r.get(2)!.courseHandicap, 9);
    assert.equal(r.get(2)!.playingHandicap, 0);  // min CH plays scratch
    assert.equal(r.get(1)!.playingHandicap, 8);  // 17 - 9
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/api-server run test`
Expected: FAIL with an import/resolution error for `resolvePlayingHandicaps` / `PlayerTee`.

- [ ] **Step 3: Implement `PlayerTee` + `resolvePlayingHandicaps` in scoring.ts**

In `artifacts/api-server/src/lib/scoring.ts`, after the `whsCourseHandicap` function, add:
```ts
// A player's complete tee card for scoring (own par/holeHcp + course inputs).
export type PlayerTee = {
  par: number[];        // length 18
  holeHcp: number[];    // length 18
  course: CourseInputs; // { slope, rating, totalPar }
};

export type ResolvedHandicap = { courseHandicap: number; playingHandicap: number };

// Compute each player's WHS Course Handicap from THEIR OWN tee, then the
// group-relative reference minimum (lowest Course Handicap within the player's
// assigned group; field-min Course Handicap for ungrouped players), and the
// resulting playing handicap used for per-hole stroke allocation:
//   net   => max(0, ownCH - refMinCH)
//   gross => max(0, ownCH)
// For a round with no overrides this reproduces the legacy result exactly,
// because round() is monotonic so min(round(h*k+c)) == round(min(h)*k+c).
export function resolvePlayingHandicaps(
  players: { id: number; handicap: number }[],
  teeByPlayer: Map<number, PlayerTee>,
  defaultTee: PlayerTee,
  assignments: { playerId: number; groupNumber: number }[],
  mode: HandicapMode
): Map<number, ResolvedHandicap> {
  const chById = new Map<number, number>();
  for (const p of players) {
    const tee = teeByPlayer.get(p.id) ?? defaultTee;
    chById.set(p.id, whsCourseHandicap(p.handicap, tee.course));
  }
  const groupMinCh = new Map<number, number>();
  for (const a of assignments) {
    const ch = chById.get(a.playerId);
    if (ch == null) continue;
    const cur = groupMinCh.get(a.groupNumber);
    if (cur == null || ch < cur) groupMinCh.set(a.groupNumber, ch);
  }
  const allCh = players.map(p => chById.get(p.id) ?? 0);
  const fieldMinCh = allCh.length ? Math.min(...allCh) : 0;
  const playerGroup = new Map(assignments.map(a => [a.playerId, a.groupNumber]));
  const result = new Map<number, ResolvedHandicap>();
  for (const p of players) {
    const ch = chById.get(p.id) ?? 0;
    const grp = playerGroup.get(p.id);
    const refMin = grp != null ? (groupMinCh.get(grp) ?? fieldMinCh) : fieldMinCh;
    const playing = mode === "gross" ? Math.max(0, ch) : Math.max(0, ch - refMin);
    result.set(p.id, { courseHandicap: ch, playingHandicap: playing });
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/api-server run test`
Expected: the four new `resolvePlayingHandicaps` tests PASS. (Existing tests still pass; nothing else changed yet.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/scoring.ts artifacts/api-server/src/lib/scoring.test.ts
git commit -m "feat(scoring): add resolvePlayingHandicaps for per-player tees"
```

---

## Task 4: Scoring engine — refactor consumers to per-player tees (TDD)

**Files:**
- Modify: `artifacts/api-server/src/lib/scoring.ts`
- Test: `artifacts/api-server/src/lib/scoring.test.ts`

Refactor `computePlayerStats`, `computeSkins`, `computeTeamNassau`, `summarizeRound` to consume per-player tee data. Remove the now-superseded `effectiveHandicap`/`buildPlayerMinHcp`. Existing behavioral tests are updated to the new signatures but assert the **same outputs** (parity guardrails); new mixed-tee tests are added.

- [ ] **Step 1: Update `computePlayerStats` signature + body**

In `scoring.ts`, change `computePlayerStats` to take a pre-resolved playing handicap and the player's own `par`/`holeHcp`:
```ts
export function computePlayerStats(
  player: { id: number; name: string; handicap: number },
  holeScores: (number | null)[],
  par: number[],
  holeHcp: number[],
  playingHandicap: number
): PlayerRoundStats {
```
Inside, delete the line `const playingHcp = effectiveHandicap(player.handicap, refMinHcp, mode, course);` and replace with:
```ts
  const playingHcp = playingHandicap;
```
Everything else in the function body is unchanged (it already uses `playingHcp`, `holeHcp[h]`, `par[h]`). The returned `handicap: player.handicap` (the index) is unchanged. Remove the now-unused `refMinHcp`, `mode`, `course` parameters and the dead `front9Complete`/`back9Complete` locals if the linter flags them (they were already dead; leaving them is allowed if config tolerates).

- [ ] **Step 2: Update `computeSkins` signature + body**

```ts
export function computeSkins(
  players: { id: number; name: string; handicap: number }[],
  allHoleScores: Map<number, (number | null)[]>,
  holeHcpByPlayer: Map<number, number[]>,
  playingHcpByPlayer: Map<number, number>
): { skinsWon: Record<number, number>; perHole: SkinHoleResult[] } {
```
Replace the `playingHcps` derivation (the `new Map(players.map(p => [p.id, effectiveHandicap(...)]))`) with direct use of `playingHcpByPlayer`. In the per-hole entry mapping, change the net computation to use each player's own holeHcp:
```ts
      const ownHoleHcp = holeHcpByPlayer.get(p.id) ?? [];
      return { id: p.id, name: p.name, net: g - strokesOnHole(playingHcpByPlayer.get(p.id) ?? 0, ownHoleHcp[h] ?? (h + 1)) };
```
Remove the `mode`/`course` parameters.

- [ ] **Step 3: Update `computeTeamNassau` signature + body**

```ts
export function computeTeamNassau(
  slots: TeamNassauSlot[],
  allHoleScores: Map<number, (number | null)[]>,
  holeHcpByPlayer: Map<number, number[]>,
  playingHcpByPlayer: Map<number, number>,
  mode: HandicapMode
): { matches: TeamNassauMatch[] } {
```
Delete the internal `groupMinHcp` map and the `playingHcp` map derivation (lines computing `effectiveHandicap`). Keep `byGroup` (still needed for team A/B membership). In `playerHoleScore`, change the net branch:
```ts
  function playerHoleScore(playerId: number, h: number): number | null {
    const g = (allHoleScores.get(playerId) ?? [])[h] ?? null;
    if (g == null) return null;
    if (mode === "gross") return g;
    const ownHoleHcp = holeHcpByPlayer.get(playerId) ?? [];
    return g - strokesOnHole(playingHcpByPlayer.get(playerId) ?? 0, ownHoleHcp[h] ?? (h + 1));
  }
```
Remove the `_par` and `course` parameters.

- [ ] **Step 4: Update `summarizeRound`/`SummarizeInputs` for per-player tees**

Change `SummarizeInputs` to accept optional per-player tees:
```ts
export type SummarizeInputs = {
  roundId: number;
  par: number[];
  holeHcp: number[];
  handicapMode: HandicapMode;
  course: CourseInputs;
  players: { id: number; name: string; handicap: number }[];
  scores: Map<number, (number | null)[]>;
  assignments: { playerId: number; groupNumber: number }[];
  playerTees?: Map<number, PlayerTee>; // sparse per-player overrides
};
```
Rewrite the body of `summarizeRound` to resolve per-player tees (replacing the `buildPlayerMinHcp` call):
```ts
export function summarizeRound(inputs: SummarizeInputs): RoundSummary {
  const { par, holeHcp, handicapMode, course, players, scores, assignments } = inputs;
  const defaultTee: PlayerTee = { par, holeHcp, course };
  const teeByPlayer = inputs.playerTees ?? new Map<number, PlayerTee>();
  const resolved = resolvePlayingHandicaps(players, teeByPlayer, defaultTee, assignments, handicapMode);

  let bestNet: number | null = null;
  let bestGross: number | null = null;
  let leaderId: number | null = null;
  let leaderName: string | null = null;
  let holesPlayed = 0;

  for (const p of players) {
    const holes = scores.get(p.id) ?? Array(18).fill(null);
    const tee = teeByPlayer.get(p.id) ?? defaultTee;
    const stats = computePlayerStats(p, holes, tee.par, tee.holeHcp, resolved.get(p.id)?.playingHandicap ?? 0);
    holesPlayed = Math.max(holesPlayed, stats.holesPlayed);

    const candidate = stats.netTotal;
    if (candidate == null) continue;
    if (bestNet == null || candidate < bestNet || (candidate === bestNet && (leaderId == null || p.id < leaderId))) {
      bestNet = candidate;
      bestGross = stats.grossTotal;
      leaderId = p.id;
      leaderName = stats.playerName;
    }
  }

  return { leaderName, leaderNet: bestNet, leaderGross: bestGross, holesPlayed, totalHoles: 18 };
}
```

- [ ] **Step 5: Remove superseded helpers**

Delete `effectiveHandicap` and `buildPlayerMinHcp` from `scoring.ts` (they are fully replaced by `resolvePlayingHandicaps`). Keep `whsCourseHandicap`, `strokesOnHole`, `stablefordPoints`, `fieldMinHandicap` (still used / harmless), and `netForHole` (leave as-is; pre-existing dead export). Search the server for any remaining references:
```bash
grep -rn "effectiveHandicap\|buildPlayerMinHcp" artifacts/api-server/src
```
Expected after edits: only `scoring.test.ts` references remain (fixed in Step 6) plus the call sites in `leaderboard.ts`/`feed.ts` (fixed in Task 5). Note: the client `round.tsx` has its *own* copies — those are not these symbols and are handled in Task 6.

- [ ] **Step 6: Update existing tests to new signatures (assert identical outputs) and add mixed-tee tests**

In `scoring.test.ts`:
- Replace the `buildPlayerMinHcp` import with `resolvePlayingHandicaps` (already imported in Task 3). Convert the two `buildPlayerMinHcp` tests (`[153-186]`) into `resolvePlayingHandicaps` assertions covering the same group-low / field-min-fallback behavior (the Task 3 tests already cover this — delete the now-redundant `buildPlayerMinHcp` tests).
- Update every `computePlayerStats(player, scores, par, holeHcp, refMin, mode, course)` call to the new shape. Compute the playing handicap via `resolvePlayingHandicaps` in the test setup, e.g.:
```ts
const players = [{ id: 1, name: "A", handicap: 10 }, { id: 2, name: "B", handicap: 20 }];
const assignments = [{ playerId: 1, groupNumber: 1 }, { playerId: 2, groupNumber: 1 }];
const defTee = { par, holeHcp, course: { slope: 113, rating: 72, totalPar: 72 } };
const resolved = resolvePlayingHandicaps(players, new Map(), defTee, assignments, "net");
const stats = computePlayerStats(players[1], holes([...]), par, holeHcp, resolved.get(2)!.playingHandicap);
// assertions on stats.netTotal etc. — SAME expected numbers as before
```
- Update `computeSkins(players, scores, holeHcp, minByPlayer, "net", {})` calls: build `holeHcpByPlayer = new Map(players.map(p => [p.id, holeHcp]))` and `playingByPlayer = new Map([...resolved].map(([id,r]) => [id, r.playingHandicap]))`, then call `computeSkins(players, scores, holeHcpByPlayer, playingByPlayer)`. Keep the same expected skins outcomes.
- Update `computeTeamNassau(slots, scores, par, holeHcp, mode, {})` calls to `computeTeamNassau(slots, scores, holeHcpByPlayer, playingByPlayer, mode)`. The slots already carry `handicap`/`groupNumber`; derive `resolved` from the slot players + their group assignments. Keep the same expected match outcomes (this is the parity guardrail for the per-group reference).
- Add NEW tests:
  - **Per-hole strokes use each player's own holeHcp:** two players, identical handicaps, different `holeHcp` orderings; assert the stroke allocation differs per hole.
  - **Stableford uses each player's own par:** two players, different `par` arrays; assert `sfTotal` reflects each player's par.
  - **Mixed-tee net equity (end-to-end via computePlayerStats):** reuse the Task 3 mixed-tee numbers; assert the higher-CH player receives strokes equal to the CH differential.

- [ ] **Step 7: Run the full scoring test suite**

Run: `pnpm --filter @workspace/api-server run test`
Expected: all tests PASS — the updated behavioral tests still produce the original numbers (parity), and the new mixed-tee/stroke/Stableford tests pass.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/lib/scoring.ts artifacts/api-server/src/lib/scoring.test.ts
git commit -m "refactor(scoring): thread per-player tees through stats/skins/nassau/summary"
```

---

## Task 5: Server routes — assembly, GET emit, PATCH diff

**Files:**
- Create: `artifacts/api-server/src/lib/player-tees.ts`
- Test: `artifacts/api-server/src/lib/player-tees.test.ts`
- Modify: `artifacts/api-server/src/routes/leaderboard.ts`
- Modify: `artifacts/api-server/src/lib/feed.ts`
- Modify: `artifacts/api-server/src/routes/rounds.ts`
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Write failing tests for the pure diff/validation helpers**

Create `artifacts/api-server/src/lib/player-tees.test.ts`:
```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePlayerTees, playerTeeIdsToDelete, type DesiredPlayerTee } from "./player-tees";

const card = (playerId: number): DesiredPlayerTee => ({
  playerId, teeBox: "Blue", courseRating: 71.4, courseSlope: 125,
  par: Array(18).fill(4), holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
});

describe("validatePlayerTees", () => {
  it("accepts well-formed cards for players in the round's trip", () => {
    const r = validatePlayerTees([card(1), card(2)], new Set([1, 2, 3]));
    assert.equal(r.ok, true);
  });
  it("rejects a player not in the trip", () => {
    const r = validatePlayerTees([card(9)], new Set([1, 2]));
    assert.equal(r.ok, false);
  });
  it("rejects a non-length-18 par or holeHcp", () => {
    assert.equal(validatePlayerTees([{ ...card(1), par: [4, 4, 4] }], new Set([1])).ok, false);
    assert.equal(validatePlayerTees([{ ...card(1), holeHcp: [1] }], new Set([1])).ok, false);
  });
  it("rejects duplicate playerIds", () => {
    assert.equal(validatePlayerTees([card(1), card(1)], new Set([1])).ok, false);
  });
});

describe("playerTeeIdsToDelete", () => {
  it("returns existing override players not present in the desired set", () => {
    assert.deepEqual(playerTeeIdsToDelete([1, 2, 3], [2]).sort(), [1, 3]);
  });
  it("empty desired clears all existing", () => {
    assert.deepEqual(playerTeeIdsToDelete([1, 2], []).sort(), [1, 2]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/api-server run test`
Expected: FAIL — `./player-tees` cannot be resolved.

- [ ] **Step 3: Implement the pure helpers**

Create `artifacts/api-server/src/lib/player-tees.ts`:
```ts
import type { PlayerTee } from "./scoring";
import type { RoundPlayerTee } from "@workspace/db";

// The override shape accepted on the PATCH body (matches the generated RoundPlayerTee).
export type DesiredPlayerTee = {
  playerId: number;
  teeBox?: string | null;
  courseRating?: number | null;
  courseSlope?: number | null;
  par: number[];
  holeHcp: number[];
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Validate the full-replace override array against the round's trip roster.
export function validatePlayerTees(desired: DesiredPlayerTee[], tripPlayerIds: Set<number>): ValidationResult {
  const seen = new Set<number>();
  for (const t of desired) {
    if (!tripPlayerIds.has(t.playerId)) return { ok: false, error: `Player ${t.playerId} is not in this round's trip` };
    if (seen.has(t.playerId)) return { ok: false, error: `Duplicate override for player ${t.playerId}` };
    seen.add(t.playerId);
    if (!Array.isArray(t.par) || t.par.length !== 18) return { ok: false, error: `par must have 18 values for player ${t.playerId}` };
    if (!Array.isArray(t.holeHcp) || t.holeHcp.length !== 18) return { ok: false, error: `holeHcp must have 18 values for player ${t.playerId}` };
  }
  return { ok: true };
}

// Existing override playerIds that should be deleted given the desired full-replace set.
export function playerTeeIdsToDelete(existingPlayerIds: number[], desiredPlayerIds: number[]): number[] {
  const desired = new Set(desiredPlayerIds);
  return existingPlayerIds.filter(id => !desired.has(id));
}

// Map a DB override row to the API response shape (drops timestamps).
export function toApiPlayerTee(row: RoundPlayerTee) {
  return {
    playerId: row.playerId,
    teeBox: row.teeBox,
    courseRating: row.courseRating,
    courseSlope: row.courseSlope,
    par: row.par,
    holeHcp: row.holeHcp,
  };
}

// Build the sparse Map<playerId, PlayerTee> used by the scoring engine.
export function teeMapFromRows(rows: RoundPlayerTee[]): Map<number, PlayerTee> {
  const m = new Map<number, PlayerTee>();
  for (const r of rows) {
    const par = r.par as number[];
    m.set(r.playerId, {
      par,
      holeHcp: r.holeHcp as number[],
      course: { slope: r.courseSlope, rating: r.courseRating, totalPar: par.reduce((a, b) => a + b, 0) },
    });
  }
  return m;
}
```

- [ ] **Step 4: Run to verify the helper tests pass**

Run: `pnpm --filter @workspace/api-server run test`
Expected: all `player-tees` tests PASS.

- [ ] **Step 5: Refactor the round leaderboard assembly**

In `artifacts/api-server/src/routes/leaderboard.ts`, add imports:
```ts
import { roundPlayerTeesTable } from "@workspace/db";
import { resolvePlayingHandicaps, type PlayerTee } from "../lib/scoring";
import { teeMapFromRows } from "../lib/player-tees";
```
In the **round leaderboard** handler, after `assignments` are loaded and `mode`/`course` are derived, replace the `playerMinHcp`/`stats`/`computeSkins`/`computeTeamNassau` block with:
```ts
  const overrideRows = await db.select().from(roundPlayerTeesTable).where(eq(roundPlayerTeesTable.roundId, roundId));
  const defaultTee: PlayerTee = { par, holeHcp, course };
  const teeByPlayer = teeMapFromRows(overrideRows);
  const resolved = resolvePlayingHandicaps(players, teeByPlayer, defaultTee, assignments, mode);
  const playingByPlayer = new Map([...resolved].map(([id, r]) => [id, r.playingHandicap]));
  const holeHcpByPlayer = new Map(players.map(p => [p.id, (teeByPlayer.get(p.id) ?? defaultTee).holeHcp]));

  const stats = players.map(p => {
    const holeScores = allHoleScoresMap.get(p.id) || Array(18).fill(null);
    const tee = teeByPlayer.get(p.id) ?? defaultTee;
    return computePlayerStats(p, holeScores, tee.par, tee.holeHcp, playingByPlayer.get(p.id) ?? 0);
  });

  const { skinsWon, perHole } = computeSkins(players, allHoleScoresMap, holeHcpByPlayer, playingByPlayer);
  const nassau = computeTeamNassau(slots, allHoleScoresMap, holeHcpByPlayer, playingByPlayer, mode);
```
Remove the now-unused `buildPlayerMinHcp` import from this file.

- [ ] **Step 6: Refactor the trip leaderboard loop (avoid N+1)**

In the **trip leaderboard** handler, before the `for (const round of rounds)` loop, bulk-load all overrides:
```ts
  const roundIds = rounds.map(r => r.id);
  const allOverrides = roundIds.length
    ? await db.select().from(roundPlayerTeesTable).where(inArray(roundPlayerTeesTable.roundId, roundIds))
    : [];
  const overridesByRound = new Map<number, typeof allOverrides>();
  for (const o of allOverrides) {
    const arr = overridesByRound.get(o.roundId) ?? [];
    arr.push(o);
    overridesByRound.set(o.roundId, arr);
  }
```
(Ensure `inArray` is imported from `drizzle-orm`.) Inside the loop, after `course` is derived, replace the `playerMinHcp`/`stats`/`computeSkins` block with:
```ts
    const defaultTee: PlayerTee = { par, holeHcp, course };
    const teeByPlayer = teeMapFromRows(overridesByRound.get(round.id) ?? []);
    const resolved = resolvePlayingHandicaps(players, teeByPlayer, defaultTee, assignments, mode);
    const playingByPlayer = new Map([...resolved].map(([id, r]) => [id, r.playingHandicap]));
    const holeHcpByPlayer = new Map(players.map(p => [p.id, (teeByPlayer.get(p.id) ?? defaultTee).holeHcp]));
    const stats = players.map(p => {
      const holeScores = allHoleScoresMap.get(p.id) || Array(18).fill(null);
      const tee = teeByPlayer.get(p.id) ?? defaultTee;
      return computePlayerStats(p, holeScores, tee.par, tee.holeHcp, playingByPlayer.get(p.id) ?? 0);
    });
    const { skinsWon } = computeSkins(players, allHoleScoresMap, holeHcpByPlayer, playingByPlayer);
```

- [ ] **Step 7: Update the feed summarizer to pass per-player tees**

In `artifacts/api-server/src/lib/feed.ts`: add `roundPlayerTeesTable` to the `@workspace/db` import and `teeMapFromRows` from `./player-tees`. In the bulk-load `Promise.all` block, add a query loading overrides for all feed round ids (keyed like the existing `assignsByRound`/`scoresByRound`):
```ts
  const teeRows = roundIds.length
    ? await db.select().from(roundPlayerTeesTable).where(inArray(roundPlayerTeesTable.roundId, roundIds))
    : [];
  const teesByRound = new Map<number, typeof teeRows>();
  for (const t of teeRows) {
    const arr = teesByRound.get(t.roundId) ?? [];
    arr.push(t);
    teesByRound.set(t.roundId, arr);
  }
```
Then in the `summarizeRound({...})` call, add:
```ts
      playerTees: teeMapFromRows(teesByRound.get(r.id) ?? []),
```

- [ ] **Step 8: Round GET — join + emit `playerTees` (trip route)**

In `artifacts/api-server/src/routes/rounds.ts`: add `roundPlayerTeesTable` to the `@workspace/db` import and `toApiPlayerTee` from `../lib/player-tees`. In the GET `/trips/:tripId/rounds/:roundId` handler, after the visibility check passes and before `res.json(...)`, load overrides and attach them:
```ts
  const teeRows = await db.select().from(roundPlayerTeesTable).where(eq(roundPlayerTeesTable.roundId, params.data.roundId));
  res.json(GetRoundResponse.parse(ser({ ...round, playerTees: teeRows.map(toApiPlayerTee) })));
```
(Replace the existing final `res.json(GetRoundResponse.parse(ser(round)));`.) **Note:** `GetRoundResponse.parse` strips unknown keys, so `playerTees` must be on the object passed in — that's why it's spread here.

- [ ] **Step 9: Round PATCH — apply the full-replace diff in a transaction (trip route)**

In the PATCH `/trips/:tripId/rounds/:roundId` handler, add imports `inArray` (from `drizzle-orm`), `validatePlayerTees`, `playerTeeIdsToDelete`, `toApiPlayerTee` (from `../lib/player-tees`). After the `updateData` object is built and before the final `db.update(...)`, restructure:
```ts
  const wantsTees = parsed.data.playerTees !== undefined;
  if (wantsTees) {
    const desired = parsed.data.playerTees!;
    const tripPlayers = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.tripId, params.data.tripId));
    const validation = validatePlayerTees(desired, new Set(tripPlayers.map(p => p.id)));
    if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
  }

  let updated;
  if (wantsTees) {
    const desired = parsed.data.playerTees!;
    updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(roundsTable).set(updateData)
        .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)))
        .returning();
      const existing = await tx.select({ playerId: roundPlayerTeesTable.playerId })
        .from(roundPlayerTeesTable).where(eq(roundPlayerTeesTable.roundId, params.data.roundId));
      const toDelete = playerTeeIdsToDelete(existing.map(e => e.playerId), desired.map(d => d.playerId));
      if (toDelete.length) {
        await tx.delete(roundPlayerTeesTable)
          .where(and(eq(roundPlayerTeesTable.roundId, params.data.roundId), inArray(roundPlayerTeesTable.playerId, toDelete)));
      }
      for (const t of desired) {
        await tx.insert(roundPlayerTeesTable).values({
          roundId: params.data.roundId, playerId: t.playerId,
          teeBox: t.teeBox ?? null, courseRating: t.courseRating ?? null, courseSlope: t.courseSlope ?? null,
          par: t.par, holeHcp: t.holeHcp,
        }).onConflictDoUpdate({
          target: [roundPlayerTeesTable.roundId, roundPlayerTeesTable.playerId],
          set: { teeBox: t.teeBox ?? null, courseRating: t.courseRating ?? null, courseSlope: t.courseSlope ?? null,
                 par: t.par, holeHcp: t.holeHcp, updatedAt: new Date() },
        });
      }
      return row;
    });
  } else {
    [updated] = await db.update(roundsTable).set(updateData)
      .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)))
      .returning();
  }

  const teeRows = await db.select().from(roundPlayerTeesTable).where(eq(roundPlayerTeesTable.roundId, params.data.roundId));
  res.json(UpdateRoundResponse.parse(ser({ ...updated, playerTees: teeRows.map(toApiPlayerTee) })));
```
(Replace the existing single `db.update(...).returning()` + `res.json(...)` tail.)

- [ ] **Step 10: Solo round GET + PATCH (rounds-me.ts)**

In `artifacts/api-server/src/routes/rounds-me.ts`: add `roundPlayerTeesTable` to the import and the `player-tees` helpers. In the solo **GET** `/rounds/:roundId`, change the final `res.json(ser(round))` to:
```ts
  const teeRows = await db.select().from(roundPlayerTeesTable).where(eq(roundPlayerTeesTable.roundId, roundId));
  res.json(ser({ ...round, playerTees: teeRows.map(toApiPlayerTee) }));
```
In the solo **PATCH** `/rounds/:roundId` (creator-only, `tripId === null` enforced), apply the same diff pattern as Step 9 but the valid player set is the round's solo player(s):
```ts
  const wantsTees = parsed.data.playerTees !== undefined;
  if (wantsTees) {
    const soloPlayers = await db.select({ id: playersTable.id }).from(playersTable)
      .where(eq(playersTable.userId, userId)); // solo player(s) for this user
    const validation = validatePlayerTees(parsed.data.playerTees!, new Set(soloPlayers.map(p => p.id)));
    if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
  }
```
Wrap the round update + tee diff in `db.transaction` exactly as Step 9 (keyed by `roundId`, no `tripId` filter), then emit `ser({ ...updated, playerTees: teeRows.map(toApiPlayerTee) })`. (Solo rounds rarely use overrides, but the path stays shape-consistent.)

- [ ] **Step 11: Typecheck the server**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS. Fix any remaining references to the removed `effectiveHandicap`/`buildPlayerMinHcp` and any leftover old-signature call sites.

- [ ] **Step 12: Run server tests**

Run: `pnpm --filter @workspace/api-server run test`
Expected: PASS (scoring + player-tees).

- [ ] **Step 13: Commit**

```bash
git add artifacts/api-server/src/lib/player-tees.ts artifacts/api-server/src/lib/player-tees.test.ts \
        artifacts/api-server/src/routes/leaderboard.ts artifacts/api-server/src/lib/feed.ts \
        artifacts/api-server/src/routes/rounds.ts artifacts/api-server/src/routes/rounds-me.ts
git commit -m "feat(api-server): emit playerTees, apply PATCH diff, score per-player tees"
```

---

## Task 6: Frontend — Setup override list, grid tee-awareness, badges

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`
- Verify (likely no change): `artifacts/golf-scorecard/src/components/course-search-field.tsx`

- [ ] **Step 1: Surface the looked-up tee list to round.tsx**

`CourseSearchField` accepts an `onCourseSelected?(detail)` prop (already defined). Add state and wire it. Near the other Setup state (`round.tsx:900-922`):
```tsx
  const [availableTees, setAvailableTees] = useState<CourseTee[]>([]);
```
In the Setup tab's `<CourseSearchField .../>` (`round.tsx:1719-1723`), add the callback:
```tsx
            <CourseSearchField
              placeholder="e.g. Pinehurst"
              onTeeApplied={(tee, detail) => applyTee(tee, detail.clubName)}
              onCourseSelected={detail => setAvailableTees(detail.tees)}
              onCleared={() => setAvailableTees([])}
            />
```
If `onCourseSelected`/`onCleared` are not already props of `CourseSearchField`, add them (the component already holds `selectedCourse.tees` internally — emit it when a course is picked/cleared).

- [ ] **Step 2: Add per-player override state, seeded from `round.playerTees`**

Add state and a card type near the Setup state:
```tsx
  type TeeCard = { teeBox: string | null; courseRating: number | null; courseSlope: number | null; par: number[]; holeHcp: number[] };
  const [playerTeeOverrides, setPlayerTeeOverrides] = useState<Map<number, TeeCard>>(new Map());
```
In the one-shot init effect (`round.tsx:924-946`, guarded by `setupInitialized`), seed from the round:
```tsx
      const seeded = new Map<number, TeeCard>();
      for (const t of round.playerTees ?? []) {
        seeded.set(t.playerId, { teeBox: t.teeBox ?? null, courseRating: t.courseRating ?? null, courseSlope: t.courseSlope ?? null, par: t.par, holeHcp: t.holeHcp });
      }
      setPlayerTeeOverrides(seeded);
```

- [ ] **Step 3: Render the per-player override card**

Insert a new card between the Course Info card (ends ~`round.tsx:1785`) and the Handicap card (~`round.tsx:1787`). It iterates `players`, shows each player's current tee (a "Default" pill or the override tee name), a native `<select>` of `availableTees`, and a "Reset to default" action. Match the existing native-`<select>` + inline-HSL-pill style (NOT shadcn). Example:
```tsx
          {/* Per-player tee overrides */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>Per-player tees</h3>
            <p className="text-xs font-sans mb-3" style={{ color: "hsl(38 20% 45%)" }}>
              Everyone uses the round default tee unless overridden here.
              {availableTees.length === 0 && " Look up the course above to choose a tee."}
            </p>
            <div className="flex flex-col gap-2">
              {(players ?? []).map(p => {
                const ov = playerTeeOverrides.get(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-sm font-semibold truncate" style={{ color: "hsl(38 30% 14%)" }}>{p.name}</div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-sans"
                        style={{ background: ov ? "hsl(42 52% 59% / 0.25)" : "hsl(38 25% 85%)", color: "hsl(38 30% 25%)" }}>
                        {ov ? (ov.teeBox ?? "Custom tee") : "Default"}
                      </span>
                    </div>
                    <select
                      value=""
                      disabled={availableTees.length === 0}
                      onChange={e => {
                        const tee = availableTees.find(t => t.id === e.target.value);
                        if (!tee) return;
                        setPlayerTeeOverrides(prev => {
                          const next = new Map(prev);
                          next.set(p.id, { teeBox: tee.name, courseRating: tee.rating, courseSlope: tee.slope, par: tee.par, holeHcp: tee.holeHcp });
                          return next;
                        });
                      }}
                      className="px-2 py-1.5 rounded-lg text-xs font-sans outline-none"
                      style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                    >
                      <option value="">{availableTees.length ? "Override tee…" : "—"}</option>
                      {availableTees.map(t => (<option key={t.id} value={t.id}>{t.name}{t.gender ? ` · ${t.gender}` : ""}</option>))}
                    </select>
                    {ov && (
                      <button type="button" onClick={() => setPlayerTeeOverrides(prev => { const n = new Map(prev); n.delete(p.id); return n; })}
                        className="text-[10px] font-sans underline" style={{ color: "hsl(38 20% 45%)" }}>Reset</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
```

- [ ] **Step 4: Relabel the round default tee selector**

In the Course Info card (`round.tsx:1751-1784`), add a small hint near the Tee Box label that it is the default applied to all players unless overridden. E.g. update the card heading or add: `<p className="text-xs font-sans mb-2" style={{ color: "hsl(38 20% 45%)" }}>Applies to all players unless overridden below.</p>`.

- [ ] **Step 5: Send `playerTees` in `handleSaveSetup`**

In `handleSaveSetup` (`round.tsx:948-986`), add `playerTees` to the `data` object (full-replace; always sent so Save is authoritative):
```tsx
          playerTees: (players ?? [])
            .filter(p => playerTeeOverrides.has(p.id))
            .map(p => {
              const ov = playerTeeOverrides.get(p.id)!;
              return { playerId: p.id, teeBox: ov.teeBox, courseRating: ov.courseRating, courseSlope: ov.courseSlope, par: ov.par, holeHcp: ov.holeHcp };
            }),
```
The existing `onSuccess` invalidations (round, round-LB, trip-LB) already refresh everything — no new query key.

- [ ] **Step 6: Make the client-side grid scoring per-player-tee-aware**

The grid's `course`/`holeHcp`/`fieldMinHcp`/`playingHcps`/`courseHcps` (`round.tsx:988-1028`) currently use a single shared tee. Make them resolve per player from `round.playerTees`. Build a per-player tee resolver and recompute using the same group-relative-over-Course-Handicaps logic now on the server:
```tsx
  const defaultCourse: CourseInputs = { slope: round?.courseSlope ?? null, rating: round?.courseRating ?? null, totalPar: par.reduce((a, b) => a + b, 0) };
  const teeFor = (pid: number): { par: number[]; holeHcp: number[]; course: CourseInputs } => {
    const ov = (round?.playerTees ?? []).find(t => t.playerId === pid);
    if (!ov) return { par, holeHcp, course: defaultCourse };
    return { par: ov.par, holeHcp: ov.holeHcp, course: { slope: ov.courseSlope ?? null, rating: ov.courseRating ?? null, totalPar: ov.par.reduce((a, b) => a + b, 0) } };
  };
  const courseHcps = new Map<number, number>((players ?? []).map(p => [p.id, whsCourseHandicap(p.handicap || 0, teeFor(p.id).course)]));
  // Group-relative reference over per-player Course Handicaps (field-min fallback for ungrouped).
  const groupMinCh = new Map<number, number>();
  for (const a of groupsData?.assignments ?? []) {
    const ch = courseHcps.get(a.playerId); if (ch == null) continue;
    const cur = groupMinCh.get(a.groupNumber);
    if (cur == null || ch < cur) groupMinCh.set(a.groupNumber, ch);
  }
  const fieldMinCh = (players && players.length) ? Math.min(...players.map(p => courseHcps.get(p.id) ?? 0)) : 0;
  const playerGroup = new Map<number, number>((groupsData?.assignments ?? []).map(a => [a.playerId, a.groupNumber]));
  const playingHcps = new Map<number, number>((players ?? []).map(p => {
    const ch = courseHcps.get(p.id) ?? 0;
    const grp = playerGroup.get(p.id);
    const ref = grp != null ? (groupMinCh.get(grp) ?? fieldMinCh) : fieldMinCh;
    return [p.id, handicapMode === "gross" ? Math.max(0, ch) : Math.max(0, ch - ref)];
  }));
```
Then in the per-hole stroke/color computations (`round.tsx:1268,1293,1294`), use each player's own holeHcp via `teeFor(p.id).holeHcp[holeIdx]` instead of the shared `holeHcp[holeIdx]`. The grid's **par/holeHcp header rows stay the round default** (design non-goal: no per-player par row). Keep using the shared `par`/`holeHcp` for the header rendering; only the per-player stroke dots/color and the Course/Playing HCP in the column header reflect overrides.

- [ ] **Step 7: Add a tee badge to the column header and the Results leaderboard**

In the scorecard column header (`round.tsx:1199-1214`), the column is ~52px; add a tiny tee indication inside the existing `title=` tooltip (e.g. append `· <teeName>`), and optionally a one-line abbreviation under the name. Resolve the tee name as `(round.playerTees?.find(t => t.playerId === p.id)?.teeBox) ?? round.teeBox ?? "Default"`.

In the Results leaderboard player row (`round.tsx:1567-1598`), add a small pill next to the "{e.holesPlayed}/18 holes" sub-line showing that player's tee, resolved the same way from `round.playerTees ?? round.teeBox`. Use the inline-HSL pill style (match the "Default" pill from Step 3). No leaderboard-response schema change is needed — `round` is already fetched on this tab.

- [ ] **Step 8: Typecheck the frontend**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: PASS. (Requires Task 2 codegen so `round.playerTees` / `UpdateRoundBody.playerTees` exist.)

- [ ] **Step 9: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/round.tsx artifacts/golf-scorecard/src/components/course-search-field.tsx
git commit -m "feat(ui): per-player tee overrides, tee-aware grid, tee badges"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Whole-repo typecheck**

Run: `pnpm run typecheck`
Expected: PASS across libs + artifacts + scripts.

- [ ] **Step 2: Build**

Run: `pnpm run build`
Expected: typecheck-gated build succeeds for every package.

- [ ] **Step 3: Server tests**

Run: `pnpm --filter @workspace/api-server run test`
Expected: PASS — original behavioral tests (no-override parity) + new mixed-tee/diff tests.

- [ ] **Step 4: Manual smoke (local)**

Start both servers: `pnpm run dev`. Then:
1. Open a trip round's **Setup** tab; look up a course with multiple tees.
2. Assign a different tee to one player; Save. Confirm a "Default"/override pill updates and the round reloads with the override.
3. Open the **Results** tab and the **scorecard grid**: the overridden player shows their tee badge; their Course/Playing HCP and stroke dots reflect the override.
4. Reset the override; Save; confirm the player returns to "Default" and scoring matches the pre-override state.
5. Confirm a round with **no** overrides shows every player on "Default" and leaderboards are unchanged (parity).

- [ ] **Step 5: Finish the branch**

Use `superpowers:finishing-a-development-branch` to merge/PR per the team's preference. PR body should note: new `round_player_tees` table (run `db push` on deploy — the Replit `[postMerge]` hook does this automatically), per-player WHS cross-tee scoring (group-relative reference preserved), and the regenerated client/zod.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §1 Data model → Task 1 (table, index export, CLAUDE.md). ✓
- §2 Scoring (resolve effective tee, CH per player, play-off-low refactor, per-hole strokes, Stableford) → Tasks 3-4. Group-relative preserved (Decision 1); parity proven (Decision 2). ✓
- §3 API contract (Round response, PATCH full-replace, create unchanged, codegen) → Task 2 + Task 5 (handler diff + emit). ✓
- §4 UI (default selector relabel, per-player list, badges, solo modal untouched) → Task 6. Client-grid tee-awareness added (Decision 4). ✓
- Backward compatibility → parity tests (Task 4 Step 6/7), no-override smoke (Task 7 Step 4.5). ✓
- Testing focus (WHS parity, mixed-tee equity, per-hole strokes, Stableford, PATCH full-replace, cascade) → Task 4 (scoring) + Task 5 (diff helpers). Cascade delete is enforced by the schema FKs (Task 1) and exercised by the smoke test. ✓

**Type consistency:** `PlayerTee { par, holeHcp, course }`, `ResolvedHandicap { courseHandicap, playingHandicap }`, `DesiredPlayerTee`, `resolvePlayingHandicaps`, `teeMapFromRows`, `validatePlayerTees`, `playerTeeIdsToDelete`, `toApiPlayerTee` are used consistently across Tasks 3-6. The generated API type is `RoundPlayerTee` (verify exact name in Task 2 Step 5). Scoring functions' new signatures (`computePlayerStats(player, holeScores, par, holeHcp, playingHandicap)`, `computeSkins(players, scores, holeHcpByPlayer, playingHcpByPlayer)`, `computeTeamNassau(slots, scores, holeHcpByPlayer, playingHcpByPlayer, mode)`) match between scoring.ts (Task 4), leaderboard.ts (Task 5), feed.ts (Task 5), and the tests (Task 4).

**Open verification:** the exact generated `RoundPlayerTee` type/zod names are confirmed in Task 2 Step 5 before any consumer relies on them.
