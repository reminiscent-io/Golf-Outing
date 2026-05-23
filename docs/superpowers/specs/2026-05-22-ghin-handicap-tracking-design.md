# GHIN Number + Handicap History — Design

## Context

Handicap on Golf Trip is entered manually by each user, both at the per-trip player level and (recently) at the per-user `users.handicap` level so it autofills when joining new trips. The medium-term goal is to keep that number current by looking it up from GHIN (the USGA handicap registry), but the GHIN API is not publicly documented and requires authenticated calls against `api.ghin.com` using a real GHIN.com account — meaning live lookup is a non-trivial integration that needs a credentials story we're not ready to commit to yet.

This spec covers the precursor: capture the user's GHIN number and lay down the schema (with sync metadata and a handicap-change log) so that when we wire the lookup later, no further migrations are needed. The privacy policy already mentions "Handicap and GHIN number" as data we may collect — this design makes that statement true.

## Goal

After this phase ships:
1. A signed-in user can enter and edit a GHIN number from their profile page.
2. A new user can optionally enter their GHIN number during first-time sign-up (alongside full name).
3. Every change to `users.handicap` writes a row to a per-user history table, so we can later show a handicap-over-time chart and (when live lookups land) attribute changes to either `manual` or `ghin`.
4. The schema is ready for a future live-lookup feature: `handicap_source` and `handicap_synced_at` columns exist and are surfaced through the API, even though no GHIN call is made yet.

## Scope

**In:**
- `users.ghin_number` (nullable text).
- `users.handicap_source` (`'manual' | 'ghin'`, default `'manual'`, NOT NULL).
- `users.handicap_synced_at` (nullable timestamp with timezone).
- New table `user_handicap_history` recording every change to `users.handicap`.
- OpenAPI spec updates to surface the new fields on `User` and accept them in `UpdateMeBody` / `VerifyOtpBody`.
- Server-side validation of GHIN number format (digits-only, 5–12 characters).
- New endpoint `GET /auth/me/handicap-history` returning the user's full history newest-first.
- UI: GHIN number field on `/profile` and as an optional field in the new-user branch of the sign-in modal.
- One-time backfill script that writes a single `source='initial'` history row for every existing user with a non-null `handicap`.

**Out (deferred):**
- Any HTTP call to `api.ghin.com`. No service-account credentials, no env vars, no scheduled refresh.
- Surfacing `handicap_source` / `handicap_synced_at` in the UI. The fields ship in the API only.
- A history chart or any other UI consumer of `GET /auth/me/handicap-history`. The endpoint ships; the chart does not.
- Player-level GHIN numbers. Only the per-user field is added; per-trip `players.handicap` stays independent and unlogged.
- Backfill of history rows for past handicap edits — we have no audit log of those, so we cannot reconstruct them. Pre-existing users get exactly one `initial` row at backfill time.
- Required GHIN number (it stays optional everywhere).
- Uniqueness on `ghin_number` (two users could plausibly share or mistype; collisions don't matter until live lookup, when we'll revisit).

## Data model changes

### `users` (modified)

Three new columns:

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `ghin_number` | `text` | nullable | User's GHIN ID as a digit string. |
| `handicap_source` | `text` | NOT NULL, default `'manual'`, check constraint `IN ('manual', 'ghin')` | Records what populated `handicap` last. Stays `'manual'` until lookup ships. |
| `handicap_synced_at` | `timestamp with time zone` | nullable | When `handicap` was last refreshed from GHIN. Always `null` in this phase. |

No new indexes on `users` (the GHIN number isn't queried by anyone yet — once live lookup ships and we need a worker to find users-needing-refresh, we can add an index then).

### `user_handicap_history` (new)

| Column | Type | Constraints |
|---|---|---|
| `id` | `serial` | primary key |
| `user_id` | `integer` | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `handicap` | `real` | NOT NULL (we never log null values — clearing a handicap doesn't write a row) |
| `source` | `text` | NOT NULL, check constraint `IN ('manual', 'ghin', 'initial')` |
| `recorded_at` | `timestamp with time zone` | NOT NULL, default `now()` |

Index: `(user_id, recorded_at desc)` to support "newest first for this user" queries on the history endpoint.

### Drizzle schema location

Add the new columns to [lib/db/src/schema/users.ts](lib/db/src/schema/users.ts). Create a new file `lib/db/src/schema/user-handicap-history.ts` for the new table, mirroring the existing schema-per-file pattern. Re-export from the barrel at [lib/db/src/schema/index.ts](lib/db/src/schema/index.ts).

### Migration path

Per project convention, schema is push-based (no `migrations/` directory). After editing the schema files, run `pnpm --filter @workspace/db run push`. Note that `db push` does not invoke the backfill — that runs separately (see below).

## API surface

### Modified schemas in `lib/api-spec/openapi.yaml`

**`User`** — add three read-only fields:

```yaml
ghinNumber:
  type: ["string", "null"]
  description: User's GHIN registry number (digits only).
handicapSource:
  type: string
  enum: [manual, ghin]
  description: What populated handicap last. Currently always 'manual'.
handicapSyncedAt:
  type: ["string", "null"]
  format: date-time
  description: When handicap was last fetched from GHIN. Currently always null.
```

`handicapSource` is required (NOT NULL in DB); `ghinNumber` and `handicapSyncedAt` are nullable. Update the `required` array accordingly.

**`UpdateMeBody`** — add one writable field:

```yaml
ghinNumber:
  type: ["string", "null"]
  pattern: "^[0-9]+$"
  minLength: 5
  maxLength: 12
  description: Digits only. Send null to clear.
```

The patch handler does **not** accept `handicapSource` or `handicapSyncedAt` — those are server-managed.

**`VerifyOtpBody`** — add one optional field used only for new-user creation:

```yaml
ghinNumber:
  type: ["string", "null"]
  pattern: "^[0-9]+$"
  minLength: 5
  maxLength: 12
  description: Optional. Only honored when this phone is a new user.
```

### New endpoint

**`GET /auth/me/handicap-history`** (requires auth):

Response:
```yaml
type: array
items:
  type: object
  properties:
    handicap:
      type: number
    source:
      type: string
      enum: [manual, ghin, initial]
    recordedAt:
      type: string
      format: date-time
  required: [handicap, source, recordedAt]
```

Newest-first ordering. No pagination in this phase (history rows are infrequent — one per intentional edit; a user with 5 years of weekly updates would still be ~260 rows).

### Codegen

After editing the spec, run `pnpm --filter @workspace/api-spec run codegen` to regenerate `lib/api-client-react` (React Query hooks) and `lib/api-zod` (Zod validators). The generated files are checked in.

## Server-side behavior

### `POST /auth/verify-otp` ([auth.ts:74](artifacts/api-server/src/routes/auth.ts#L74))

When creating a new user: if `ghinNumber` is present in the body, validate format (trim, digits-only, 5–12 chars). On invalid, return `400`. On valid, persist on the new user row. Existing users (who already have an account when they sign in again) ignore any submitted `ghinNumber` — they should update it via `PATCH /auth/me`.

No history row is written here, because new users don't enter a handicap at signup. Their first manual entry on `/profile` will be the first history row for them.

### `PATCH /auth/me` ([auth.ts:141](artifacts/api-server/src/routes/auth.ts#L141))

Extend the patch map to accept `ghinNumber`. Same validation as above; `null` clears the column.

When `handicap` is in the patch:
1. Read the user's current handicap value.
2. If the new value is a number AND differs from the current value, insert a row into `user_handicap_history` with `(user_id, handicap, source='manual', recorded_at=now())`.
3. Both the user update and the history insert happen inside a single Drizzle transaction so they cannot drift apart.

If the new value is `null` (user clearing their handicap), update the user row but do **not** write a history row. Same if the new value equals the current value (no-op writes don't pollute history).

`handicapSource` and `handicapSyncedAt` are not touched by this endpoint — they stay `'manual'` / `null` forever in this phase.

### `GET /auth/me/handicap-history` (new, added to [auth.ts](artifacts/api-server/src/routes/auth.ts))

Requires auth via `requireAuth`. Selects all rows from `user_handicap_history` where `user_id = req.user.id`, ordered by `recorded_at desc`. Returns the array (empty array if none). Lives in `auth.ts` next to the existing `/auth/me` handlers — it's about the current user's own data, same family.

### One-time backfill script

Standalone tsx script under `scripts/` — e.g. `scripts/backfill-handicap-history.ts` — that:
1. Selects every user with a non-null `handicap`.
2. For each, checks `user_handicap_history` for an existing row; skips if any row already exists.
3. Inserts one row with `(user_id, handicap, source='initial', recorded_at=now())`.
4. Logs counts: total users scanned, rows inserted, users skipped.

Idempotent — safe to re-run. Invoked manually once after `db push`, not from `scripts/post-merge.sh` (the post-merge hook fires every merge; we don't want repeat work).

## Client-side behavior

### Sign-in modal ([sign-in-modal.tsx:208-222](artifacts/golf-scorecard/src/components/sign-in-modal.tsx#L208-L222))

Inside the `{isNewUser && (...)}` block, after the Full name input, add an optional GHIN number input:

- Label: `GHIN Number (optional)`.
- Same visual treatment as the Full name input.
- State: new `ghinNumber` `useState<string>("")`.
- `inputMode="numeric"`, `pattern="[0-9]*"` so mobile keyboards default to numeric.
- On submit: if `ghinNumber.trim()` is non-empty, include it (trimmed) in the verify-otp body. If empty, omit it entirely (don't send `""`).

The Verify button's `disabled` predicate doesn't change — GHIN number stays purely optional.

### Profile page ([profile.tsx](artifacts/golf-scorecard/src/pages/profile.tsx))

Add a new field block below the Handicap Index field (line ~146-190 in the existing form), in the same `<form onSubmit={onSubmit}>`:

- Label: `GHIN Number`.
- Help text: `Used to look up your handicap automatically (coming soon).`
- State: new `ghinNumber` `useState(() => session?.user.ghinNumber ?? "")`, plus an effect to re-sync when `session?.user.ghinNumber` changes (mirroring how `hcp` is handled on lines 38-42).
- On submit: extend the existing `useUpdateMe.mutate` call to send `ghinNumber: trimmed || null` alongside the handicap. Toast messages stay generic ("Saved" / "Could not save profile").
- Visual: same input styling as the handicap field. The submit button below the GHIN field is the same single button that already saves the form — no separate save action.

### Auth session

The session user object (currently `{ id, phone, fullName, handicap, discoverableByPhone, profileVisibility, createdAt }`) gains three fields after codegen regenerates the types: `ghinNumber`, `handicapSource`, `handicapSyncedAt`. The `updateSessionUser` helper ([auth.ts](artifacts/golf-scorecard/src/lib/auth.ts)) already merges any subset of user fields, so no change there.

### No other UI changes

- The trip-join "Your name in this trip" card is **not** modified. Per-trip player handicap is still entered independently and is not connected to the user-level `handicap`.
- The history endpoint has no consumer in this phase.

## Privacy & validation summary

- GHIN number is stored in plain text. The privacy policy already discloses this.
- Validation: digits only, 5–12 characters, both client-side (HTML5 `pattern`) and server-side (Zod `pattern: ^[0-9]+$`). Server-side validation is the authoritative check.
- No uniqueness constraint — collisions during entry don't break anything until live lookup, at which point we revisit.

## Testing strategy

- Drizzle schema compiles (via `pnpm --filter @workspace/db run push` to a dev DB).
- Codegen runs cleanly (`pnpm --filter @workspace/api-spec run codegen`).
- Manual: sign up a brand-new test user via the modal with a GHIN number; check the row in `users`. Edit it from the profile page; check it updates. Clear it; check it goes back to `null`.
- Manual: edit handicap on `/profile` twice, then call `GET /auth/me/handicap-history` via curl with a bearer token; expect two rows, newest first. No-op edits (saving the same value) should not add rows.
- Run the backfill script on the dev DB after pushing; confirm one `initial` row per pre-existing user with a non-null handicap. Run it again; confirm idempotency (zero new rows).
- Typecheck across all packages: `pnpm run typecheck`.

## Future phases (not in this spec)

- **Live GHIN lookup**: design the credentials story (likely a single service account in env vars), build a small `lib/ghin-client` worker module, call it on a schedule or on-demand. When fresh data arrives, update `users.handicap` + `handicap_source='ghin'` + `handicap_synced_at=now()` and insert a `source='ghin'` history row in the same transaction.
- **Handicap-over-time chart** on `/profile`, consuming `GET /auth/me/handicap-history`.
- **Surfacing source in the UI**: small "synced from GHIN · 2d ago" label next to the handicap field on `/profile` when `handicapSource = 'ghin'`.
