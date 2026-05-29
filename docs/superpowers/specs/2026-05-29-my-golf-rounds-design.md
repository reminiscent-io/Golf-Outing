# My Golf — Round-First Navigation and Personal-Trip Retirement

**Date:** 2026-05-29
**Status:** Design

## Problem

A single round (one day, one course) is the dominant use case, but the app treats every round as living inside a trip. Solo rounds are silently wrapped in a hidden "personal trip" (`trips.kind = 'personal'`, name `"<Full Name>'s rounds"`) that:

- never appears in `My Trips` ([users-me.ts:54-57](../../artifacts/api-server/src/routes/users-me.ts#L54-L57) filters it out)
- has no nav entry point
- only resurfaces via feed cards (and only for public + completed rounds)
- leaks its label in some surfaces (the trip-hub URL renders for the owner if hit directly)

There is no page that shows "all the rounds you've played." The nav has `My Trips` but no `My Rounds`. The result: solo rounds feel orphaned, the data model and the mental model disagree, and a user looking for a round they logged yesterday cannot find it without going through the feed (and only if it qualifies for the feed at all).

## Goals

1. Make a **round** the primary unit in both UX and schema. Trips become an optional grouping for multi-day, multi-player events.
2. Give every round you've played a single home: a `My Golf → Rounds` page that lists them all (solo and trip-attached, with filter chips).
3. Retire the `kind = 'personal'` trip concept cleanly — no hidden plumbing left behind.
4. Preserve all existing score, kudos, and comment data through the migration.

## Non-goals

- Observer mode for trips ([[observer-mode-requires-auth]]) — out of scope; not affected by this change.
- "Promote standalone rounds into a trip after the fact" — out of scope; trips are still created explicitly.
- Sharing solo rounds with non-authenticated viewers — out of scope; visibility/auth model unchanged.
- Redesigning the round detail page (`RoundPage`) layout — it adapts (hides trip-context UI when there is no trip) but is not restyled.

## User-facing model

A **round** stands on its own. A round MAY belong to a **trip**. A trip is a multi-day, multi-player event with its own leaderboard.

- Solo round: `rounds.tripId IS NULL`. Created via the unified "Log a round" flow with trip picker left at "None".
- Trip round: `rounds.tripId = <event trip id>`. Created either from inside the trip hub or from "Log a round" with a trip picked.

The string "Kevin Lowe's rounds" and the personal-trip concept disappear from all surfaces.

## Navigation

Top-nav swaps `My Trips` for **`My Golf`**, linking to `/my-golf`. The page has two sub-tabs:

| Sub-tab | URL | Default? | Content |
|---|---|---|---|
| Rounds | `/my-golf?tab=rounds` (or `/my-golf`) | yes | List of every round you've played |
| Trips | `/my-golf?tab=trips` | no | Today's `MyTripsPage` content (Created / Joined / Watching buckets) |

`/me/trips` client-side redirects to `/my-golf?tab=trips` so muscle-memory works.

A context-aware "+" affordance in the page header:
- Rounds tab → "Log round" → opens `SoloRoundModal` (renamed conceptually to LogRoundModal but file path can stay)
- Trips tab → "New trip" → navigates to `/trips/new` (unchanged)

The feed FAB stays — same "Log a round" entry point — for capture-from-feed convenience.

## My Golf → Rounds page

Wireframe stored at `.superpowers/brainstorm/61377-1780091177/content/my-rounds-page.html` (regeneratable from this spec).

**Layout:**
- Forest-green page header with title "My Golf", subtitle "Your rounds and trips.", and a brass "+ Log round" pill button on the right.
- Sub-tabs row (`Rounds | Trips`) directly below the header on the same dark background.
- Filter chip row on cream: `All (n) | Solo (n) | Trip (n)`. Counts come from the server response (one query, then client-side filter — the lists are small).
- List grouped by month section labels (`MAY 2026`, `APRIL 2026`, …) in small brass uppercase.

**Round row anatomy:**

```
[ 27 ]  Bethpage Black                          —   ›
[ Tue]  In progress · 11 of 18 holes           play
──────────────────────────────────────────────────
[ 19 ]  Sleepy Hollow                          82   ›
[ Mon]                                       +6 net
──────────────────────────────────────────────────
[ 11 ]  Pacific Dunes — Round 3                79   ›
[ Sun]  [Bandon Weekend]                     −2 net
```

- Left column: day-of-month (serif, large) + abbreviated weekday (uppercase, small).
- Middle: course name (serif). Below it, meta:
  - **In-progress round** (solo or trip) → amber "In progress" pill + `X of 18 holes`.
  - **Solo completed round** → no meta line (no "Solo" badge — solo is the default and the absence of a trip badge is the cue).
  - **Trip completed round** → brass badge with the trip name. **Tapping the badge navigates to `/trips/:tripId`** (trip hub); the badge has stop-propagation. Tapping anywhere else on the row navigates to the round.
- Right column: **gross score** (primary, serif, large), with **net delta** (e.g. `+6 net`, `−2 net`) as smaller subtext below. Color the net subtext greenish when at-or-under net par. For in-progress rounds the gross column shows an em-dash and the subtext shows "play".
- Trailing chevron on the right edge of the row.

**Row tap target:** entire row → round detail (`/rounds/:id` if solo, `/trips/:tripId/rounds/:roundId` if trip). The trip badge has a stop-propagation tap that goes to the trip hub instead.

**Empty states:**
- No rounds at all → "You haven't logged any rounds yet" + primary "Log a round" button (forest accent card, same visual language as `MyTripsPage`'s empty state).
- Filter chip with zero matches → muted single-line message ("No solo rounds yet" / "No trip rounds yet").

**Trips sub-tab:** unchanged from today's `MyTripsPage` — the Created/Joined/Watching grouping, delete affordance on Created rows, etc.

## Log-a-round flow

`SoloRoundModal` (file path unchanged, conceptual name "Log Round") gains one optional field:

- **Trip** (dropdown) — defaults to **None (solo)**. Lists trips where the user has a player row, sorted by most-recent-round date desc. Not sticky: every open resets to "None" so accidental trip-attribution doesn't compound.

When trip is None → POST `/rounds` with `tripId: null`. When trip is selected → POST `/rounds` with `tripId: <selected>`.

Course selection, name, tee box, par/holeHcp arrays — unchanged from today.

On success: navigate to the round detail page.
- Solo → `/rounds/:roundId`.
- Trip → `/trips/:tripId/rounds/:roundId`.

## Round detail routes

| Round kind | URL pattern | Auth gate | Component |
|---|---|---|---|
| Solo (`tripId IS NULL`) | `/rounds/:roundId` (new) | `requireAuth`; non-creators see only public+completed rounds (matches feed visibility rules) | `RoundPage` (existing, adapted) |
| Trip (`tripId IS NOT NULL`) | `/trips/:tripId/rounds/:roundId` (unchanged) | `TripAuthGate` (unchanged) | `RoundPage` (existing) |

`RoundPage` adapts based on whether its loaded round has a `tripId`:
- No trip → hides the "back to leaderboard" link, hides group-assignment UI, the back button targets `/my-golf`.
- Trip → behaves exactly as today.

Old `/trips/:personalTripId/rounds/:roundId` URLs do **not** get a redirect. The user confirms no outstanding shared links exist; feed cards regenerate immediately after migration.

## Schema changes

### Drizzle table edits

`lib/db/src/schema/rounds.ts`:
```ts
tripId: integer("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
// (was: .notNull().references(...))
```

`lib/db/src/schema/players.ts`:
```ts
tripId: integer("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
// (was: .notNull().references(...))
```
Plus a partial unique index in the table builder:
```ts
uniqueIndex("players_solo_per_user").on(t.userId).where(sql`${t.tripId} IS NULL`),
```
This caps each user at one solo-player row.

`lib/db/src/schema/trips.ts`:
- Remove the `kind` column.
- Remove the `trips_personal_per_user` partial unique index.

Cascade semantics unchanged: deleting a trip cascades to its rounds and per-trip player rows. Solo player rows (tripId NULL) and solo rounds (tripId NULL) are untouched.

### Data migration script

`scripts/migrate-retire-personal-trips.ts` (one-shot, idempotent — running twice is a no-op after the first run). Single transaction:

1. Identify personal trip ids: `SELECT id FROM trips WHERE kind = 'personal'`.
2. `DELETE FROM user_trip_follows WHERE trip_id IN (:personalIds)` — defensive; UI shouldn't have created these but covers any stragglers.
3. `UPDATE rounds SET trip_id = NULL WHERE trip_id IN (:personalIds)` — rounds become solo.
4. `UPDATE players SET trip_id = NULL WHERE trip_id IN (:personalIds)` — player rows become solo. Partial unique index is satisfied because each user has at most one personal trip and therefore at most one personal-trip player row.
5. `DELETE FROM trips WHERE id IN (:personalIds)` — orphan trip rows removed.

Preserved by referential design:
- `scores` (FK to `players.id`) — players survive, scores survive.
- `round_kudos`, `round_comments` (FK to `rounds.id`) — rounds survive.
- `round_group_assignments`, `round_group_completions` — solo rounds shouldn't carry group state today; if any do they're preserved but ignored.

The script logs a summary: `N personal trips retired, M rounds detached, P player rows detached, Q follow rows removed`.

### Push sequence (Drizzle uses `db push`, not migrations)

Two phases because step 1 leaves `kind`/the old unique index intact so the data migration can find personal trips by `kind`. The two phases must be **temporally separated by the data migration** — the post-merge auto-push (`scripts/post-merge.sh`) only runs `db push` once with whatever schema is on `main`, so it cannot do this sequencing for us.

Operator workflow on the branch, in order:

1. **Edit Drizzle schema → phase 1** (nullable `tripId` on rounds and players; new `players_solo_per_user` partial unique index). Keep `trips.kind` and `trips_personal_per_user` in place. Run `pnpm --filter @workspace/db run push` against `DATABASE_URL`.
2. **Run data migration** — `pnpm tsx scripts/migrate-retire-personal-trips.ts`. Verify the summary log (N trips, M rounds, P players).
3. **Edit Drizzle schema → phase 2** — drop `trips.kind` and the `trips_personal_per_user` index. Run `pnpm --filter @workspace/db run push`.
4. **Commit the final schema state** (phase 2) and merge. The post-merge auto-push is a no-op because the DB is already at phase 2.

The branch's git history will show the schema files going through phase 1 → phase 2; the merge commit lands phase 2 only. If anyone other than the operator needs to apply the same migration to a different `DATABASE_URL` later, they re-run steps 1–3 against that database before pulling the merged branch.

## OpenAPI / server route changes

`lib/api-spec/openapi.yaml` edits, regenerated via `pnpm --filter @workspace/api-spec run codegen`.

### New endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/rounds` | `requireAuth` | Create a round. Body `{ name, course?, date?, tripId?: number\|null, teeBox?, courseRating?, courseSlope?, par?, holeHcp? }`. If `tripId` is set, caller must be a player in that trip (or its creator); server find-or-creates the player row for the caller. If `tripId` is null/omitted, server find-or-creates the caller's solo player row (one per user, partial-unique). Returns `{ tripId: number\|null, roundId, playerId }`. |
| `GET` | `/rounds/:roundId` | `optional-auth` | Fetch a single round. For trip rounds, equivalent to existing `/trips/:tripId/rounds/:roundId`. For solo rounds, allowed if the caller is the creator OR the round is `visibility='public'` AND `completedAt IS NOT NULL`. |
| `PATCH` | `/rounds/:roundId` | `requireAuth` | Update a round (name, course, date, visibility, completedAt, games config, etc.). Caller must be a player in (or creator of) the round. |
| `DELETE` | `/rounds/:roundId` | `requireAuth` | Delete a round. Caller must be the round's `createdByUserId` (or the trip's creator if trip-attached). |
| `GET` | `/users/me/rounds?filter=all\|solo\|trip` | `requireAuth` | Returns all rounds where the caller has a player row, joined to optional trip. Sorted by `coalesce(date, createdAt)` desc. Filter on the server (cheaper than client-side for users with many rounds). Each item includes `{ round, trip?, gross, net, holesPlayed }` so the list view doesn't need a per-row fetch. |

### Removed endpoints

| Method | Path | Replacement |
|---|---|---|
| `POST` | `/users/me/personal-trip/rounds` | `POST /rounds` with `tripId: null` |
| (No removal) | `POST /trips/:tripId/rounds` | Kept for trip-hub's "Add round" button — it's a convenience alias for `POST /rounds` with `tripId` set. |

### Touched endpoints

- `GET /users/me/trips` ([users-me.ts:54-57](../../artifacts/api-server/src/routes/users-me.ts#L54-L57)) — drop the "hide personal trips" filter; no personal trips exist post-migration.
- `GET /trips/:tripId` ([trips.ts:58-67](../../artifacts/api-server/src/routes/trips.ts#L58-L67)) — drop the `kind === 'personal'` access-control branch.
- `GET /feed` ([feed.ts](../../artifacts/api-server/src/routes/feed.ts)) — change rounds↔trips join from inner to left join. Each `FeedItem`'s `tripId` field becomes nullable; the existing client linking code in `feed-card.tsx:46` switches on null:
  ```ts
  onClick={() => navigate(item.tripId ? `/trips/${item.tripId}/rounds/${item.roundId}` : `/rounds/${item.roundId}`)}
  ```

## Frontend route changes

`artifacts/golf-scorecard/src/App.tsx`:

```ts
<Route path="/" component={HomeOrFeed} />
<Route path="/landing" component={LandingPage} />
<Route path="/trips" component={TripsPage} />
<Route path="/trips/new" component={NewTripPage} />
<Route path="/privacy" component={PrivacyPage} />
<Route path="/my-golf" component={MyGolfPage} />              // NEW
<Route path="/me/trips" component={MyTripsRedirect} />        // NEW: redirects to /my-golf?tab=trips
<Route path="/profile" component={ProfilePage} />
<Route path="/users/:userId" component={UserProfileOrSelf} />
<Route path="/trips/:tripId" component={GatedTripHub} />
<Route path="/rounds/:roundId" component={SoloRoundRoute} />  // NEW: requireAuth only
<Route path="/trips/:tripId/rounds/:roundId" component={GatedRound} />
<Route component={NotFound} />
```

### New components

| File | Purpose |
|---|---|
| `src/pages/my-golf.tsx` | New page. Sub-tab switcher (Rounds / Trips), filter chips (Rounds tab only), context-aware "+" CTA. |
| `src/components/my-rounds-list.tsx` | Rounds list with month section labels and row anatomy described above. Powered by `useListMyRounds` (Orval-generated). |
| `src/components/log-round-modal.tsx` | Refactor of `solo-round-modal.tsx` with the new trip picker. (File path stays for minimal diff; rename is optional cleanup.) |
| `src/components/trip-picker.tsx` | Small dropdown component used inside the modal. Lists trips where user has a player row. |

The Trips sub-tab inside `MyGolfPage` reuses the row markup and bucketing from today's `MyTripsPage` (extract into `src/components/my-trips-list.tsx`).

### Nav update

`src/App.tsx` `NavBar` swaps the `My Trips` link target/text:
- `href` → `/my-golf`
- Label → `My Golf`
- `isMyTrips` boolean becomes `isMyGolf` (matches both `/my-golf` and any `?tab=*` variant).

## Out of scope (follow-ups worth tracking)

- **`createdByUserId` on rounds**: column already exists in [rounds.ts:10](../../lib/db/src/schema/rounds.ts#L10). This spec relies on it for solo-round ownership checks; no schema change needed.
- **Bulk "group rounds into a trip" UX** — explicitly declined for v1 in clarifying Q4.
- **Observer mode** — separate spec; not affected by this work.
- **Renaming `solo-round-modal.tsx` → `log-round-modal.tsx`** — cosmetic; can land in this PR or a follow-up.
- **Profile page changes** — the public profile (`/users/:userId`) renders public+completed rounds. Those will now include solo rounds with no trip context, which already works because the profile renders rounds individually; no spec change needed.

## Validation / test plan

This repo does not have an established server-test harness; validation is via manual + targeted scripts.

- **Migration script:** before running against the real `DATABASE_URL`, run against a snapshot (or local Postgres restored from a `pg_dump`). Verify the summary log (N trips retired, M rounds detached, P players detached, Q follows removed). Run the script a second time; it should report zero work (idempotent). Spot-check that scores attached to the migrated players are intact.
- **`POST /rounds` smoke tests** via the running API:
  - `tripId: null` → returns `{ tripId: null, roundId, playerId }`; player row has `tripId: null, userId: me`.
  - `tripId` set, caller already has a player row → reuses it.
  - `tripId` set, caller not a player and not creator → `403`.
  - `tripId` set, caller is the trip creator but not yet a player → server creates the player row and proceeds.
- **`GET /users/me/rounds`** smoke: confirm `?filter=solo` returns only `tripId IS NULL` rounds; `?filter=trip` returns only `tripId IS NOT NULL`; `?filter=all` returns everything.
- **Client smoke** (in browser at `/my-golf`): mixed solo + trip rounds render, month section labels group correctly, the trip badge stops row propagation and navigates to the trip hub, filter chips switch the list, "+ Log round" CTA opens the modal, modal trip-picker shows only trips where caller has a player row.
- **Feed regression:** a public + completed solo round appears in `/feed?tab=all`; clicking it lands on `/rounds/:id` (not `/trips/:tripId/rounds/:id`).
- **Old-route redirect:** `/me/trips` lands on `/my-golf?tab=trips` and shows the Trips sub-tab.

## Implementation order

1. Drizzle schema phase-1 edits (nullable tripId on rounds + players, new partial unique index).
2. OpenAPI: add `POST /rounds`, `GET /rounds/:id`, `PATCH /rounds/:id`, `DELETE /rounds/:id`, `GET /users/me/rounds`. Regenerate codegen.
3. Server route implementations for the new endpoints. Touch `feed.ts` join. Leave personal-trip-special-case code in place for now.
4. Frontend `MyGolfPage`, `MyRoundsList`, refactored `LogRoundModal` with trip picker, redirect for `/me/trips`. Nav swap.
5. Run data migration script against `DATABASE_URL`.
6. Drizzle schema phase-2 edits (drop `kind`, drop personal-trip unique index). Remove server special cases for `kind === 'personal'` and the personal-trip route file.
7. Final regression pass, then ship.
