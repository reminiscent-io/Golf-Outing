# Simple Auth Gate + Per-Round Groups — Design

## Goal

Add a lightweight per-trip password gate, a signed-in player identity, and per-round foursome ("group") assignments so each golfer lands on their own group's rows when entering scores.

This is a soft lock for a friends-only scorecard, not real auth.

## Scope

In:
- Per-trip password stored in DB; server-side verification endpoint.
- Client gate on `/trips/:tripId/**` routes: password → player dropdown → persisted in localStorage.
- New `round_group_assignments` table + batch CRUD API.
- Drag-and-drop group admin UI on the round Setup tab.
- Scorecard default-filters to the signed-in player's group, with toggle to "All players".

Out:
- Password hashing / real auth. Plaintext compare, lowercased both sides.
- Role / admin permissions. Any signed-in player can edit groups.
- Leaderboard and trip-standings filtering — those always show the full field.
- Tracking "entered by" for scores.

## Architecture

### 1. Password on trip

Schema change in [lib/db/src/schema/trips.ts](../../../lib/db/src/schema/trips.ts):

```ts
password: text("password").notNull().default(""),
```

- Empty string = password step skipped (identity step still shown so the rest of the app has a signed-in player). Useful for in-development trips.
- Seed `"kiawah"` for the existing Kiawah trip via a one-line SQL update after migration.
- "Create trip" form in [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) gets a password input.

**API** (new route in [artifacts/api-server/src/routes/](../../../artifacts/api-server/src/routes/)):

- `POST /trips/:tripId/auth` — body `{ password: string }`. Server looks up trip, compares `trip.password.toLowerCase() === body.password.toLowerCase()`. Returns `{ ok: true }` on match, 401 on mismatch, 404 on missing trip. Empty trip password → `{ ok: true }` always.
- OpenAPI spec [lib/api-spec/openapi.yaml](../../../lib/api-spec/openapi.yaml) updated; regenerate via `pnpm --filter @workspace/api-spec run codegen`.

**Client gate**:

- New component `<TripAuthGate tripId={...}>{children}</TripAuthGate>` in `artifacts/golf-scorecard/src/components/trip-auth-gate.tsx`.
- Wraps `<TripHubPage>` and `<RoundPage>` in [App.tsx](../../../artifacts/golf-scorecard/src/App.tsx).
- On mount: reads `localStorage["auth:trip:{tripId}"]`. If present and valid shape `{ playerId, playerName }`, renders children.
- Else renders a modal with two steps:
  1. Password input → calls `POST /trips/:tripId/auth` via a generated mutation hook. On success, advance to step 2.
  2. Player dropdown (data from `useListPlayers(tripId)`). Select → write `{ playerId, playerName }` to localStorage → render children.
- Small header control shown in both trip-hub and round pages: "Signed in as <Name> • switch". Switch clears `auth:trip:{tripId}` and re-shows gate.
- localStorage read is defensive: if `JSON.parse` throws or the shape doesn't match `{ playerId: number, playerName: string }`, treat as missing and show the gate.

**Identity hook**: `useTripIdentity(tripId)` returns `{ playerId, playerName } | null` from localStorage with a `storage` event listener so the header updates when "switch" is clicked.

### 2. Groups data model

New schema file `lib/db/src/schema/round-group-assignments.ts`:

```ts
export const roundGroupAssignmentsTable = pgTable("round_group_assignments", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  groupNumber: integer("group_number").notNull(),
}, (t) => ({
  roundPlayerUnique: uniqueIndex("round_player_unique").on(t.roundId, t.playerId),
}));
```

Re-exported from `lib/db/src/schema/index.ts`.

### 3. Groups API

Two endpoints in a new `artifacts/api-server/src/routes/groups.ts`:

- `GET /trips/:tripId/rounds/:roundId/groups` → `{ assignments: [{ playerId: number, groupNumber: number }] }`. Validates round belongs to trip.
- `PUT /trips/:tripId/rounds/:roundId/groups` → body `{ assignments: [{ playerId, groupNumber }] }`. Server:
  1. Validates all `playerId`s belong to the trip (reject 400 if not).
  2. In a transaction: `DELETE … WHERE roundId = :roundId` then `INSERT` the new rows.
  3. Returns the new state.

Simpler than per-row CRUD and matches the drag/drop UX (client sends the whole layout on every change).

OpenAPI updated; codegen run.

### 4. Group admin UI

New component `artifacts/golf-scorecard/src/components/round-groups-editor.tsx`, rendered on the Setup sub-tab of [round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx).

Layout: horizontal flex of columns.
- Column 0: **Unassigned** — every trip player without an assignment.
- Columns 1..N: **Group 1**, **Group 2**, … each headed with its number and an × button (shown only if the group is empty).
- Trailing: **+ Add group** button — appends an empty column locally (group exists only after a player is dropped into it).

Drag/drop: native HTML5 API. Each player chip has `draggable`, `onDragStart` sets a dataTransfer payload `{ playerId }`. Each column accepts drops and on drop updates local state + fires the mutation.

Save: TanStack Query mutation wrapping `PUT .../groups`.
- Optimistic update: update the query cache immediately.
- On error: `invalidateQueries` to refetch authoritative state; show a toast.
- No explicit Save button.

Empty state: if no assignments exist, show a single empty Group 1 column so there's a drop target.

### 5. Scorecard filtering

In [round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) Scorecard sub-tab:

- Read identity via `useTripIdentity(tripId)`.
- Fetch group assignments via a new generated hook `useListRoundGroups(tripId, roundId)`.
- Compute `myGroupNumber = assignments.find(a => a.playerId === identity.playerId)?.groupNumber`.
- Filter state: `viewMode: "mine" | "all"`, persisted in `localStorage["round:{roundId}:view"]`, default `"mine"` when `myGroupNumber` exists, else `"all"`.
- Toggle rendered above the grid: two-button group `[ My group ] [ All players ]`. Hidden entirely if `myGroupNumber` is undefined.
- Filter: when `viewMode === "mine"`, keep players whose assignment has `groupNumber === myGroupNumber`. When `"all"`, keep everyone (current behavior).
- Signed-in player row gets a subtle ring/tint via a CSS class — applies in both modes.

Results sub-tab and trip standings: **unchanged**. Always show the full field.

## Data flow summary

1. User hits `/trips/:tripId` → `TripAuthGate` checks localStorage.
2. Miss → prompts for password → `POST /trips/:tripId/auth` → on 200, shows player dropdown → writes localStorage → renders trip hub.
3. User navigates to a round → round page reads identity + fetches group assignments → scorecard defaults to their group.
4. On Setup tab, user drags chips → each drop fires `PUT .../groups` → query cache updated optimistically.

## Testing

Manual smoke list (checked before shipping):

- Fresh browser: no localStorage → gate appears → wrong password rejected → right password accepted (case-insensitive) → dropdown populated → select → land on trip hub.
- Trip with empty password: gate skips the password step, goes straight to player dropdown.
- Refresh trip page → gate skipped (localStorage hit).
- "Switch" in header → gate reappears.
- Create new trip without password → gate is a no-op (enters immediately; dropdown still shown to pick identity).
- Setup tab: drag players between columns; reload → assignments persist; add/remove groups.
- Scorecard: default shows only my group; toggle to "All"; with no group assignment, toggle is hidden.
- Two players in same group on different devices both see the same filtered view.
- Delete a player from the trip → their assignment row is cascaded away; scorecard no longer lists them.

No automated tests added — matches the existing project posture (no test suite present under [artifacts/golf-scorecard](../../../artifacts/golf-scorecard/) today).

## Migration / rollout

1. Drizzle: push the `trips.password` column and the new `round_group_assignments` table via `pnpm --filter @workspace/db run push`.
2. SQL one-liner to seed the Kiawah trip's password: `UPDATE trips SET password = 'kiawah' WHERE id = <id>;`
3. Deploy server + client together so the new endpoints and gate ship atomically.
4. Existing rounds start with zero group assignments — scorecard falls back to "All players" for everyone until someone sets up groups. No data backfill needed.

## Open questions / explicit non-decisions

- **Hashing**: deferred. If you decide this gate should be more than a soft lock, add bcrypt on the password column and re-hash on next write.
- **Group name vs number**: chose numeric. If you want names ("Scratch crew", "Hackers"), add a `round_groups` table later and migrate.
- **Cross-device identity sync**: not attempted. Each browser stores its own identity. That's fine for a per-person device pattern.
