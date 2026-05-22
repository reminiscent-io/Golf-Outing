# Social Feed Foundation — Design

## Context

Golf Trip today is a closed-circle scorecard: you join a specific trip, see only that trip's rounds, and there's no awareness of what other golfers on the app are doing. The product call here is to flip that — make the app socially default-open, with every completed round becoming a feed post, and the experience of opening the app modeled on Strava: see what your friends played, kudos their good rounds, get pulled into capturing your own. The current four-state trip model (made / playing / watching / none) and the phone+OTP auth wall give us the foundation; what's missing is global identity, a feed, a social graph, and the round-as-post primitive that anchors all of it.

This spec covers Phase 1 — the identity + feed foundation. Phase 2 (Strava-style achievement/PR hooks) and Phase 3 (push/digest engagement layer) are deliberately scoped out and described only in *Future phases* at the end.

## Goal

After this phase ships, a signed-in user can:
1. Open the app and land on a feed showing recent rounds from people they've played with (buddies), people they explicitly follow, or everyone — three tabs.
2. Tap any player anywhere in the app (scorecard, leaderboard, feed) and land on that user's global profile page showing lifetime stats and recent rounds.
3. Search for other users by name and follow them.
4. Log a "solo round" without first creating a trip — single button on the home screen.
5. Watch in-progress rounds live as people play them, including from strangers (the live differentiator vs. Strava).
6. Kudos and comment on any public round.

## Scope

In:
- Global user profile pages (`/users/:userId`).
- User search (name-based, fuzzy).
- Round-as-post: every public completed round is a feed object.
- Solo-round flow: skip trip creation for casual rounds.
- Three-tab feed (Buddies / Following / All).
- Auto-buddy derivation from `round_group_assignments` co-play.
- Explicit follow graph.
- Kudos (single-tap) and comments (one-level threading).
- Live "playing now" feed items for in-progress rounds.
- Per-round visibility flag and per-user phone-discoverability opt-in.

Out (deferred to Phase 2/3):
- Achievements, personal records, streaks.
- Push notifications, weekly digest.
- Photos, captions, rich media.
- Course normalization (course stays free-text for now).
- Trip-recap auto-posts (rounds-only feed in Phase 1).
- Block / mute (privacy-first defaults make this less urgent; add when first user reports a need).

## Architecture

### 1. Schema changes

All additive; one migration round via `pnpm --filter @workspace/db run push`.

**[lib/db/src/schema/users.ts](../../../lib/db/src/schema/users.ts)** — extend `usersTable`:

```ts
discoverableByPhone: boolean("discoverable_by_phone").notNull().default(false),
profileVisibility: text("profile_visibility", { enum: ["public", "private"] }).notNull().default("public"),
```

`discoverableByPhone` is the gate for reverse-lookup search (Venmo's phone-discovery problem is exactly what we're avoiding). `profileVisibility="private"` removes the user from global search/feed listings but doesn't break links shared by direct id.

**[lib/db/src/schema/trips.ts](../../../lib/db/src/schema/trips.ts)** — add a kind discriminator:

```ts
kind: text("kind", { enum: ["event", "personal"] }).notNull().default("event"),
```

`personal` trips are the bucket for solo rounds. Hidden from `/me/trips`, hidden from search, used only as the parent for casual rounds. Exactly one per user, enforced by a partial unique index: `CREATE UNIQUE INDEX trips_personal_per_user ON trips(created_by_user_id) WHERE kind = 'personal'`. The personal-trip detail page (`/trips/:tripId` for `kind=personal`) is private — anyone other than the owner gets a 404 from `GET /trips/:tripId`. Public rounds *inside* a personal trip are still accessible at `/trips/:tripId/rounds/:roundId` because round visibility, not trip visibility, is the access axis (see §7).

**[lib/db/src/schema/rounds.ts](../../../lib/db/src/schema/rounds.ts)** — add visibility and completion marker:

```ts
visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("public"),
completedAt: timestamp("completed_at", { withTimezone: true }),
```

`completedAt` is set when the round is explicitly marked complete OR when all 18 holes have a score for every player. Rounds without `completedAt` show as "playing now" in the feed (only for rounds with at least one player who follows the viewer, OR if the viewer is in the `All` tab). The reason this lives on the round and not derived: a round can legitimately end short (rain delay, walked off after 9) and we still want to post it.

**New: `lib/db/src/schema/user-follows.ts`**:

```ts
followerId: integer("follower_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
followedId: integer("followed_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
// primaryKey: [followerId, followedId]
```

Asymmetric (Strava model). No follow-request flow — public profiles are followable by anyone; private profiles return 403 on the follow endpoint with a "this profile is private" error.

**New: `lib/db/src/schema/round-kudos.ts`**:

```ts
userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
// primaryKey: [userId, roundId]
```

One kudos per user per round. Toggling = delete row. No emoji variants in Phase 1; one tap, one golf-clap.

**New: `lib/db/src/schema/round-comments.ts`**:

```ts
id: serial("id").primaryKey(),
roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
parentCommentId: integer("parent_comment_id").references((): AnyPgColumn => roundCommentsTable.id, { onDelete: "cascade" }),
body: text("body").notNull(),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

One-level reply threading: a comment with non-null `parentCommentId` is a reply; replies to replies flatten to a reply on the same parent (client enforces). Phase 1 keeps it simple.

### 2. Server: API routes

All routes added to [lib/api-spec/openapi.yaml](../../../lib/api-spec/openapi.yaml); regenerate via `pnpm --filter @workspace/api-spec run codegen`.

**Profiles & search**:
- `GET /users/:userId` — public profile payload (name, handicap, profileVisibility, lifetime stats, recent public rounds, follower/following counts, viewer's relationship to this user). Private profiles return only `{ id, fullName, profileVisibility: "private" }`.
- `GET /users/search?q=…&limit=20` — fuzzy match on `fullName` using `pg_trgm` similarity (`%` operator or `similarity()`). Add `extensions: pg_trgm` via Drizzle's extension declaration and a GIN index on `fullName`. Excludes `profileVisibility="private"` users. If the query parses cleanly as an E.164 phone number (the same format used at signup, see [twilio.ts](../../../artifacts/api-server/src/lib/twilio.ts)), the server additionally attempts a phone lookup, returning ONLY users with `discoverableByPhone=true`.
- `GET /users/me/buddies` — derived list: distinct user ids who share at least one round with `me.id` via `players.userId` co-occurrence, ordered by (rounds-together desc, last-round-together desc). Implementation: single SQL query against `players` self-joined on `roundId`. No materialized view in Phase 1 — promote later if pagination slows.

**Follow graph**:
- `POST /users/:userId/follow`, `DELETE /users/:userId/follow`.
- `GET /users/:userId/followers`, `GET /users/:userId/following` (paginated).

**Round visibility & social**:
- `PATCH /rounds/:roundId` — extend existing route to accept `{ visibility, completedAt }` partial updates. Visibility flips: trip creator only. `completedAt` set: any player in the round (this lets each player mark "we're done" without needing the trip owner present).
- `POST /rounds/:roundId/kudos` — creates a row keyed on (viewer.userId, roundId); idempotent. `DELETE /rounds/:roundId/kudos` — deletes the viewer's kudos row only.
- `GET /rounds/:roundId/comments`, `POST /rounds/:roundId/comments`, `DELETE /comments/:commentId` (author-only). Server validates `parentCommentId` (if present) references a comment on the same round with null `parentCommentId` — no deep threading.
- `GET /rounds/:roundId/social` — single endpoint returning `{ kudos: { count, viewerHasKudosed, recentUsers: User[] }, comments: { count, items: Comment[] } }`. Avoids 3 round-trips per feed item.

**Feed**:
- `GET /feed?tab=buddies|following|all&before=…&limit=20` — returns a page of round-posts ordered by `coalesce(completedAt, updatedAt) desc`. Server enforces `rounds.visibility = 'public'` on every tab. Each item embeds: round summary, course/date/scoring config, list of players (with userId joins), best gross + best net for the round, kudos/comment counts, viewer-has-kudosed, viewer's relation to creator. `tab=buddies` filters to rounds where any player.userId ∈ `buddies(me)`. `tab=following` filters to rounds where any player.userId ∈ `me.following`. `tab=all` returns all public rounds, excluding rounds where every linked player has `profileVisibility="private"`. In-progress rounds (no `completedAt`) are included; client renders them differently. Guests with `players.userId = NULL` do not contribute to buddy/follow matching but their names still display on the card.

**Solo round**:
- `POST /me/personal-trip/rounds` — convenience endpoint that finds-or-creates `me`'s `kind=personal` trip, then creates a round inside it and creates the player row linking to `me.userId`. Returns the new `roundId` so the client can route to `/trips/:tripId/rounds/:roundId` exactly like today.

### 3. Server: scoring & post construction

The "post" representation of a round must include best-gross / best-net summaries so feed cards don't have to load full scorecards. The summary lives in the existing scoring layer:

- Extend [artifacts/api-server/src/lib/scoring.ts](../../../artifacts/api-server/src/lib/scoring.ts) with a `summarizeRound(roundId)` that returns `{ leaderName, leaderNet, leaderGross, holesPlayed, totalHoles }`. Reuses existing `computeLeaderboard` internals — do not duplicate scoring math.
- `holesPlayed` powers the "playing now (12/18)" badge for in-progress rounds.

### 4. Client: routing & pages

**New routes** in [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx):

- `/` — currently the My Trips landing; rename current behavior to `/trips` and put the new **Feed page** at `/`. Logged-out users keep seeing the landing.
- `/users/:userId` — global profile page.
- `/search` — search page (or surface as a header search bar on every authed page).

**New page: [artifacts/golf-scorecard/src/pages/feed.tsx](../../../artifacts/golf-scorecard/src/pages/feed.tsx)**:
- Three-tab header: Buddies / Following / All. Default tab = Buddies if `buddies.length > 0`, else All.
- Each card: course, date, "playing now" or "final" status pill, leaderboard summary (top 3 net), kudos/comment row, kudos button, "View scorecard" → `/trips/:tripId/rounds/:roundId`.
- Sticky "Log a round" floating action button → opens a course-picker modal → POSTs to `/me/personal-trip/rounds` → routes to the new round's setup tab.
- TanStack Query: `useInfiniteQuery` for pagination; refetch every 30s for in-progress rounds currently in the viewport (use the existing patterns in `round.tsx` for live polling — reuse, don't reinvent).

**New page: [artifacts/golf-scorecard/src/pages/user-profile.tsx](../../../artifacts/golf-scorecard/src/pages/user-profile.tsx)**:
- Header: name, handicap, follower/following counts, Follow/Unfollow button (hidden if `userId === me.id`).
- Stats strip: total rounds, courses played, best net, average net (last 10 rounds).
- "Recent rounds" list — same card shape as the feed.
- "Buddies" tab — paginated list of co-play users.
- Reuses the new scorecard chrome from the recent profile rebuild (`ed9b5a9 Rebuild Profile page on design tokens with heritage scorecard chrome`). The existing [profile.tsx](../../../artifacts/golf-scorecard/src/pages/profile.tsx) remains the canonical *own*-profile route at `/profile` and gains an inline settings section (handicap, `discoverableByPhone`, `profileVisibility`). `/users/:userId` is the public view for anyone else; if `userId === me.id`, redirect to `/profile`. Both pages share the same data-fetching shape and most UI components — the only delta is the settings section and the Follow button.

**Search**: a header search input visible on Feed and Trips pages, debounced 200ms, drops a popover of matched users with avatar+name+handicap; tapping routes to `/users/:userId`.

**Round-page changes** ([artifacts/golf-scorecard/src/pages/round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx)):
- Add a visibility toggle in the round settings drawer (`Public` / `Private` — single switch).
- Add a "Mark round complete" button visible to the creator when at least 9 holes are scored. Sets `completedAt = now()`.
- Below the leaderboard, add a Kudos + Comments strip that hits `/rounds/:roundId/social`.
- Anywhere a player name appears (scorecard cells, leaderboard rows), make it a link to `/users/:userId` when `player.userId` is non-null.

### 5. Auto-buddy derivation

```sql
-- buddies of user :me
SELECT
  p2.user_id AS buddy_id,
  COUNT(DISTINCT p1.round_id) AS rounds_together,
  MAX(r.created_at) AS last_played
FROM players p1
JOIN players p2 ON p1.round_id = p2.round_id AND p2.user_id <> p1.user_id
JOIN rounds r ON r.id = p1.round_id
WHERE p1.user_id = :me AND p2.user_id IS NOT NULL
GROUP BY p2.user_id
ORDER BY rounds_together DESC, last_played DESC;
```

Index requirements (add via Drizzle): `players(user_id, round_id)`. The query is O(rounds_for_me × players_per_round) which is tiny for years to come. Promote to a materialized view only when `/me/buddies` p95 exceeds 100ms.

### 6. Live in-progress rounds

The big differentiator. Strava can't show a run in progress; we can show a round score-by-score.

- Feed cards with no `completedAt` render a "PLAYING NOW · 12/18" badge.
- TanStack Query `refetchInterval: 30_000` set only on visible in-progress items (use IntersectionObserver to scope the refetch — don't poll the whole feed).
- Tapping an in-progress card routes to the scorecard view in read-only mode. This requires finally building observer mode in [trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx): if the viewer has no `useTripIdentity` entry for this trip AND the round is `visibility=public`, render children in read-only mode (no score-editing handlers wired). The existing player-picker gate still fires when the viewer is opening a trip they're a player in. Observer mode does NOT bypass auth — viewers must still be signed in (see memory: [[observer-mode-requires-auth]]).

### 7. Privacy & abuse posture

- Default profile = public, default round = public, default discoverable-by-phone = OFF.
- A user can flip their profile to `private` in `/profile` settings; private profiles are not returned by search, not followable, and their rounds are excluded from the `All` feed (but remain visible to co-players inside the trip).
- A round flipped to `private` is excluded from the feed and from the player's public profile, but co-players in the same trip still see it on the trip page.
- Profile settings (toggle `discoverableByPhone`, toggle `profileVisibility`) added to [artifacts/golf-scorecard/src/pages/profile.tsx](../../../artifacts/golf-scorecard/src/pages/profile.tsx) — both default to safe values, the user opts into wider visibility deliberately.
- No block/mute in Phase 1. Phone-discoverability is opt-in, which is the main Venmo-style risk. Add explicit block when the first user reports needing it.

## Data flow: "Kevin logs a solo round at his local muni"

1. Kevin opens the app → lands on Feed → Buddies tab.
2. Taps "Log a round" → course picker modal pulls from the existing `/api/course-lookup` proxy.
3. Picks course → POST `/me/personal-trip/rounds` with `{ course, name }`.
4. Server finds Kevin's personal trip (or creates it on first call), creates a round, creates a `players` row linking `userId=kevin.id`, returns `roundId`.
5. Client routes to `/trips/:personalTripId/rounds/:roundId`, identical scorecard UI.
6. Kevin enters scores. After hole 18 or "Mark complete," `completedAt` is set.
7. The round now appears in the global feed under `All` (everyone's), and in `Buddies` for anyone who has played with Kevin before.
8. Kevin's buddy Sam opens the app → sees Kevin's round → taps Kudos → kudos count goes up → optionally taps in to leave "nice round" comment.

## Verification

Manual:
- Sign up as user A, sign up as user B (different phone), have both play a round together via existing trip flow → confirm each appears in the other's Buddies tab.
- User A logs a solo round → confirm it appears in personal trip only, not in My Trips list.
- User A flips a round to private → confirm B no longer sees it on `All` feed but still sees it inside the trip.
- User C (stranger) searches "Kevin" → finds user A → follows → user A's next round appears in C's Following tab.
- User A starts a round and enters 12 holes → C sees the live card with "PLAYING NOW · 12/18", refetching every 30s; tapping shows read-only scorecard.
- User A's profile, when viewed by C, shows stats and recent rounds; user A's `private`-flipped round is absent.

Automated:
- API contract: regenerated Orval hooks for every new endpoint typecheck cleanly.
- DB: `pnpm --filter @workspace/db run push` applies cleanly to a fresh local DB; new columns default correctly on existing rows.
- Server unit: `summarizeRound` returns correct best-net for a partially-scored round; auto-buddy query returns expected ordering on a fixture.

## Future phases (not in this spec)

**Phase 2 — Strava-style engagement hooks**:
- Achievements derived at round completion (broke 80/90/100, first eagle/birdie/par, course-conquered, sub-handicap round). Materialize into a `user_achievements` table.
- Personal records per course (course stays free-text in Phase 2; course normalization is its own follow-on).
- Round streaks (rounds-per-week, rounds-per-month).
- "Tag who you played with" prompt after marking a round complete — surfaces non-buddy co-players as suggested follows.
- Trip-recap auto-post when a trip with 2+ rounds completes (replaces individual cards in Buddies with a single grouped card).

**Phase 3 — Engagement loop**:
- Web push (PWA shell already in place on this branch).
- Weekly digest: "you played 2 rounds this week, here's how you stack up against your buddies."
- Notifications on kudos / comments / new follow.
- "It's been 3 weeks since your last round" nudge.

The Strava habit-formation magic is concentrated in Phase 2 — the achievements + PRs + tag-your-buddies loop is what creates the "I have to log this round" reflex. Phase 1 builds the substrate without which Phase 2 has nothing to broadcast to.
