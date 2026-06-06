# Connections & Safe Phone-Tag Claiming — Design

## Context

Golf Trip lets you create a round, enter scores, and tag the other players who played with you — but those tagged players are just **placeholder rows** (`players` with `user_id IS NULL` and a typed name like "Dave"). There is no safe way for the real Dave to later claim his scores, and — more urgently — there is *no restriction on who can claim them*. Today any signed-in user who opens a trip gets the "Who are you?" picker and can stamp themselves onto **any** unclaimed player row ([trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx), [players.ts](../../../artifacts/api-server/src/routes/players.ts)). Commit `44ed5a4` made claiming "self-claim only" at the field level (the body's `userId` must equal the caller's), but it did nothing to restrict *which* row you may claim. That is the hole this spec closes.

The product goal is larger: a **Connections** surface — the people you've played with, whether or not they're on the app — that lets a placeholder name resolve to the real person's account once they sign up, so their history and the mutual "we played together" relationship light up. This spec covers the **foundation**: Connections + safe claiming. Two follow-on capabilities are deliberately deferred (see *Future phases*):

- Surfacing a connection's external round history and the mutual "played with me" feed.
- Reaching out to / following a specific co-player.

## Goal

After this phase ships:

1. A signed-in user has a **Connections** tab (`/my-golf?tab=connections`) listing everyone they've played with — split into people who are on the app (linked accounts) and people who aren't yet (pending placeholders).
2. When adding/tagging a co-player, the creator can optionally attach that person's **phone number**, and/or generate a **share link** to send them.
3. When a tagged person signs in, if their OTP-verified phone matches the tag — or they arrive via a valid share link — they see a one-time **review-&-confirm** screen ("You were tagged in N rounds — claim them?") and, on accept, their placeholder rows link to their account and adopt their profile name.
4. **No random account holder can claim a tagged round.** A tagged row is reserved for its phone (or its single-use code); only an open, untagged row remains freely claimable as today.

## Scope

**In:**

- `players.invited_phone` column (E.164, server-side-only) + `players.claim_code` column (single-use per-row token).
- The **core claim guard** applied everywhere a `user_id` is stamped onto a player row.
- `GET /me/connections` — derived co-player list (accounts + pending), reusing/generalizing the feed `buddies` derivation.
- Optional phone tagging on player create/update; share-link generation per player.
- `GET /me/claimable`, `POST /me/claims` — the review-&-confirm claim flow (phone-match path + code path, both server-re-validated).
- `GET /claim/:code` public invite-preview + landing route.
- Connections tab UI, phone-tag field, share affordance, claim-review modal.
- Name adoption at claim (overwrite placeholder with profile `fullName`; stays per-trip editable).

**Out (deferred):**

- A connection's external round history / "played with me" feed (Future phase 2).
- Following or messaging a specific co-player (Future phase 2).
- A separate `contacts`/address-book entity. Identity is carried by `user_id` (once claimed) and `invited_phone` (before). Revisit only if cross-trip dedup of *un*tagged accountless people becomes a real need.
- Multiple/rotatable codes per row with full history (a single overwriteable `claim_code` is enough).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Claim trust anchor | **Phone tag** — OTP-verified phone match. Not a typed string; a proven-controlled number. |
| Resolve UX | **Review & confirm** — one-time prompt, accept/decline, consented on both sides. |
| Name resolution | **Adopt at claim, still editable** — `players.name` ← profile `fullName` on accept; row remains per-trip editable. |
| Invite layer | **Share link, phone stays the gate** — link is a convenience deep-link; binding requires phone-match *or* a per-name single-use code. |
| First slice | **Foundation only** — Connections + safe claiming; history/reach-out deferred. |

## The core rule

Every code path that stamps a `user_id` onto a player row MUST pass:

> **`players.user_id IS NULL`** AND
> ( **`players.invited_phone IS NULL`** — open row, claimable as today —
>   OR **`players.invited_phone = caller's OTP-verified phone`** — phone-matched —
>   OR **a valid, unredeemed `players.claim_code` was presented** — code-matched )

This single guard is the security boundary. It is enforced **server-side, per row**, in the claim endpoint *and* retrofitted into the existing self-claim path in [players.ts](../../../artifacts/api-server/src/routes/players.ts) so the "Who are you?" picker can no longer grab a tagged row. A tagged row is *reserved*; an untagged row stays *open* (backward-compatible with link-shared trips).

## Architecture

### 1. Schema changes

Additive; one `pnpm --filter @workspace/db run push`.

**[lib/db/src/schema/players.ts](../../../lib/db/src/schema/players.ts)** — extend `playersTable`:

```ts
invitedPhone: text("invited_phone"),            // E.164, normalized via normalizePhone; null = open placeholder
claimCode: text("claim_code"),                  // random single-use token for the share link; null when none/redeemed
```

Indexes:
- `index("players_invited_phone_idx").on(t.invitedPhone)` — sign-in claimable lookup.
- `uniqueIndex("players_claim_code_idx").on(t.claimCode).where(sql`claim_code IS NOT NULL`)` — code lookup; partial so multiple nulls are allowed.

**Privacy:** `invited_phone` and `claim_code` are **never returned** to clients in any player response. The list/serialize paths must strip them; the OpenAPI response schemas must not include them. They are write-only inputs + server-side match keys.

**Per-trip identity guard:** there is no `unique(user_id, trip_id)` today. The claim flow must not create a second linked row for a user already in that trip — guard in application code (see Edge cases). Adding the DB constraint is optional and risky against existing data; defer.

### 2. Connections derivation — `GET /me/connections` (requireAuth)

Generalizes the feed `buddies` query ([feed.ts:53-68](../../../artifacts/api-server/src/routes/feed.ts#L53-L68)) with two changes:

1. **Participation via `round_group_assignments`**, not `scores`, so a tagged-but-unscored player still counts.
2. **Include `user_id IS NULL` placeholders**, which `buddies` excludes — these are the people to invite.

Sketch:

```sql
WITH my_player_ids AS (
  SELECT id FROM players WHERE user_id = :me
),
my_round_ids AS (
  SELECT DISTINCT round_id FROM round_group_assignments
  WHERE player_id IN (SELECT id FROM my_player_ids)
),
co_players AS (
  SELECT p.*
  FROM round_group_assignments a
  JOIN players p ON p.id = a.player_id
  WHERE a.round_id IN (SELECT round_id FROM my_round_ids)
    AND p.id NOT IN (SELECT id FROM my_player_ids)
)
SELECT * FROM co_players;
```

Group the rows in the route into:

- **Accounts** — grouped by `user_id`: `{ kind: "user", userId, name, sharedRounds }`, links to `/users/:userId`.
- **Pending** — `user_id IS NULL`, grouped by `invited_phone` when present (same number = same person across trips/rounds), else per `(tripId, name)`: `{ kind: "pending", name, hasPhone: boolean, hasInvite: boolean, playerIds: number[], sharedRounds }`.

`sharedRounds` = count of distinct shared rounds, for sorting/usefulness. **No raw phone or code in the response.** No extra visibility gating to *list* co-players (you played together → legitimate access).

### 3. Tagging & invite generation

- **`POST /trips/:tripId/players`** and **`PATCH …/players/:playerId`** accept an optional `invitedPhone` (write-only). Server normalizes it via `normalizePhone` ([otp.ts](../../../artifacts/api-server/src/lib/otp.ts)) — the *same* normalizer sign-in uses, so a tag equals `users.phone` exactly. Rejected (ignored) when the row is already claimed (`user_id` not null).
- **`POST /trips/:tripId/players/:playerId/invite`** (requireAuth; caller must be a **participant in the trip** — the round/trip creator via `rounds.created_by_user_id` / `trips.created_by_user_id`, or a linked player with `user_id = caller` in that trip; row must be unclaimed) → generates/rotates `claim_code`, returns `{ url }` (e.g. `/claim/<code>`). Rotating overwrites the prior code (revoke = regenerate or clear). *(Note: the existing player CRUD routes use `optionalAuth` and don't check trip membership — broadly tightening them is out of scope, but the invite/claim endpoints introduced here are strict because they mint/consume claim authority.)*

### 4. Claim flow — `GET /me/claimable`, `POST /me/claims`

- **`GET /me/claimable`** (requireAuth) → **phone-matched** rows only: `invited_phone = req.user.phone AND user_id IS NULL`, enriched with trip name, round name/date, and tagger name. This is the auto-discovery surface checked on every sign-in. The **code path is separate** — it goes through `GET /claim/:code` (preview) straight into `POST /me/claims` with the code, so it doesn't round-trip through here. **No phone/code echoed back.**
- **`POST /me/claims`** (requireAuth) `{ accepts: number[], declines: number[], code?: string }`:
  - **Re-validate per row, server-side** — accept a row only if `user_id IS NULL` AND (`invited_phone = req.user.phone` OR `claim_code = code`). Never trust client-supplied playerIds without this check. *This is the enforcement point for the core rule.*
  - On accept: `user_id = req.user.id`; `name = req.user.fullName` (adopt-at-claim); clear `invited_phone` and `claim_code`. Skip per the per-trip-identity guard if the user already has a linked row in that trip (surface "already in this trip").
  - On decline: clear `invited_phone`/`claim_code` for that row so it stops prompting.
  - Idempotent: re-accepting an already-claimed-by-me row is a no-op success.

### 5. `GET /claim/:code` — public landing

Optional-auth route. Resolves `code → unclaimed player row`, returns a preview `{ name, tripName, roundName, date, taggedBy }` (no phone). UI shows "Claim **Dave**'s scores in **Saturday at Pebble**" → sign-in/up CTA → after auth, calls `/me/claims` with the code. If the code is unknown/redeemed, show a friendly "this invite's no longer valid."

### 6. UI

- **Connections tab** — third `TabButton` in [my-golf.tsx](../../../artifacts/golf-scorecard/src/pages/my-golf.tsx) (already `?tab=`-driven): `Rounds | Trips | Connections`. Two sections (On the app / Not yet). Pending rows show "Add phone" and "Share invite" affordances; account rows link to the profile.
- **Phone-tag field** — optional input where a player is added in round/trip setup, and inline on a pending connection.
- **Share affordance** — calls the invite endpoint, opens the native share sheet / copy with the `/claim/:code` URL.
- **Claim-review modal** — a dedicated component surfaced on next app load when `/me/claimable` is non-empty (phone-matched) or when arriving via `/claim/:code`. Lists items, Accept all / pick individually / Not me.

### 7. Contract & codegen

Edit [lib/api-spec/openapi.yaml](../../../lib/api-spec/openapi.yaml): add `invitedPhone` to player create/update request bodies (write-only); add `/me/connections`, `/me/claimable`, `/me/claims`, `/trips/{tripId}/players/{playerId}/invite`, `/claim/{code}`. Ensure player **response** schemas omit `invited_phone`/`claim_code`. Run `pnpm --filter @workspace/api-spec run codegen`. Generated code in `lib/api-client-react` / `lib/api-zod` is checked in — regenerate, don't hand-edit.

## Edge cases

- **Phone typo / "not me"** → decline clears the tag; won't reappear.
- **Already in the trip** → claimant already has a `user_id` row in that trip: skip linking the second row, surface a message; never create a duplicate identity. (Merging assignments is a Future-phase nicety.)
- **Re-tagging a claimed row** → `invitedPhone`/invite changes rejected when `user_id` is set.
- **Forwarded share link** → still requires the recipient to complete phone OTP sign-up (real verified human) and is single-use + per-row; redemption clears the code. Tiny blast radius vs. a multi-name picker.
- **Solo rounds** (`trip_id IS NULL`) → same derivation and tagging; their player rows participate identically.
- **Untagged placeholders** → remain openly claimable via the existing picker (backward compatible).

## Security considerations

- **Enforcement is server-side and per-row** in `/me/claims`; the client list endpoints are conveniences, not gates.
- `invited_phone`/`claim_code` are write-only + match-only; never serialized to any client.
- Phone equality is exact post-`normalizePhone`; no fuzzy matching.
- The existing self-claim path in [players.ts](../../../artifacts/api-server/src/routes/players.ts) is retrofitted with the core guard, closing the picker hole the same release.

## Future phases

- **Phase 2 — History & "played with me":** surface a connection's external round history and the mutual relationship on profiles/Connections, respecting `profileVisibility`. Leans on the existing feed/profile infra.
- **Phase 3 — Reach out:** follow/connect with a specific co-player; optional notify-when-they-join.
