# Per-Player Tee Selection — Design

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan

## Problem

A round currently assumes every player plays from the same tee box. Tee data
(`teeBox`, `courseRating`, `courseSlope`, `par[18]`, `holeHcp[18]`) lives entirely
at the round level in `rounds`. But groups frequently mix tees — most commonly
mixed-gender groups where players use different boxes with different ratings,
slopes, par, and stroke-index allocations. We need to let the user assign a
different tee to individual players within a round, and have scoring reflect it
correctly.

## Goals

- Assign a per-player tee within a round, overriding a round-level default.
- Full per-player tee fidelity: each overridden player carries their own slope,
  rating, `par[18]`, and `holeHcp[18]`.
- Correct WHS cross-tee scoring so mixed-tee net play is equitable.
- Backward compatible: every existing round keeps working unchanged.

## Non-goals

- No per-player **par row** rendered in the scorecard grid. The grid header shows
  the round default tee's par; per-player par only feeds the math.
- Tee assignment is **per-round**, not a trip-wide per-player default (each round
  is a different course with different tee options).
- Solo-round creation flow is unchanged (solo rounds are single-player).

## Design decisions (confirmed)

1. **Scoring depth:** Full WHS cross-tee adjustment.
2. **Data granularity:** Full per-player tee (own slope, rating, `par[18]`,
   `holeHcp[18]`).
3. **Assignment UX:** Round default tee + per-player override.

## 1. Data model

Keep the existing round-level columns (`rounds.teeBox`, `courseRating`,
`courseSlope`, `par`, `holeHcp`) as the **round default tee**. This doubles as the
backward-compatibility path — existing rounds have no override rows and behave
exactly as today.

Add one new table holding **overrides only**:

```
round_player_tees
  roundId      integer  → rounds.id   (fk, on delete cascade)
  playerId     integer  → players.id  (fk, on delete cascade)
  teeBox       text
  courseRating real
  courseSlope  integer
  par          jsonb int[18]   (not null; full card)
  holeHcp      jsonb int[18]   (not null; full card)
  createdAt    timestamp
  updatedAt    timestamp
  PRIMARY KEY (roundId, playerId)
```

- A player with **no** row plays the round default.
- A row carries that player's **complete** tee card.
- Sparse storage: only players who differ from the default get a row.
- Schema is added via Drizzle `db push` (no migrations dir, per project
  convention). New schema file: `lib/db/src/schema/round-player-tees.ts`, exported
  from the schema index and referenced in CLAUDE.md's table list.

## 2. Scoring (`artifacts/api-server/src/lib/scoring.ts`)

The modern WHS Course Handicap formula already implemented in `whsCourseHandicap`
is `HI × (Slope/113) + (CR − Par)`. The `(CR − Par)` term **is** the official WHS
cross-tee adjustment — computing each player's Course Handicap from their own
tee's slope/rating/par is sufficient to make mixed-tee net play equitable. No
separate adjustment lookup table is required.

Changes:

- **Resolve effective tee per player:** `override row ?? round default`. The
  caller (round scoring assembly) builds a per-player `CourseInputs` plus the
  player's effective `par[18]` / `holeHcp[18]`.
- **Course Handicap per player:** compute from that player's own tee data.
- **Net "play off low" refactor:** today `effectiveHandicap(playerHcp, refMinHcp,
  mode, course)` computes both the player's CH and the reference-minimum CH from a
  single shared `course`. With mixed tees this is wrong. Restructure so the round
  scoring path:
  1. Computes every player's Course Handicap from their own tee.
  2. Takes the field **minimum** of those Course Handicaps.
  3. Sets each player's effective (net) handicap = their CH − field-min CH,
     floored at 0 (gross mode stays `max(0, CH)`).
  This keeps the existing `whsCourseHandicap` helper; it changes how the minimum
  reference is derived (from a single shared course → min over per-player CHs).
- **Per-hole strokes** (skins, Nassau, net stroke, match) use each player's own
  `holeHcp` to allocate received strokes.
- **Stableford** uses each player's own `par` per hole.

`computePlayerStats` (and any shared-`par`/`holeHcp`/`course` call sites) accept
per-player tee inputs instead of a single round-shared set.

## 3. API contract (`lib/api-spec/openapi.yaml` → codegen)

- **`Round` response** gains:
  ```yaml
  playerTees:
    type: array
    items:
      type: object
      properties:
        playerId:    { type: integer }
        teeBox:      { type: [string, "null"] }
        courseRating:{ type: [number, "null"] }
        courseSlope: { type: [integer, "null"] }
        par:         { type: array, items: { type: integer } }
        holeHcp:     { type: array, items: { type: integer } }
  ```
  Only overridden players appear in the array.
- **Round `PATCH` body** accepts `playerTees` as a **full-replace** array, with
  standard PATCH presence semantics:
  - **Field absent** (`undefined`) → no change to overrides.
  - **Field present** (array, possibly empty) → the server diffs it against
    existing override rows: upserts players in the array, deletes override rows
    for players not in it. An empty array clears all overrides; omitting an
    individual player clears just that player back to default.
- **Create** stays default-tee only; overrides are set later in the Setup tab.
- Regenerate `api-client-react` and `api-zod` via
  `pnpm --filter @workspace/api-spec run codegen`.

Server: `PATCH /rounds/:roundId` handlers in `rounds.ts` (trip rounds) and
`rounds-me.ts` (personal rounds) apply the `playerTees` diff inside the same
update. Round GET assembly joins `round_player_tees` and emits `playerTees`.

## 4. UI (`artifacts/golf-scorecard/src/pages/round.tsx`, Setup tab)

- The existing single tee selector becomes the **round default tee** (unchanged
  behavior and wording, plus a small "applies to all players unless overridden"
  hint).
- Below it, a **per-player override list**. Each player row shows their current
  tee — a "Default" badge or the override tee name — and a picker populated from
  the looked-up course's tee list. Selecting a tee writes that tee's full card
  (name, rating, slope, par, holeHcp) as the player's override; a "Reset to
  default" action clears it.
- The per-player list pulls available tees from the same course-lookup response
  already used to populate the default selector.
- **Display elsewhere:** each player's tee shown as a small badge on the
  leaderboard and scorecard views. The scorecard grid's par header stays the
  default tee's par row; per-player par is reflected only in computed
  net/Stableford values, not as extra grid rows.
- **Solo-round modal** (`solo-round-modal.tsx`) unchanged.

## Backward compatibility

- Existing rounds have zero `round_player_tees` rows → every player resolves to
  the round default → identical scoring and display to today.
- `playerTees` is absent/empty in responses for such rounds; the UI shows all
  players on "Default".

## Testing focus

- WHS Course Handicap parity: a round with no overrides produces identical
  leaderboards to the pre-change implementation.
- Mixed-tee net equity: two players, different tees, verify field-min reference is
  the true minimum CH and effective handicaps subtract it correctly.
- Per-hole stroke allocation uses each player's own `holeHcp`.
- Stableford uses each player's own `par`.
- PATCH full-replace semantics: adding, changing, and clearing overrides; cascade
  delete when a player or round is removed.
