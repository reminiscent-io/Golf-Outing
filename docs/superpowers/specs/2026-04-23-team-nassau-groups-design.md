# Team Nassau and four-slot groups — design

## Summary

Tee-time groups become 4-slot structures with global team numbering (Group `G` → Team `2G−1` and Team `2G`). The existing Nassau game mode is reinterpreted as **team Nassau**: a per-group match between the two teams in that group, played as best-ball match play. Individual Nassau goes away. Other game modes (Stableford, Skins, Net Stroke) are unchanged.

## Model

### Slot data

Add a `slot_index` integer column to `round_group_assignments`, with values 1–4. Slots 1–2 belong to the first team in the group, slots 3–4 to the second.

Add a unique index on `(round_id, group_number, slot_index)` so two players can't occupy the same slot.

### Team numbering

Teams are numbered globally across the round:

- Group `G`, slots 1–2 → Team `2G − 1`
- Group `G`, slots 3–4 → Team `2G`

So Group 1 = Teams 1 & 2, Group 2 = Teams 3 & 4, and so on.

### Team-Nassau activity rule

Slots exist for every round regardless of which games are enabled. Team Nassau *runs* on a given group only when:

- The Nassau toggle is on in `gamesConfig`, **and**
- That group has at least one player on each team (at least one filled slot in 1–2 **and** at least one filled in 3–4).

Groups with fewer than 4 players are allowed (threesomes, twosomes). Groups that don't satisfy the activity rule simply don't produce a match card.

## Group editor UI

Each group column renders as a single vertical stack with a team divider:

```
┌─────────────────────┐
│ GROUP 1             │
│                     │
│ TEAM 1              │
│ ┌─────────────┐     │
│ │ Kevin       │     │  ← slot 1
│ ├─────────────┤     │
│ │ (empty)     │     │  ← slot 2
│ └─────────────┘     │
│ ─── vs ───          │
│ TEAM 2              │
│ ┌─────────────┐     │
│ │ Alex        │     │  ← slot 3
│ ├─────────────┤     │
│ │ Sam         │     │  ← slot 4
│ └─────────────┘     │
└─────────────────────┘
```

- Each slot is its own drop target with the slot index embedded in the drop data.
- Drop on an empty slot → place the player there.
- Drop on a filled slot → swap. The occupant moves to the dragger's source slot, or back to Unassigned if the dragger came from there.
- The group has a soft cap of 4: no 5th slot renders, and drops that would exceed the cap are rejected (player stays where they came from).
- "Add group" still works. An added, empty group still shows 4 empty slots.
- **Unassigned column**: keep the "hide when empty" behavior (already shipped). Nothing new here.

Rejected alternative: two side-by-side sub-columns (Team 1 | Team 2). The group column is 180px wide today — side-by-side would be cramped, and stacking reads more naturally as "these two are paired against those two."

## Scoring — team Nassau

For each group where the activity rule holds:

1. **Per-hole team score.** For each hole `h` (1–18), each team's hole score is the *minimum* of its partners' scores on `h`, using the round's `handicapMode` (net if `"net"`, gross if `"gross"`). Partners with no score on `h` are skipped. If neither partner of a team has a score on `h`, that hole is not scorable for either team.
2. **Per-hole match outcome.** Among holes where both teams have a team score, each hole is won by team A, won by team B, or halved.
3. **Front 9 result.** The team that won more holes among holes 1–9 wins Front 9. Tie → halved. Margin = |holes won by winner − holes won by loser|.
4. **Back 9 result.** Same calculation for holes 10–18.
5. **Total 18 result.** Same calculation across all 18 holes.

Output per eligible group:

```ts
{
  groupNumber: number;
  teamA: number;              // global team number
  teamB: number;              // global team number
  teamAPlayerIds: number[];
  teamBPlayerIds: number[];
  front:  "A" | "B" | "halved" | null;   // null = not enough holes scored yet
  back:   "A" | "B" | "halved" | null;
  total:  "A" | "B" | "halved" | null;
  frontMargin: number;  // 0 for halved
  backMargin:  number;
  totalMargin: number;
}
```

No presses. (Scope-bound; can be added later.)

## Results UI

The existing three-box Nassau display (Front / Back / Total winner IDs across the whole field) is replaced by **one card per eligible group**:

```
Group 1 — Team 1 vs Team 2
┌──────────┬──────────┬──────────┐
│  Front 9 │  Back 9  │ Total 18 │
│  Team 1  │  Halved  │  Team 1  │
│   2 up   │  All sq  │   1 up   │
└──────────┴──────────┴──────────┘
```

Rules:

- Groups that don't satisfy the activity rule: not rendered. (No "awaiting" placeholder — reduces clutter.)
- If the Nassau toggle is off: section hidden, same as today.
- Match card shows the team numbers and, below them, the partner names so viewers can tell who's on which team without cross-referencing the Setup tab.

## Setup tab

Rename the "Nassau" toggle to "Team Nassau" so users know what's actually playing. The data key in `gamesConfig` stays `nassau` for back-compat; only the label changes.

## Edge cases

- **Group of 3 (say 2 vs 1):** team B's best-ball is just the single player's score. Match runs normally.
- **Group of 2 with both on the same team:** activity rule fails (team on the other side is empty). No match card.
- **A team has no score on a hole but the other team does:** that hole is skipped for match-play purposes; it's not a win for the team that did score.
- **Partial round:** segments with zero completed holes (both teams together) show as `null` and render in the UI as "—".
- **Group with 4 players, one slot empty later because they drop out:** slot becomes empty, stays at the same slot index; best-ball just works from whoever remains on that team.

## API contract

### Group assignments

- `GET /trips/:tripId/rounds/:roundId/groups` — each assignment in the response now includes `slotIndex` (1–4).
- `PUT /trips/:tripId/rounds/:roundId/groups` — request body's `assignments[].slotIndex` is required (1–4). Server rejects overlapping slot indices within a group.

### Leaderboard

`GET /trips/:tripId/rounds/:roundId/leaderboard` — the `nassauResult` shape changes from `{ frontWinnerIds, backWinnerIds, totalWinnerIds }` to:

```ts
nassauResult: {
  matches: Array<{
    groupNumber: number;
    teamA: number;
    teamB: number;
    teamAPlayerIds: number[];
    teamBPlayerIds: number[];
    front:  "A" | "B" | "halved" | null;
    back:   "A" | "B" | "halved" | null;
    total:  "A" | "B" | "halved" | null;
    frontMargin: number;
    backMargin:  number;
    totalMargin: number;
  }>;
};
```

Generated Zod validators and React Query hooks regenerate via `pnpm --filter @workspace/api-spec run codegen`.

## Migration

Schema change is push-based (no migrations dir), per CLAUDE.md.

Steps:

1. Edit `lib/db/src/schema/round-group-assignments.ts` to add `slotIndex` and the new unique index.
2. Backfill existing rows in a single SQL statement run as part of the push: for each `(round_id, group_number)`, assign `slot_index = ROW_NUMBER() OVER (PARTITION BY round_id, group_number ORDER BY player_id)`.
3. For any legacy groups with more than 4 players (possible today since the current UI has no cap): **delete the overflow assignments** (rows where the computed row-number exceeds 4). Those players revert to Unassigned and the user re-places them through the new UI. This is acceptable given the app is pre-production dev data.
4. Make the column `NOT NULL` after backfill. New writes require a slot index.
5. `pnpm --filter @workspace/db run push` to apply.

Deterministic backfill (sort by `player_id` ascending) means existing rounds get a stable, predictable default pairing that the user can rearrange through the new UI.

## Out of scope

- Presses in Nassau.
- Cross-group Nassau (Team 1 vs Team 3, etc.).
- Team-based Stableford / Skins / Net Stroke.
- Team naming beyond the auto-generated "Team N".
- Separate handicap modes per-game.
