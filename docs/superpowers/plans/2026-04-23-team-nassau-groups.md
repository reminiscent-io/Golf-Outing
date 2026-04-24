# Team Nassau and four-slot groups — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn tee-time groups into 4-slot structures where slots 1–2 form one team and slots 3–4 form the other, and reinterpret the Nassau game mode as a per-group two-man best-ball match-play Nassau.

**Architecture:** Add `slot_index` (1–4) to `round_group_assignments`. The group-editor UI binds players to specific slots (drag-drop per slot). Team numbering is derived globally: Group `G` → Team `2G−1` (slots 1–2) and Team `2G` (slots 3–4). Server-side `computeNassau` is rewritten to take group assignments and return one match per group. Results UI renders one card per match. Stableford, Skins, and Net Stroke are unchanged.

**Tech stack:** pnpm workspace, Drizzle ORM / Postgres, Express + Zod (backend), React 19 + TanStack Query + Tailwind (frontend), OpenAPI + Orval codegen. Tests: `node --test` via tsx (no new deps).

**Spec:** [docs/superpowers/specs/2026-04-23-team-nassau-groups-design.md](../specs/2026-04-23-team-nassau-groups-design.md)

---

## Preflight

Before starting:

- [ ] **Confirm branch & sync.** Plan assumes work continues on `fix/course-selection-unknown`. Run `git fetch origin && git status -sb`. If remote has diverged, `git pull --rebase origin fix/course-selection-unknown`.
- [ ] **Stash or commit ad-hoc edits.** There's an uncommitted "hide Unassigned when empty" change in `artifacts/golf-scorecard/src/components/round-groups-editor.tsx`. Task 6 rewrites that file from scratch, so either commit the existing change first (`git add artifacts/golf-scorecard/src/components/round-groups-editor.tsx && git commit -m "Hide Unassigned column when all players are placed"`) or `git stash` it — don't leave it uncommitted.
- [ ] **Confirm `DATABASE_URL` is set** in `.env`. The backfill script requires it.

---

## Task 1: Database schema — add `slot_index`, backfill, enforce uniqueness

**Files:**
- Modify: `lib/db/src/schema/round-group-assignments.ts`
- Create: `scripts/migrate-add-slot-index.ts`

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-add-slot-index.ts`:

```ts
import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Add column (nullable for backfill).
    await client.query(`
      ALTER TABLE round_group_assignments
      ADD COLUMN IF NOT EXISTS slot_index integer
    `);

    // 2. Backfill: rank by player_id within each (round_id, group_number).
    await client.query(`
      WITH ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY round_id, group_number
            ORDER BY player_id
          ) AS rn
        FROM round_group_assignments
      )
      UPDATE round_group_assignments rga
      SET slot_index = ranked.rn
      FROM ranked
      WHERE rga.id = ranked.id
    `);

    // 3. Delete overflow rows (groups that had >4 players today).
    const overflow = await client.query(
      `DELETE FROM round_group_assignments WHERE slot_index > 4 RETURNING id`
    );
    console.log(`Deleted ${overflow.rowCount ?? 0} overflow assignment(s).`);

    // 4. Make NOT NULL and add unique index.
    await client.query(`
      ALTER TABLE round_group_assignments
      ALTER COLUMN slot_index SET NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS round_group_slot_unique
      ON round_group_assignments (round_id, group_number, slot_index)
    `);

    await client.query("COMMIT");
    console.log("Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the migration**

```bash
pnpm exec tsx scripts/migrate-add-slot-index.ts
```

Expected output:

```
Deleted N overflow assignment(s).
Migration complete.
```

- [ ] **Step 3: Update schema to match the new shape**

Replace the body of `lib/db/src/schema/round-group-assignments.ts`:

```ts
import { pgTable, serial, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { roundsTable } from "./rounds";
import { playersTable } from "./players";

export const roundGroupAssignmentsTable = pgTable("round_group_assignments", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  groupNumber: integer("group_number").notNull(),
  slotIndex: integer("slot_index").notNull(),
}, (t) => ({
  roundPlayerUnique: uniqueIndex("round_player_unique").on(t.roundId, t.playerId),
  roundGroupSlotUnique: uniqueIndex("round_group_slot_unique").on(t.roundId, t.groupNumber, t.slotIndex),
}));

export type RoundGroupAssignment = typeof roundGroupAssignmentsTable.$inferSelect;
```

- [ ] **Step 4: Verify schema matches DB**

```bash
pnpm --filter @workspace/db run push
```

Expected: drizzle-kit reports "No changes detected" (schema now matches the DB state set up by the migration script). If changes are detected, inspect them — they should only be trivial (e.g., index ordering).

- [ ] **Step 5: Typecheck**

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/round-group-assignments.ts scripts/migrate-add-slot-index.ts
git commit -m "Add slot_index to round_group_assignments with backfill migration"
```

---

## Task 2: OpenAPI spec — `slotIndex` and new `NassauResult` shape

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerated (not hand-edited): `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

- [ ] **Step 1: Update `RoundGroupAssignment` schema**

In `lib/api-spec/openapi.yaml`, find the `RoundGroupAssignment` schema (around line 961) and replace with:

```yaml
    RoundGroupAssignment:
      type: object
      properties:
        playerId:
          type: integer
        groupNumber:
          type: integer
          minimum: 1
        slotIndex:
          type: integer
          minimum: 1
          maximum: 4
      required:
        - playerId
        - groupNumber
        - slotIndex
```

- [ ] **Step 2: Replace `NassauResult` schema**

Find `NassauResult` (around line 876) and replace with:

```yaml
    NassauResult:
      type: object
      properties:
        matches:
          type: array
          items:
            $ref: "#/components/schemas/TeamNassauMatch"
      required:
        - matches

    TeamNassauMatch:
      type: object
      properties:
        groupNumber:
          type: integer
        teamA:
          type: integer
        teamB:
          type: integer
        teamAPlayerIds:
          type: array
          items:
            type: integer
        teamBPlayerIds:
          type: array
          items:
            type: integer
        front:
          type: ["string", "null"]
          enum: ["A", "B", "halved", null]
        back:
          type: ["string", "null"]
          enum: ["A", "B", "halved", null]
        total:
          type: ["string", "null"]
          enum: ["A", "B", "halved", null]
        frontMargin:
          type: integer
        backMargin:
          type: integer
        totalMargin:
          type: integer
      required:
        - groupNumber
        - teamA
        - teamB
        - teamAPlayerIds
        - teamBPlayerIds
        - front
        - back
        - total
        - frontMargin
        - backMargin
        - totalMargin
```

- [ ] **Step 3: Regenerate client code**

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: both `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` are rewritten. The script also typechecks. It should PASS. If it fails, the failure is most likely a consumer (route, frontend) whose expected shape changed — fix in later tasks, not here. Continue only if codegen itself succeeded.

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "Extend OpenAPI for slot-indexed group assignments and team Nassau matches"
```

---

## Task 3: Groups route — persist and return `slotIndex`

**Files:**
- Modify: `artifacts/api-server/src/routes/groups.ts`

- [ ] **Step 1: Update GET handler to include slot_index**

In `groups.ts`, change the SELECT in the GET handler to include `slotIndex`:

```ts
  const rows = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    groupNumber: roundGroupAssignmentsTable.groupNumber,
    slotIndex: roundGroupAssignmentsTable.slotIndex,
  }).from(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, params.data.roundId));
```

- [ ] **Step 2: Update PUT handler — validate slots and persist them**

In the PUT handler, replace the assignment-validation and insert blocks. Add a per-group slot-uniqueness check before insertion:

```ts
  // Reject duplicate (groupNumber, slotIndex) pairs within the request.
  const slotKey = (groupNumber: number, slotIndex: number) => `${groupNumber}:${slotIndex}`;
  const seenSlots = new Set<string>();
  for (const a of parsed.data.assignments) {
    const k = slotKey(a.groupNumber, a.slotIndex);
    if (seenSlots.has(k)) {
      res.status(400).json({ error: `Duplicate slot ${a.slotIndex} in group ${a.groupNumber}` });
      return;
    }
    seenSlots.add(k);
  }
```

Insert block becomes:

```ts
    if (parsed.data.assignments.length > 0) {
      await tx.insert(roundGroupAssignmentsTable).values(
        parsed.data.assignments.map(a => ({
          roundId: params.data.roundId,
          playerId: a.playerId,
          groupNumber: a.groupNumber,
          slotIndex: a.slotIndex,
        }))
      );
    }
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 4: Smoke-test by starting the server**

```bash
pnpm --filter @workspace/api-server run dev
```

Expected: server starts on `PORT` with no errors. Stop with Ctrl-C once verified.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/groups.ts
git commit -m "Persist and validate slot index on group assignments"
```

---

## Task 4: Scoring — team Nassau

**Files:**
- Modify: `artifacts/api-server/src/lib/scoring.ts`
- Create: `artifacts/api-server/src/lib/scoring.test.ts`

We'll use TDD: write the tests first using Node's built-in `node --test` runner via `tsx`. No new dependencies.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/scoring.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTeamNassau, type TeamNassauSlot } from "./scoring";

function holes(values: Array<number | null>): (number | null)[] {
  return values.length === 18 ? values : [...values, ...Array(18 - values.length).fill(null)];
}

const par = Array(18).fill(4);
const holeHcp = Array.from({ length: 18 }, (_, i) => i + 1);

describe("computeTeamNassau", () => {
  it("returns no matches when there are no groups", () => {
    const result = computeTeamNassau([], new Map(), par, holeHcp, 0, "gross", {});
    assert.deepEqual(result.matches, []);
  });

  it("emits one match per group with both teams filled", () => {
    // Group 1: player 1 (slot 1), player 2 (slot 3). Team A = [1], Team B = [2].
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "Alpha", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "Bravo", handicap: 0, groupNumber: 1, slotIndex: 3 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])], // team A total = 71
      [2, holes([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5])], // team B total = 73
    ]);

    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    assert.equal(result.matches.length, 1);
    const m = result.matches[0];
    assert.equal(m.groupNumber, 1);
    assert.equal(m.teamA, 1);
    assert.equal(m.teamB, 2);
    assert.deepEqual(m.teamAPlayerIds, [1]);
    assert.deepEqual(m.teamBPlayerIds, [2]);
    assert.equal(m.front, "A"); // A won hole 1 (3 vs 4), halved 8 others
    assert.equal(m.frontMargin, 1);
    assert.equal(m.back, "B"); // B conceded +1 on hole 18
    assert.equal(m.backMargin, 1);
    assert.equal(m.total, "halved");
    assert.equal(m.totalMargin, 0);
  });

  it("uses best-ball within a team", () => {
    // Team A has two players; only partner 2's lower score should count.
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A1", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "A2", handicap: 0, groupNumber: 1, slotIndex: 2 },
      { playerId: 3, playerName: "B1", handicap: 0, groupNumber: 1, slotIndex: 3 },
      { playerId: 4, playerName: "B2", handicap: 0, groupNumber: 1, slotIndex: 4 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([5])],          // A's worse
      [2, holes([3])],          // A's better — team A hole 1 = 3
      [3, holes([4])],
      [4, holes([4])],          // Team B hole 1 = 4
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    const m = result.matches[0];
    // Team A wins hole 1 on best-ball (3 vs 4). Other holes all null — not scored.
    assert.equal(m.front, "A");
    assert.equal(m.frontMargin, 1);
    assert.equal(m.back, null);
    assert.equal(m.total, "A");
    assert.equal(m.totalMargin, 1);
  });

  it("skips groups with no players on one side", () => {
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A1", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "A2", handicap: 0, groupNumber: 1, slotIndex: 2 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([4])],
      [2, holes([4])],
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    assert.deepEqual(result.matches, []);
  });

  it("handles multiple groups with correct global team numbers", () => {
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "B", handicap: 0, groupNumber: 1, slotIndex: 3 },
      { playerId: 3, playerName: "C", handicap: 0, groupNumber: 2, slotIndex: 1 },
      { playerId: 4, playerName: "D", handicap: 0, groupNumber: 2, slotIndex: 3 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([])], [2, holes([])], [3, holes([])], [4, holes([])],
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].teamA, 1);
    assert.equal(result.matches[0].teamB, 2);
    assert.equal(result.matches[1].teamA, 3);
    assert.equal(result.matches[1].teamB, 4);
  });

  it("halves a hole when both teams' best-ball scores are equal", () => {
    const slots: TeamNassauSlot[] = [
      { playerId: 1, playerName: "A", handicap: 0, groupNumber: 1, slotIndex: 1 },
      { playerId: 2, playerName: "B", handicap: 0, groupNumber: 1, slotIndex: 3 },
    ];
    const scores = new Map<number, (number | null)[]>([
      [1, holes([4])],
      [2, holes([4])],
    ]);
    const result = computeTeamNassau(slots, scores, par, holeHcp, 0, "gross", {});
    // Only hole 1 scored, halved → front/total both halved, back null
    const m = result.matches[0];
    assert.equal(m.front, "halved");
    assert.equal(m.frontMargin, 0);
    assert.equal(m.back, null);
    assert.equal(m.total, "halved");
    assert.equal(m.totalMargin, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec node --import tsx --test artifacts/api-server/src/lib/scoring.test.ts
```

Expected: test run errors with `Cannot find export "computeTeamNassau"` or similar. That's the signal to implement.

- [ ] **Step 3: Implement `computeTeamNassau` and remove old `computeNassau`**

In `artifacts/api-server/src/lib/scoring.ts`, **replace** the existing `computeNassau` function (lines 200–225) with this:

```ts
export type TeamNassauSlot = {
  playerId: number;
  playerName: string;
  handicap: number;
  groupNumber: number;
  slotIndex: number; // 1..4
};

export type TeamNassauMatch = {
  groupNumber: number;
  teamA: number;
  teamB: number;
  teamAPlayerIds: number[];
  teamBPlayerIds: number[];
  front: "A" | "B" | "halved" | null;
  back: "A" | "B" | "halved" | null;
  total: "A" | "B" | "halved" | null;
  frontMargin: number;
  backMargin: number;
  totalMargin: number;
};

export function computeTeamNassau(
  slots: TeamNassauSlot[],
  allHoleScores: Map<number, (number | null)[]>,
  _par: number[],
  holeHcp: number[],
  fieldMinHcp: number,
  mode: HandicapMode,
  course: CourseInputs
): { matches: TeamNassauMatch[] } {
  // Group slots by group number.
  const byGroup = new Map<number, TeamNassauSlot[]>();
  for (const s of slots) {
    const arr = byGroup.get(s.groupNumber) ?? [];
    arr.push(s);
    byGroup.set(s.groupNumber, arr);
  }

  const playingHcp = new Map<number, number>();
  for (const s of slots) {
    playingHcp.set(s.playerId, effectiveHandicap(s.handicap, fieldMinHcp, mode, course));
  }

  // For each hole, each player's score in the chosen mode (net or gross).
  function playerHoleScore(playerId: number, h: number): number | null {
    const g = (allHoleScores.get(playerId) ?? [])[h] ?? null;
    if (g == null) return null;
    if (mode === "gross") return g;
    return g - strokesOnHole(playingHcp.get(playerId) ?? 0, holeHcp[h]);
  }

  // Best-ball for a set of player ids on hole h — min of their scores, ignoring nulls.
  function teamHoleScore(ids: number[], h: number): number | null {
    let best: number | null = null;
    for (const id of ids) {
      const s = playerHoleScore(id, h);
      if (s == null) continue;
      if (best == null || s < best) best = s;
    }
    return best;
  }

  const matches: TeamNassauMatch[] = [];

  for (const groupNumber of [...byGroup.keys()].sort((a, b) => a - b)) {
    const groupSlots = byGroup.get(groupNumber)!;
    const teamA = (groupNumber - 1) * 2 + 1;
    const teamB = (groupNumber - 1) * 2 + 2;
    const teamAPlayerIds = groupSlots.filter(s => s.slotIndex <= 2).map(s => s.playerId);
    const teamBPlayerIds = groupSlots.filter(s => s.slotIndex >= 3).map(s => s.playerId);

    // Activity rule: both sides must have at least one player.
    if (teamAPlayerIds.length === 0 || teamBPlayerIds.length === 0) continue;

    let frontA = 0, frontB = 0;
    let backA = 0, backB = 0;
    let frontHolesScored = 0, backHolesScored = 0;

    for (let h = 0; h < 18; h++) {
      const a = teamHoleScore(teamAPlayerIds, h);
      const b = teamHoleScore(teamBPlayerIds, h);
      if (a == null || b == null) continue;
      const aWins = a < b;
      const bWins = b < a;
      if (h < 9) {
        frontHolesScored++;
        if (aWins) frontA++;
        else if (bWins) frontB++;
      } else {
        backHolesScored++;
        if (aWins) backA++;
        else if (bWins) backB++;
      }
    }

    const decide = (aWins: number, bWins: number, scored: number): { side: "A" | "B" | "halved" | null; margin: number } => {
      if (scored === 0) return { side: null, margin: 0 };
      if (aWins > bWins) return { side: "A", margin: aWins - bWins };
      if (bWins > aWins) return { side: "B", margin: bWins - aWins };
      return { side: "halved", margin: 0 };
    };

    const frontOutcome = decide(frontA, frontB, frontHolesScored);
    const backOutcome = decide(backA, backB, backHolesScored);
    const totalOutcome = decide(frontA + backA, frontB + backB, frontHolesScored + backHolesScored);

    matches.push({
      groupNumber,
      teamA,
      teamB,
      teamAPlayerIds,
      teamBPlayerIds,
      front: frontOutcome.side,
      back: backOutcome.side,
      total: totalOutcome.side,
      frontMargin: frontOutcome.margin,
      backMargin: backOutcome.margin,
      totalMargin: totalOutcome.margin,
    });
  }

  return { matches };
}
```

Also **delete** the old `computeNassau` export entirely. (If the codebase still compiles after, its callers have already been removed or will be updated in Task 5.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec node --import tsx --test artifacts/api-server/src/lib/scoring.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/scoring.ts artifacts/api-server/src/lib/scoring.test.ts
git commit -m "Add computeTeamNassau scoring with best-ball match-play semantics"
```

---

## Task 5: Leaderboard route — wire team Nassau in

**Files:**
- Modify: `artifacts/api-server/src/routes/leaderboard.ts`

- [ ] **Step 1: Update imports and add group-assignments query**

In `leaderboard.ts`, update the import line for db and scoring:

```ts
import { db, roundsTable, playersTable, scoresTable, tripsTable, roundGroupAssignmentsTable } from "@workspace/db";
```

Update the scoring import:

```ts
import { computePlayerStats, computeSkins, computeTeamNassau, fieldMinHandicap } from "../lib/scoring";
```

- [ ] **Step 2: Replace the Nassau block in the round-leaderboard handler**

In the `/trips/:tripId/rounds/:roundId/leaderboard` handler, after the `computeSkins` line (around line 53), replace:

```ts
  const nassau = computeNassau(stats);
```

with:

```ts
  const assignments = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    groupNumber: roundGroupAssignmentsTable.groupNumber,
    slotIndex: roundGroupAssignmentsTable.slotIndex,
  }).from(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, roundId));

  const playerById = new Map(players.map(p => [p.id, p]));
  const slots = assignments
    .map(a => {
      const p = playerById.get(a.playerId);
      return p ? { playerId: p.id, playerName: p.name, handicap: p.handicap, groupNumber: a.groupNumber, slotIndex: a.slotIndex } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

  const nassau = computeTeamNassau(slots, allHoleScoresMap, par, holeHcp, minHcp, mode, course);
```

And replace the `nassauResult` field in the response:

```ts
    nassauResult: { matches: nassau.matches },
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 4: Smoke-test**

```bash
pnpm --filter @workspace/api-server run dev
```

Hit `GET /api/trips/:tripId/rounds/:roundId/leaderboard` (use a real tripId/roundId from your dev DB) in a browser or `curl` and verify the response includes `nassauResult.matches`. Stop the server once verified.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/leaderboard.ts
git commit -m "Wire team Nassau into round leaderboard"
```

---

## Task 6: Frontend — rewrite `RoundGroupsEditor` with 4-slot layout

**Files:**
- Modify: `artifacts/golf-scorecard/src/components/round-groups-editor.tsx` (rewrite)

This task rewrites the component. The previous "hide Unassigned when empty" fix should already be committed (see Preflight); this rewrite subsumes and preserves that behavior.

- [ ] **Step 1: Replace the component**

Overwrite `artifacts/golf-scorecard/src/components/round-groups-editor.tsx` with:

```tsx
import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRoundGroups,
  usePutRoundGroups,
  useListPlayers,
  getListRoundGroupsQueryKey,
  getListPlayersQueryKey,
} from "@workspace/api-client-react";
import { Plus, X } from "lucide-react";

type Assignment = { playerId: number; groupNumber: number; slotIndex: number };
type Source = { from: "unassigned" } | { from: "slot"; groupNumber: number; slotIndex: number };

type Props = {
  tripId: number;
  roundId: number;
};

const SLOTS_PER_GROUP = 4;

export function RoundGroupsEditor({ tripId, roundId }: Props) {
  const queryClient = useQueryClient();
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: groupsData } = useListRoundGroups(tripId, roundId, {
    query: { queryKey: getListRoundGroupsQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const putGroups = usePutRoundGroups({
    mutation: {
      onMutate: async ({ tripId: tid, roundId: rid, data }) => {
        const qk = getListRoundGroupsQueryKey(tid, rid);
        await queryClient.cancelQueries({ queryKey: qk });
        const prev = queryClient.getQueryData(qk);
        queryClient.setQueryData(qk, data);
        return { prev, qk };
      },
      onError: (_err, { tripId: tid, roundId: rid }, ctx) => {
        const qk = getListRoundGroupsQueryKey(tid, rid);
        if (ctx?.prev !== undefined) queryClient.setQueryData(qk, ctx.prev);
        queryClient.invalidateQueries({ queryKey: qk });
      },
      onSettled: (_data, _err, { tripId: tid, roundId: rid }) => {
        queryClient.invalidateQueries({ queryKey: getListRoundGroupsQueryKey(tid, rid) });
      },
    },
  });

  const serverAssignments: Assignment[] = groupsData?.assignments ?? [];

  // Group numbers currently in use. Always include at least Group 1.
  const serverGroupNumbers = useMemo(() => {
    const s = new Set<number>(serverAssignments.map(a => a.groupNumber));
    s.add(1);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverAssignments]);

  const [extraGroups, setExtraGroups] = useState<number[]>([]);
  useEffect(() => {
    setExtraGroups(prev => prev.filter(n => !serverGroupNumbers.includes(n)));
  }, [serverGroupNumbers]);

  const allGroupNumbers = useMemo(() => {
    const s = new Set<number>([...serverGroupNumbers, ...extraGroups]);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverGroupNumbers, extraGroups]);

  // slotAt.get(`${groupNumber}:${slotIndex}`) = playerId
  const slotAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of serverAssignments) m.set(`${a.groupNumber}:${a.slotIndex}`, a.playerId);
    return m;
  }, [serverAssignments]);

  const assignedPlayerIds = useMemo(
    () => new Set(serverAssignments.map(a => a.playerId)),
    [serverAssignments]
  );
  const unassignedPlayers = (players ?? []).filter(p => !assignedPlayerIds.has(p.id));

  function save(next: Assignment[]) {
    putGroups.mutate({ tripId, roundId, data: { assignments: next } });
  }

  // Move a player into a specific slot, possibly swapping with the current occupant.
  function moveToSlot(playerId: number, source: Source, target: { groupNumber: number; slotIndex: number }) {
    const existing = serverAssignments.filter(a => a.playerId !== playerId);
    const occupantId = slotAt.get(`${target.groupNumber}:${target.slotIndex}`) ?? null;

    let working = existing.filter(a => !(occupantId != null && a.playerId === occupantId));

    working.push({ playerId, groupNumber: target.groupNumber, slotIndex: target.slotIndex });

    if (occupantId != null) {
      if (source.from === "slot") {
        working.push({ playerId: occupantId, groupNumber: source.groupNumber, slotIndex: source.slotIndex });
      }
      // If source was unassigned, displaced occupant goes to unassigned — no append needed.
    }

    save(working);
  }

  function moveToUnassigned(playerId: number) {
    save(serverAssignments.filter(a => a.playerId !== playerId));
  }

  function addGroup() {
    const nextNumber = (allGroupNumbers[allGroupNumbers.length - 1] ?? 0) + 1;
    setExtraGroups(prev => [...prev, nextNumber]);
  }

  function removeEmptyGroup(groupNumber: number) {
    if (serverAssignments.some(a => a.groupNumber === groupNumber)) return;
    setExtraGroups(prev => prev.filter(n => n !== groupNumber));
  }

  function onDragStart(e: React.DragEvent, playerId: number, source: Source) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ playerId, source }));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function readDrag(e: React.DragEvent): { playerId: number; source: Source } | null {
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.playerId !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function onDropSlot(e: React.DragEvent, groupNumber: number, slotIndex: number) {
    e.preventDefault();
    const drag = readDrag(e);
    if (!drag) return;
    moveToSlot(drag.playerId, drag.source, { groupNumber, slotIndex });
  }

  function onDropUnassigned(e: React.DragEvent) {
    e.preventDefault();
    const drag = readDrag(e);
    if (!drag) return;
    moveToUnassigned(drag.playerId);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max py-2">
        {unassignedPlayers.length > 0 && (
          <UnassignedColumn
            players={unassignedPlayers.map(p => ({ id: p.id, name: p.name }))}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDropUnassigned}
          />
        )}
        {allGroupNumbers.map(gn => {
          const teamA = (gn - 1) * 2 + 1;
          const teamB = (gn - 1) * 2 + 2;
          const slots = Array.from({ length: SLOTS_PER_GROUP }, (_, i) => {
            const slotIndex = i + 1;
            const playerId = slotAt.get(`${gn}:${slotIndex}`) ?? null;
            const player = playerId != null ? players?.find(p => p.id === playerId) ?? null : null;
            return { slotIndex, playerId, player };
          });
          const isEmpty = slots.every(s => s.playerId == null);
          const canRemove = isEmpty && extraGroups.includes(gn);
          return (
            <GroupColumn
              key={gn}
              groupNumber={gn}
              teamA={teamA}
              teamB={teamB}
              slots={slots}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDropSlot={onDropSlot}
              onRemove={canRemove ? () => removeEmptyGroup(gn) : undefined}
            />
          );
        })}
        <button
          onClick={addGroup}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg self-start font-sans text-xs font-600"
          style={{ background: "hsl(158 35% 20%)", color: "hsl(42 52% 59%)" }}
        >
          <Plus size={14} />
          Add group
        </button>
      </div>
    </div>
  );
}

type UnassignedProps = {
  players: Array<{ id: number; name: string }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

function UnassignedColumn({ players, onDragStart, onDragOver, onDrop }: UnassignedProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="min-w-[180px] w-[180px] rounded-xl p-3"
      style={{ background: "hsl(158 35% 14%)", border: "1px solid hsl(158 40% 20%)" }}
    >
      <div className="mb-2 text-xs font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
        Unassigned
      </div>
      <div className="space-y-2 min-h-[40px]">
        {players.map(p => (
          <div
            key={p.id}
            draggable
            onDragStart={e => onDragStart(e, p.id, { from: "unassigned" })}
            className="px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing text-sm font-sans"
            style={{ background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)" }}
          >
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

type GroupProps = {
  groupNumber: number;
  teamA: number;
  teamB: number;
  slots: Array<{ slotIndex: number; playerId: number | null; player: { id: number; name: string } | null }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onRemove?: () => void;
};

function GroupColumn({ groupNumber, teamA, teamB, slots, onDragStart, onDragOver, onDropSlot, onRemove }: GroupProps) {
  const teamASlots = slots.filter(s => s.slotIndex <= 2);
  const teamBSlots = slots.filter(s => s.slotIndex >= 3);

  return (
    <div
      className="min-w-[180px] w-[180px] rounded-xl p-3"
      style={{ background: "hsl(158 35% 14%)", border: "1px solid hsl(158 40% 20%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
          Group {groupNumber}
        </div>
        {onRemove && (
          <button onClick={onRemove} className="hover:opacity-80" style={{ color: "hsl(42 20% 55%)" }}>
            <X size={14} />
          </button>
        )}
      </div>
      <TeamSection label={`Team ${teamA}`} groupNumber={groupNumber} slots={teamASlots} onDragStart={onDragStart} onDragOver={onDragOver} onDropSlot={onDropSlot} />
      <div className="my-2 text-[10px] font-sans text-center uppercase tracking-widest" style={{ color: "hsl(42 20% 45%)" }}>
        vs
      </div>
      <TeamSection label={`Team ${teamB}`} groupNumber={groupNumber} slots={teamBSlots} onDragStart={onDragStart} onDragOver={onDragOver} onDropSlot={onDropSlot} />
    </div>
  );
}

type TeamSectionProps = {
  label: string;
  groupNumber: number;
  slots: Array<{ slotIndex: number; playerId: number | null; player: { id: number; name: string } | null }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
};

function TeamSection({ label, groupNumber, slots, onDragStart, onDragOver, onDropSlot }: TeamSectionProps) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 35% 60%)" }}>
        {label}
      </div>
      <div className="space-y-1.5">
        {slots.map(s => (
          <SlotCell
            key={s.slotIndex}
            groupNumber={groupNumber}
            slotIndex={s.slotIndex}
            player={s.player}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDropSlot={onDropSlot}
          />
        ))}
      </div>
    </div>
  );
}

type SlotCellProps = {
  groupNumber: number;
  slotIndex: number;
  player: { id: number; name: string } | null;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
};

function SlotCell({ groupNumber, slotIndex, player, onDragStart, onDragOver, onDropSlot }: SlotCellProps) {
  const filled = player != null;
  return (
    <div
      onDragOver={onDragOver}
      onDrop={e => onDropSlot(e, groupNumber, slotIndex)}
      className="px-2.5 py-2 rounded-lg text-sm font-sans"
      style={
        filled
          ? { background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)" }
          : { background: "transparent", color: "hsl(42 20% 50%)", border: "1.5px dashed hsl(158 40% 22%)" }
      }
      draggable={filled}
      onDragStart={filled && player ? e => onDragStart(e, player.id, { from: "slot", groupNumber, slotIndex }) : undefined}
    >
      {filled ? player!.name : "—"}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @workspace/golf-scorecard run typecheck
```

Expected: PASS.

- [ ] **Step 3: Visual sanity check**

Start both dev servers (in separate terminals):

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/golf-scorecard run dev
```

Load a trip → round → Setup tab and confirm:
- Groups render with "Team X / vs / Team Y" structure and 4 dashed slot placeholders when empty.
- Dragging a player from Unassigned to a specific slot places them in that slot.
- Dragging a player from one slot to another (within or across groups) swaps correctly.
- Dragging a player back into Unassigned clears them.
- "Add group" still works.
- Unassigned column hides when all players are placed.

Stop both servers.

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/components/round-groups-editor.tsx
git commit -m "Refactor group editor into 4-slot layout with team sections"
```

---

## Task 7: Frontend — Team Nassau label and per-group match cards

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`

- [ ] **Step 1: Rename the Nassau toggle label**

In `round.tsx`, find the Games section (around line 939). The label is derived from the key via `game.charAt(0).toUpperCase() + game.slice(1)`, which would produce "Nassau". Change the render line so "nassau" displays as "Team Nassau":

```tsx
                  <span className="font-sans text-sm font-semibold" style={{ color: "hsl(38 30% 14%)" }}>
                    {game === "netStroke" ? "Net Stroke Play" : game === "nassau" ? "Team Nassau" : game.charAt(0).toUpperCase() + game.slice(1)}
                  </span>
```

- [ ] **Step 2: Replace the Nassau results block**

In `round.tsx`, find the existing Nassau rendering block:

```tsx
              {/* Nassau */}
              {leaderboard.nassauResult && (
                <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
                  <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-3" style={{ color: "hsl(38 20% 38%)" }}>Nassau</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Front 9", ids: leaderboard.nassauResult.frontWinnerIds },
                      { label: "Back 9", ids: leaderboard.nassauResult.backWinnerIds },
                      { label: "Total 18", ids: leaderboard.nassauResult.totalWinnerIds },
                    ].map(({ label, ids }) => (
                      <div key={label} className="rounded-lg p-3 text-center" style={{ background: "hsl(158 35% 20%)" }}>
                        <div className="text-[10px] font-sans uppercase tracking-widest mb-1" style={{ color: "hsl(42 20% 55%)" }}>{label}</div>
                        <div className="font-serif text-sm font-semibold" style={{ color: "hsl(42 52% 59%)" }}>
                          {ids.length === 0 ? "—" : ids.map(id => leaderboard.entries.find(e => e.playerId === id)?.playerName?.split(" ")[0]).join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
```

Replace the whole block with:

```tsx
              {/* Team Nassau — one card per group match */}
              {leaderboard.nassauResult?.matches && leaderboard.nassauResult.matches.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-sans font-semibold text-xs uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
                    Team Nassau
                  </h3>
                  {leaderboard.nassauResult.matches.map(m => {
                    const nameFor = (id: number) =>
                      leaderboard.entries.find(e => e.playerId === id)?.playerName?.split(" ")[0] ?? `#${id}`;
                    const teamAName = m.teamAPlayerIds.map(nameFor).join(" / ") || "—";
                    const teamBName = m.teamBPlayerIds.map(nameFor).join(" / ") || "—";
                    const outcomeLabel = (side: "A" | "B" | "halved" | null, margin: number) => {
                      if (side == null) return "—";
                      if (side === "halved") return margin === 0 ? "All square" : "Halved";
                      return `${side === "A" ? `Team ${m.teamA}` : `Team ${m.teamB}`} ${margin} up`;
                    };
                    return (
                      <div key={m.groupNumber} className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
                        <div className="flex items-baseline justify-between mb-2">
                          <div className="font-sans font-semibold text-xs uppercase tracking-widest" style={{ color: "hsl(38 20% 38%)" }}>
                            Group {m.groupNumber}
                          </div>
                          <div className="font-sans text-xs" style={{ color: "hsl(38 20% 45%)" }}>
                            Team {m.teamA} ({teamAName}) vs Team {m.teamB} ({teamBName})
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Front 9", side: m.front, margin: m.frontMargin },
                            { label: "Back 9", side: m.back, margin: m.backMargin },
                            { label: "Total 18", side: m.total, margin: m.totalMargin },
                          ].map(seg => (
                            <div key={seg.label} className="rounded-lg p-3 text-center" style={{ background: "hsl(158 35% 20%)" }}>
                              <div className="text-[10px] font-sans uppercase tracking-widest mb-1" style={{ color: "hsl(42 20% 55%)" }}>{seg.label}</div>
                              <div className="font-serif text-sm font-semibold" style={{ color: "hsl(42 52% 59%)" }}>
                                {outcomeLabel(seg.side, seg.margin)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/golf-scorecard run typecheck
```

Expected: PASS. If TypeScript complains that the generated `nassauResult` shape doesn't match — revisit Task 2 (OpenAPI codegen). Generated types drive this.

- [ ] **Step 4: Visual sanity check**

Start both dev servers and verify in the Results tab:
- Setup with 4 players in Group 1 (slots 1–4) → enter scores on a few holes → switch to Results tab → see a "Group 1" match card with Front/Back/Total outcomes.
- With 0 or 1 sides of a group filled → no card is rendered for that group.
- Toggle Team Nassau off in Setup → card disappears from Results.

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "Render team Nassau as per-group match cards; rename game label"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Clean checkout**

```bash
git status
```

Expected: clean working tree.

- [ ] **Step 2: Full typecheck**

```bash
pnpm run typecheck
```

Expected: PASS across all packages.

- [ ] **Step 3: Full scoring test run**

```bash
pnpm exec node --import tsx --test artifacts/api-server/src/lib/scoring.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Manual golden path**

With both dev servers running:

1. Create a trip with 4 players (if you don't have one).
2. Create a round; enable Team Nassau in Setup → Active Games.
3. Setup → Groups: drag each player into a slot in Group 1 (e.g., player A → slot 1, B → slot 2, C → slot 3, D → slot 4).
4. Scorecard: enter scores for a handful of holes (at least 1 front, 1 back).
5. Results: confirm a "Group 1" match card appears with team labels "Team 1" and "Team 2" and outcomes shown.
6. Setup → drag player A to Unassigned → Results card should still render (team 1 now has just player B via best-ball of 1).
7. Drag player B to Unassigned too → Results card for Group 1 should disappear.
8. Setup → drag 4 players back into Group 1 → add Group 2 → assign no one → confirm no card for Group 2.

- [ ] **Step 5: Push**

```bash
git push
```

If rejected due to remote Replit deployment commits, rebase and retry:

```bash
git pull --rebase origin fix/course-selection-unknown
git push
```

---

## Rollback

If something goes wrong mid-rollout:

- **Schema:** `ALTER TABLE round_group_assignments DROP COLUMN slot_index; DROP INDEX IF EXISTS round_group_slot_unique;` and revert `lib/db/src/schema/round-group-assignments.ts`.
- **API:** `git revert` the relevant commits; rerun codegen from the original spec.
- **Frontend:** components are self-contained; revert the two component commits.

## Out of scope (do not implement)

- Presses on Nassau.
- Team-based Stableford/Skins/Net Stroke.
- Editable team nicknames.
- Cross-group Nassau matches.
