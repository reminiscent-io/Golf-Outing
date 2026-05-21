# Social Feed Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the social feed — global user profiles, follow graph, round-as-post (kudos/comments), three-tab feed (Buddies/Following/All), solo-round flow, and read-only observer mode for live in-progress rounds.

**Architecture:** Schema-first (Drizzle push), then OpenAPI contract (regen Orval), then Express handlers in `artifacts/api-server`, then Wouter pages + TanStack Query consumption in `artifacts/golf-scorecard`. New tables: `user_follows`, `round_kudos`, `round_comments`. Augment `users` (`discoverableByPhone`, `profileVisibility`), `trips` (`kind`), `rounds` (`visibility`, `completedAt`). All defaults preserve current behavior — every existing round becomes a public, no-`completedAt` row that the feed renders as "in progress" until backfilled.

**Tech Stack:** pnpm workspace · Drizzle ORM · PostgreSQL (pg_trgm extension) · Express 5 · Zod v4 · OpenAPI 3.1 → Orval codegen · React 19 + Wouter + TanStack Query · Tailwind 4 + shadcn/ui.

**Spec:** [docs/superpowers/specs/2026-05-21-social-feed-foundation-design.md](../specs/2026-05-21-social-feed-foundation-design.md)

---

## Stage layout

This plan has 7 stages, executable in order. Stages 1–3 build the data layer and API contract — anything that breaks here is cheap. Stages 4–5 are server then client implementation. Stage 6 is integration polish (live in-progress + solo round). Stage 7 is verification.

- **Stage 1 — Schema** (Tasks 1–7): Drizzle tables and indexes, push to DB
- **Stage 2 — API contract** (Tasks 8–18): OpenAPI YAML additions, codegen
- **Stage 3 — Scoring summarizer** (Task 19): `summarizeRound` with tests
- **Stage 4 — Server handlers** (Tasks 20–28): One task per route group
- **Stage 5 — Client foundation** (Tasks 29–32): Routing, helpers, observer mode
- **Stage 6 — Client pages** (Tasks 33–39): Feed, profile, search, round-page additions, settings, solo-round
- **Stage 7 — Verification** (Tasks 40–41): Manual end-to-end, final commit

Tests are spelled out for code with logic (scoring summarizer, buddies query). For CRUD endpoints and UI, the spec's manual verification list is the contract.

---

## Stage 1 — Schema

### Task 1: Extend the users table with privacy flags

**Files:**
- Modify: `lib/db/src/schema/users.ts`

- [ ] **Step 1: Add the two new columns**

Replace the contents of [lib/db/src/schema/users.ts](../../../lib/db/src/schema/users.ts) with:

```ts
import { pgTable, text, serial, real, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  fullName: text("full_name").notNull(),
  handicap: real("handicap"),
  discoverableByPhone: boolean("discoverable_by_phone").notNull().default(false),
  profileVisibility: text("profile_visibility", { enum: ["public", "private"] }).notNull().default("public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => [
  // Trigram index for fuzzy name search. The pg_trgm extension is enabled in Task 7.
  index("users_full_name_trgm_idx").using("gin", t.fullName),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
```

The trigram operator class isn't expressed by Drizzle's `index().using("gin", ...)` directly, so we'll patch the SQL via a Drizzle migration helper in Task 7 (the extension also needs to exist first). Defining the index here keeps the schema source-of-truth complete.

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/users.ts
git commit -m "feat(db): add discoverableByPhone and profileVisibility to users"
```

---

### Task 2: Add a kind discriminator to trips

**Files:**
- Modify: `lib/db/src/schema/trips.ts`

- [ ] **Step 1: Add the column and a partial unique index**

Replace the contents of [lib/db/src/schema/trips.ts](../../../lib/db/src/schema/trips.ts) with:

```ts
import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const tripsTable = pgTable("trips", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["event", "personal"] }).notNull().default("event"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // At most one personal (solo) trip per user. Drizzle exposes partial indexes via `.where()`.
  uniqueIndex("trips_personal_per_user").on(t.createdByUserId).where(sql`${t.kind} = 'personal'`),
]);

export const insertTripSchema = createInsertSchema(tripsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof tripsTable.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/trips.ts
git commit -m "feat(db): add trips.kind (event|personal) with per-user uniqueness for personal"
```

---

### Task 3: Add visibility and completedAt to rounds

**Files:**
- Modify: `lib/db/src/schema/rounds.ts`

- [ ] **Step 1: Append the new columns**

Edit [lib/db/src/schema/rounds.ts](../../../lib/db/src/schema/rounds.ts) — inside the `pgTable("rounds", { ... })` columns object, between `courseSlope` and `createdAt`, insert:

```ts
  visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("public"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
```

Final ordering of new columns in the object (do not change existing ones):

```ts
courseSlope: integer("course_slope"),
visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("public"),
completedAt: timestamp("completed_at", { withTimezone: true }),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/rounds.ts
git commit -m "feat(db): add rounds.visibility and rounds.completedAt"
```

---

### Task 4: Create the user-follows table

**Files:**
- Create: `lib/db/src/schema/user-follows.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Write the table module**

Create [lib/db/src/schema/user-follows.ts](../../../lib/db/src/schema/user-follows.ts):

```ts
import { pgTable, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userFollowsTable = pgTable("user_follows", {
  followerId: integer("follower_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  followedId: integer("followed_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.followerId, t.followedId] }),
  // Reverse-lookup: "who follows :userId" needs an index keyed on followedId.
  index("user_follows_followed_idx").on(t.followedId),
]);

export type UserFollow = typeof userFollowsTable.$inferSelect;
```

- [ ] **Step 2: Re-export from the schema index**

Edit [lib/db/src/schema/index.ts](../../../lib/db/src/schema/index.ts) and add at the bottom:

```ts
export * from "./user-follows";
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/user-follows.ts lib/db/src/schema/index.ts
git commit -m "feat(db): add user_follows table (asymmetric follow graph)"
```

---

### Task 5: Create the round-kudos table

**Files:**
- Create: `lib/db/src/schema/round-kudos.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Write the table module**

Create [lib/db/src/schema/round-kudos.ts](../../../lib/db/src/schema/round-kudos.ts):

```ts
import { pgTable, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { roundsTable } from "./rounds";

export const roundKudosTable = pgTable("round_kudos", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roundId] }),
  // Feed and social-aggregate queries count by roundId — keep that path indexed.
  index("round_kudos_round_idx").on(t.roundId),
]);

export type RoundKudos = typeof roundKudosTable.$inferSelect;
```

- [ ] **Step 2: Re-export from the schema index**

Edit [lib/db/src/schema/index.ts](../../../lib/db/src/schema/index.ts) and add at the bottom:

```ts
export * from "./round-kudos";
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/round-kudos.ts lib/db/src/schema/index.ts
git commit -m "feat(db): add round_kudos table"
```

---

### Task 6: Create the round-comments table

**Files:**
- Create: `lib/db/src/schema/round-comments.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Write the table module**

Create [lib/db/src/schema/round-comments.ts](../../../lib/db/src/schema/round-comments.ts):

```ts
import { pgTable, serial, integer, text, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { roundsTable } from "./rounds";

export const roundCommentsTable = pgTable("round_comments", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Self-reference — Drizzle requires the explicit AnyPgColumn cast on the lambda.
  parentCommentId: integer("parent_comment_id").references((): AnyPgColumn => roundCommentsTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("round_comments_round_created_idx").on(t.roundId, t.createdAt),
  index("round_comments_parent_idx").on(t.parentCommentId),
]);

export type RoundComment = typeof roundCommentsTable.$inferSelect;
```

- [ ] **Step 2: Re-export from the schema index**

Edit [lib/db/src/schema/index.ts](../../../lib/db/src/schema/index.ts) and add at the bottom:

```ts
export * from "./round-comments";
```

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/round-comments.ts lib/db/src/schema/index.ts
git commit -m "feat(db): add round_comments with one-level reply threading"
```

---

### Task 7: Push schema, enable pg_trgm, and verify

**Files:**
- Touch: none directly — this is a push + ad-hoc SQL step

- [ ] **Step 1: Push schema**

Run:

```bash
pnpm --filter @workspace/db run push
```

Expected: Drizzle prints the additive ALTER TABLEs, CREATE INDEXes, and the new CREATE TABLEs. The `users_full_name_trgm_idx` may FAIL on this run because pg_trgm isn't installed yet — that's fine, we install it in step 2.

- [ ] **Step 2: Enable pg_trgm and add the GIN trigram index manually**

Drizzle Kit doesn't manage Postgres extensions. Run via `psql` against `DATABASE_URL` (use whichever client you have — `psql "$DATABASE_URL"` or your editor):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DROP INDEX IF EXISTS users_full_name_trgm_idx;
CREATE INDEX users_full_name_trgm_idx ON users USING gin (full_name gin_trgm_ops);
```

The drop-then-create replaces any non-trigram GIN index Drizzle may have created with the correct `gin_trgm_ops` operator class.

- [ ] **Step 3: Re-push to confirm Drizzle is in sync**

```bash
pnpm --filter @workspace/db run push
```

Expected: "No changes detected" or only the trigram index, which is now correctly typed.

- [ ] **Step 4: Add a players(user_id, round_id) supporting index**

The buddies query joins `players p1` to `players p2` on `round_id` and filters by `user_id`. We don't have a `round_id` on players directly — players are scoped to a *trip* and join to rounds via scores. Re-check the buddies query in §5 of the spec: it joins `players p1` and `players p2` on `p1.round_id = p2.round_id`. That means we need `round_id` on players, OR rewrite the query to join through `scores` (which already keys on `roundId`).

We'll rewrite the buddies query in Task 21 to join through `scores` so no schema change is needed here. **No-op for this step; document the decision:**

Run:

```bash
echo "Buddies query joins through scoresTable.roundId — no players.round_id column needed."
```

- [ ] **Step 5: Commit (schema-only push has no source changes, but capture the extension decision)**

This step makes no commit on its own — extension changes live in the DB, not in source. Move to Task 8.

---

## Stage 2 — API contract

### Task 8: Add visibility/completedAt to the Round OpenAPI schema and PATCH body

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Locate the `Round:` schema block**

Open [lib/api-spec/openapi.yaml](../../../lib/api-spec/openapi.yaml). Find the `Round:` block (currently around line 1009). It looks like:

```yaml
    Round:
      type: object
      properties:
        ...
        courseRating:
          type: ["number", "null"]
        courseSlope:
          type: ["integer", "null"]
        createdAt:
          type: string
        updatedAt:
          type: string
      required:
        - id
        - tripId
        - name
        - par
        - holeHcp
        - gamesConfig
        - handicapMode
        - createdAt
        - updatedAt
```

- [ ] **Step 2: Insert visibility + completedAt**

Between `courseSlope` and `createdAt`, insert:

```yaml
        visibility:
          type: string
          enum: [public, private]
        completedAt:
          type: ["string", "null"]
          description: ISO timestamp set when the round is explicitly marked complete or all 18 holes scored.
```

In the `required:` list, add `visibility` (do NOT add `completedAt` — it's nullable).

- [ ] **Step 3: Locate the `UpdateRoundBody:` block and add the same fields**

Find `UpdateRoundBody:` in the schemas section (it's the PATCH body). Add to its `properties`:

```yaml
        visibility:
          type: string
          enum: [public, private]
        completedAt:
          type: ["string", "null"]
          description: Send a timestamp to mark the round complete; send null to clear.
```

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): expose round visibility and completedAt"
```

---

### Task 9: Add kind to the Trip schema

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Find the `Trip:` schema and add `kind`**

In the `Trip:` properties (around line 744):

```yaml
        kind:
          type: string
          enum: [event, personal]
          description: '`event` = shared trip with friends. `personal` = solo-round bucket, one per user.'
```

Add `kind` to the `required:` array under `Trip:`.

- [ ] **Step 2: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): expose trip.kind"
```

---

### Task 10: Add user privacy fields to the User schema and a new UpdateMeBody section

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Extend `User:` schema**

In the `User:` block (around line 784), add inside `properties:`:

```yaml
        discoverableByPhone:
          type: boolean
        profileVisibility:
          type: string
          enum: [public, private]
```

Add both keys to the `required:` array.

- [ ] **Step 2: Extend `UpdateMeBody:` schema**

In `UpdateMeBody:` (around line 808):

```yaml
        discoverableByPhone:
          type: boolean
        profileVisibility:
          type: string
          enum: [public, private]
        fullName:
          type: string
          minLength: 1
          maxLength: 80
```

(`fullName` becomes editable too — the profile page surfaces it; harmless to allow.)

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): expose user privacy settings on User and UpdateMeBody"
```

---

### Task 11: Add the public profile and search endpoints

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add a new `users` tag and the public-profile + search paths**

Open [lib/api-spec/openapi.yaml](../../../lib/api-spec/openapi.yaml). In the `tags:` array (top of file), the `users` tag already exists for "Current user account operations" — rename its description to be broader:

```yaml
  - name: users
    description: User accounts, profiles, search, and follow graph
```

Then below the existing `/users/me/stats` block (around line 270), insert the new paths. Find the section ending after the `unsaveTrip` block (search for `operationId: unsaveTrip`); insert the following before the next path block:

```yaml
  /users/{userId}:
    get:
      operationId: getUserProfile
      tags: [users]
      summary: Public user profile + recent rounds + viewer relationship
      security:
        - bearerAuth: []
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Profile payload
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserProfile"
        "401":
          description: Unauthorized
        "404":
          description: User not found

  /users/search:
    get:
      operationId: searchUsers
      tags: [users]
      summary: Fuzzy name search; honors privacy and phone-discoverability gates
      security:
        - bearerAuth: []
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
            minLength: 1
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 50
            default: 20
      responses:
        "200":
          description: Matched users
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/UserSearchHit"
        "401":
          description: Unauthorized

  /users/me/buddies:
    get:
      operationId: listMyBuddies
      tags: [users]
      summary: Other users who have shared a round with me, ordered by rounds-together
      security:
        - bearerAuth: []
      responses:
        "200":
          description: Buddy list
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Buddy"
        "401":
          description: Unauthorized
```

- [ ] **Step 2: Add the new schemas in the components block**

Scroll to the `components:` → `schemas:` section (around line 735). After the existing `User:` schema, add:

```yaml
    UserProfile:
      type: object
      properties:
        id:
          type: integer
        fullName:
          type: string
        handicap:
          type: ["number", "null"]
        profileVisibility:
          type: string
          enum: [public, private]
        createdAt:
          type: string
        stats:
          $ref: "#/components/schemas/UserProfileStats"
        recentRounds:
          type: array
          items:
            $ref: "#/components/schemas/FeedItem"
        followerCount:
          type: integer
        followingCount:
          type: integer
        viewerRelation:
          type: object
          properties:
            isSelf:
              type: boolean
            isFollowing:
              type: boolean
            isFollowedBy:
              type: boolean
          required: [isSelf, isFollowing, isFollowedBy]
      required:
        - id
        - fullName
        - profileVisibility
        - createdAt
        - followerCount
        - followingCount
        - viewerRelation

    UserProfileStats:
      type: object
      properties:
        roundsPlayed:
          type: integer
        bestNet:
          type: ["integer", "null"]
        avgNetLast10:
          type: ["number", "null"]
        coursesPlayed:
          type: integer
      required:
        - roundsPlayed
        - coursesPlayed

    UserSearchHit:
      type: object
      properties:
        id:
          type: integer
        fullName:
          type: string
        handicap:
          type: ["number", "null"]
      required: [id, fullName]

    Buddy:
      type: object
      properties:
        userId:
          type: integer
        fullName:
          type: string
        handicap:
          type: ["number", "null"]
        roundsTogether:
          type: integer
        lastPlayedAt:
          type: ["string", "null"]
      required: [userId, fullName, roundsTogether]
```

(The `FeedItem` schema referenced by `recentRounds` is added in Task 15.)

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): user profile, search, and buddies endpoints"
```

---

### Task 12: Add follow-graph endpoints

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Insert four follow paths**

After the buddies path block from Task 11, add:

```yaml
  /users/{userId}/follow:
    post:
      operationId: followUser
      tags: [users]
      summary: Follow a user
      security:
        - bearerAuth: []
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Followed (idempotent)
        "400":
          description: Cannot follow self
        "401":
          description: Unauthorized
        "403":
          description: Target profile is private
        "404":
          description: Not found
    delete:
      operationId: unfollowUser
      tags: [users]
      summary: Unfollow a user
      security:
        - bearerAuth: []
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Unfollowed (idempotent)
        "401":
          description: Unauthorized

  /users/{userId}/followers:
    get:
      operationId: listFollowers
      tags: [users]
      summary: Paginated followers of a user
      security:
        - bearerAuth: []
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 50
        - name: before
          in: query
          required: false
          schema:
            type: string
            description: ISO timestamp; return rows older than this.
      responses:
        "200":
          description: Followers page
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/FollowEntry"

  /users/{userId}/following:
    get:
      operationId: listFollowing
      tags: [users]
      summary: Paginated users that this user is following
      security:
        - bearerAuth: []
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 50
        - name: before
          in: query
          required: false
          schema:
            type: string
      responses:
        "200":
          description: Following page
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/FollowEntry"
```

- [ ] **Step 2: Add the FollowEntry schema**

In `components.schemas` (after `Buddy:`):

```yaml
    FollowEntry:
      type: object
      properties:
        userId:
          type: integer
        fullName:
          type: string
        handicap:
          type: ["number", "null"]
        followedAt:
          type: string
      required: [userId, fullName, followedAt]
```

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): follow/unfollow + followers/following paginated lists"
```

---

### Task 13: Add kudos endpoints

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add the two kudos paths**

After the follow paths, add:

```yaml
  /rounds/{roundId}/kudos:
    post:
      operationId: giveKudos
      tags: [rounds]
      summary: Give kudos to a round (idempotent)
      security:
        - bearerAuth: []
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Kudosed
        "401":
          description: Unauthorized
        "403":
          description: Round is private
        "404":
          description: Round not found
    delete:
      operationId: revokeKudos
      tags: [rounds]
      summary: Remove your kudos from a round
      security:
        - bearerAuth: []
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Removed
```

- [ ] **Step 2: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): kudos endpoints on /rounds/{roundId}/kudos"
```

---

### Task 14: Add comments endpoints

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add the three comment paths**

After the kudos paths:

```yaml
  /rounds/{roundId}/comments:
    get:
      operationId: listRoundComments
      tags: [rounds]
      summary: List comments on a round (sorted oldest first)
      security:
        - bearerAuth: []
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Comments
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/RoundComment"
    post:
      operationId: createRoundComment
      tags: [rounds]
      summary: Post a comment (optionally as a one-level reply)
      security:
        - bearerAuth: []
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateRoundCommentBody"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoundComment"
        "400":
          description: Invalid parentCommentId (cross-round or nested reply)
        "401":
          description: Unauthorized
        "403":
          description: Round is private

  /comments/{commentId}:
    delete:
      operationId: deleteRoundComment
      tags: [rounds]
      summary: Delete your own comment
      security:
        - bearerAuth: []
      parameters:
        - name: commentId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
        "401":
          description: Unauthorized
        "403":
          description: Not the author
        "404":
          description: Not found
```

- [ ] **Step 2: Add comment schemas**

```yaml
    RoundComment:
      type: object
      properties:
        id:
          type: integer
        roundId:
          type: integer
        userId:
          type: integer
        userFullName:
          type: string
        parentCommentId:
          type: ["integer", "null"]
        body:
          type: string
        createdAt:
          type: string
      required: [id, roundId, userId, userFullName, body, createdAt]

    CreateRoundCommentBody:
      type: object
      properties:
        body:
          type: string
          minLength: 1
          maxLength: 1000
        parentCommentId:
          type: ["integer", "null"]
      required: [body]
```

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): round comments with one-level reply threading"
```

---

### Task 15: Add round social aggregate and feed endpoints

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add the social aggregate path**

After comments:

```yaml
  /rounds/{roundId}/social:
    get:
      operationId: getRoundSocial
      tags: [rounds]
      summary: Aggregate kudos + comments + viewer relation for one round
      security:
        - bearerAuth: []
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Aggregate
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoundSocial"
```

- [ ] **Step 2: Add the feed path**

```yaml
  /feed:
    get:
      operationId: getFeed
      tags: [rounds]
      summary: Paginated feed of public rounds, filtered by tab
      security:
        - bearerAuth: []
      parameters:
        - name: tab
          in: query
          required: true
          schema:
            type: string
            enum: [buddies, following, all]
        - name: before
          in: query
          required: false
          schema:
            type: string
            description: ISO timestamp; return items with sort-key older than this.
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            minimum: 1
            maximum: 50
            default: 20
      responses:
        "200":
          description: Feed page
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/FeedPage"
```

- [ ] **Step 3: Add the social and feed schemas**

```yaml
    RoundSocial:
      type: object
      properties:
        kudos:
          type: object
          properties:
            count:
              type: integer
            viewerHasKudosed:
              type: boolean
            recentUsers:
              type: array
              items:
                $ref: "#/components/schemas/UserSearchHit"
          required: [count, viewerHasKudosed, recentUsers]
        comments:
          type: object
          properties:
            count:
              type: integer
            items:
              type: array
              items:
                $ref: "#/components/schemas/RoundComment"
          required: [count, items]
      required: [kudos, comments]

    FeedPlayer:
      type: object
      properties:
        playerId:
          type: integer
        playerName:
          type: string
        userId:
          type: ["integer", "null"]
      required: [playerId, playerName]

    FeedItem:
      type: object
      properties:
        roundId:
          type: integer
        tripId:
          type: integer
        tripKind:
          type: string
          enum: [event, personal]
        name:
          type: string
        course:
          type: ["string", "null"]
        date:
          type: ["string", "null"]
        completedAt:
          type: ["string", "null"]
        updatedAt:
          type: string
        visibility:
          type: string
          enum: [public, private]
        players:
          type: array
          items:
            $ref: "#/components/schemas/FeedPlayer"
        summary:
          $ref: "#/components/schemas/FeedItemSummary"
        kudosCount:
          type: integer
        commentCount:
          type: integer
        viewerHasKudosed:
          type: boolean
      required:
        - roundId
        - tripId
        - tripKind
        - name
        - updatedAt
        - visibility
        - players
        - summary
        - kudosCount
        - commentCount
        - viewerHasKudosed

    FeedItemSummary:
      type: object
      properties:
        leaderName:
          type: ["string", "null"]
        leaderNet:
          type: ["integer", "null"]
        leaderGross:
          type: ["integer", "null"]
        holesPlayed:
          type: integer
        totalHoles:
          type: integer
      required: [holesPlayed, totalHoles]

    FeedPage:
      type: object
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/FeedItem"
        nextBefore:
          type: ["string", "null"]
      required: [items, nextBefore]
```

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): round social aggregate + paginated feed endpoints"
```

---

### Task 16: Add the personal-trip solo-round endpoint

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add `/users/me/personal-trip/rounds`**

After the `/users/me/stats` block:

```yaml
  /users/me/personal-trip/rounds:
    post:
      operationId: createSoloRound
      tags: [users]
      summary: Find-or-create the caller's personal trip and create a round inside it
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateSoloRoundBody"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateSoloRoundResponse"
        "401":
          description: Unauthorized
```

- [ ] **Step 2: Add the request/response schemas**

```yaml
    CreateSoloRoundBody:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 120
        course:
          type: ["string", "null"]
        date:
          type: ["string", "null"]
        par:
          type: array
          items:
            type: integer
        holeHcp:
          type: array
          items:
            type: integer
        teeBox:
          type: ["string", "null"]
        courseRating:
          type: ["number", "null"]
        courseSlope:
          type: ["integer", "null"]
      required: [name]

    CreateSoloRoundResponse:
      type: object
      properties:
        tripId:
          type: integer
        roundId:
          type: integer
        playerId:
          type: integer
      required: [tripId, roundId, playerId]
```

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api): solo-round endpoint creates/uses personal trip"
```

---

### Task 17: Regenerate API client + zod, verify

**Files:**
- Generated (do not hand-edit): `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

- [ ] **Step 1: Run codegen**

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: Both `api-client-react/src/generated/` and `api-zod/src/generated/` get rewritten. The typecheck pass at the end of codegen should succeed.

- [ ] **Step 2: Run a workspace typecheck for safety**

```bash
pnpm run typecheck
```

Expected: Passes. If any of the *server* files reference now-missing schema imports (e.g. `UpdateRoundBody`), that's a Stage 4 issue — we'll fix when we wire the handlers. For now, only the libs should be clean.

If the typecheck fails inside `artifacts/api-server`, note the failing files and continue — they'll be the targets of Stage 4. The libs (lib/api-spec, lib/api-client-react, lib/api-zod, lib/db) must all be green.

- [ ] **Step 3: Commit**

```bash
git add lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "chore(codegen): regenerate orval client/zod for social feed endpoints"
```

---

### Task 18: Sanity-check generated types are importable

**Files:**
- Touch: none

- [ ] **Step 1: Confirm key exports exist**

```bash
grep -l "useGetFeed\|useFollowUser\|useGetUserProfile\|useGiveKudos\|useCreateSoloRound" lib/api-client-react/src/generated/
grep -l "FeedItem\b\|UserProfile\b\|RoundSocial\b" lib/api-client-react/src/generated/
```

Expected: at least one match for each. If anything is missing, re-run codegen; if still missing, the OpenAPI spec is wrong and needs a fix.

- [ ] **Step 2: No commit — this is verification only.**

---

## Stage 3 — Scoring summarizer

### Task 19: Add `summarizeRound` to scoring.ts with tests

**Files:**
- Modify: `artifacts/api-server/src/lib/scoring.ts`
- Modify: `artifacts/api-server/src/lib/scoring.test.ts`
- Modify: `artifacts/api-server/package.json`

- [ ] **Step 1: Add a `test` script to the api-server package**

Open [artifacts/api-server/package.json](../../../artifacts/api-server/package.json) and inside `scripts`, add:

```json
"test": "node --experimental-strip-types --no-warnings --test src/lib/*.test.ts"
```

Final `scripts` block:

```json
"scripts": {
  "dev": "export NODE_ENV=development && pnpm run build && pnpm run start",
  "build": "node ./build.mjs",
  "start": "node --enable-source-maps ./dist/index.mjs",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "node --experimental-strip-types --no-warnings --test src/lib/*.test.ts"
}
```

Node 24 supports `--experimental-strip-types` for `.ts` files in `node:test` mode without a loader.

- [ ] **Step 2: Verify existing tests run**

```bash
pnpm --filter @workspace/api-server run test
```

Expected: existing scoring tests pass (the `computeTeamNassau` describe block). If they fail with a parse/import error, the `--experimental-strip-types` flag is not available — fall back to:

```json
"test": "tsx --test src/lib/*.test.ts"
```

(tsx is already in the workspace catalog.)

- [ ] **Step 3: Write the failing test for summarizeRound**

Append to [artifacts/api-server/src/lib/scoring.test.ts](../../../artifacts/api-server/src/lib/scoring.test.ts):

```ts
import { summarizeRound, type SummarizeInputs } from "./scoring";

describe("summarizeRound", () => {
  function baseInputs(): SummarizeInputs {
    return {
      roundId: 1,
      par: Array(18).fill(4),
      holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
      handicapMode: "net",
      course: { slope: null, rating: null, totalPar: 72 },
      players: [
        { id: 10, name: "Alice", handicap: 0 },
        { id: 11, name: "Bob",   handicap: 18 },
      ],
      scores: new Map([
        [10, holes([4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4])], // 72 gross
        [11, holes([5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5])], // 90 gross
      ]),
      assignments: [],
    };
  }

  it("returns the lowest net score holder as the leader", () => {
    const out = summarizeRound(baseInputs());
    // Alice gross 72, net 72. Bob gross 90, net 72 (18 strokes). Tie — leader is alphabetical-deterministic, lowest playerId.
    assert.equal(out.holesPlayed, 18);
    assert.equal(out.totalHoles, 18);
    assert.equal(out.leaderNet, 72);
    assert.equal(out.leaderGross, 72);
    assert.ok(out.leaderName === "Alice" || out.leaderName === "Bob");
  });

  it("counts holes by max holes-played across all players in the round", () => {
    const inputs = baseInputs();
    inputs.scores = new Map([
      [10, holes([4,4,4,4,4,4,4,4,4,4,4,4])],     // 12 holes
      [11, holes([5,5,5,5,5,5,5,5])],             // 8 holes
    ]);
    const out = summarizeRound(inputs);
    assert.equal(out.holesPlayed, 12);
    assert.equal(out.totalHoles, 18);
  });

  it("returns nulls and zero leaders for an empty round", () => {
    const inputs = baseInputs();
    inputs.scores = new Map();
    const out = summarizeRound(inputs);
    assert.equal(out.holesPlayed, 0);
    assert.equal(out.leaderName, null);
    assert.equal(out.leaderNet, null);
    assert.equal(out.leaderGross, null);
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

```bash
pnpm --filter @workspace/api-server run test
```

Expected: failure with "summarizeRound is not a function" or "no export named summarizeRound".

- [ ] **Step 5: Implement `summarizeRound`**

Append to [artifacts/api-server/src/lib/scoring.ts](../../../artifacts/api-server/src/lib/scoring.ts):

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
};

export type RoundSummary = {
  leaderName: string | null;
  leaderNet: number | null;
  leaderGross: number | null;
  holesPlayed: number;
  totalHoles: number;
};

// Compact "feed-card" view of a round: who's leading by net, plus how
// many holes have been entered. Reuses computePlayerStats so the scoring
// math stays in one place.
export function summarizeRound(inputs: SummarizeInputs): RoundSummary {
  const { par, holeHcp, handicapMode, course, players, scores, assignments } = inputs;
  const playerMinHcp = buildPlayerMinHcp(players, assignments);

  let bestNet: number | null = null;
  let bestGross: number | null = null;
  let leaderId: number | null = null;
  let leaderName: string | null = null;
  let holesPlayed = 0;

  for (const p of players) {
    const holes = scores.get(p.id) ?? Array(18).fill(null);
    const stats = computePlayerStats(p, holes, par, holeHcp, playerMinHcp.get(p.id) ?? 0, handicapMode, course);
    holesPlayed = Math.max(holesPlayed, stats.holesPlayed);

    // Rank by netTotal when the player has completed; otherwise skip for the leader pick.
    const candidate = stats.netTotal;
    if (candidate == null) continue;
    if (bestNet == null || candidate < bestNet || (candidate === bestNet && (leaderId == null || p.id < leaderId))) {
      bestNet = candidate;
      bestGross = stats.grossTotal;
      leaderId = p.id;
      leaderName = stats.playerName;
    }
  }

  return {
    leaderName,
    leaderNet: bestNet,
    leaderGross: bestGross,
    holesPlayed,
    totalHoles: 18,
  };
}
```

- [ ] **Step 6: Re-run the test and confirm pass**

```bash
pnpm --filter @workspace/api-server run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/scoring.ts artifacts/api-server/src/lib/scoring.test.ts artifacts/api-server/package.json
git commit -m "feat(scoring): add summarizeRound for feed cards + wire test runner"
```

---

## Stage 4 — Server handlers

> Convention notes for this stage:
> - All routes import `requireAuth` from `../middlewares/require-auth` and use `req.user!.id` after the guard.
> - Validate path params and bodies with the generated zod schemas where they exist, else hand-write the parse.
> - Use `ser()` from `../lib/serialize` to convert `Date` → ISO strings before responding.
> - Each new router file ends in `export default router;` and is wired into `routes/index.ts` in Task 28.

### Task 20: Create the users router (profile, search, buddies)

**Files:**
- Create: `artifacts/api-server/src/routes/users.ts`

- [ ] **Step 1: Implement the router**

Create [artifacts/api-server/src/routes/users.ts](../../../artifacts/api-server/src/routes/users.ts):

```ts
import { Router, type IRouter } from "express";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  userFollowsTable,
  playersTable,
  scoresTable,
  roundsTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/users/:userId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  const viewerId = req.user!.id;

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Private profiles return a minimal payload.
  if (target.profileVisibility === "private" && target.id !== viewerId) {
    res.json({
      id: target.id,
      fullName: target.fullName,
      profileVisibility: "private",
      createdAt: ser(target.createdAt),
      followerCount: 0,
      followingCount: 0,
      viewerRelation: { isSelf: false, isFollowing: false, isFollowedBy: false },
    });
    return;
  }

  // Follower / following counts.
  const [{ followerCount }] = await db
    .select({ followerCount: sql<number>`count(*)::int` })
    .from(userFollowsTable)
    .where(eq(userFollowsTable.followedId, userId));
  const [{ followingCount }] = await db
    .select({ followingCount: sql<number>`count(*)::int` })
    .from(userFollowsTable)
    .where(eq(userFollowsTable.followerId, userId));

  const [followingRow] = await db
    .select()
    .from(userFollowsTable)
    .where(and(eq(userFollowsTable.followerId, viewerId), eq(userFollowsTable.followedId, userId)))
    .limit(1);
  const [followedByRow] = await db
    .select()
    .from(userFollowsTable)
    .where(and(eq(userFollowsTable.followerId, userId), eq(userFollowsTable.followedId, viewerId)))
    .limit(1);

  // Lifetime stats: aggregate over the user's player rows -> scores -> rounds.
  // Recent rounds are populated as a follow-up in Task 25 once lib/feed.ts exists.
  const myPlayers = await db.select().from(playersTable).where(eq(playersTable.userId, userId));
  const myPlayerIds = myPlayers.map(p => p.id);
  let stats = { roundsPlayed: 0, bestNet: null as number | null, avgNetLast10: null as number | null, coursesPlayed: 0 };

  if (myPlayerIds.length > 0) {
    const myScoreRows = await db.select().from(scoresTable).where(inArray(scoresTable.playerId, myPlayerIds));
    const myRoundIds = Array.from(new Set(myScoreRows.map(s => s.roundId)));
    if (myRoundIds.length > 0) {
      const rows = await db
        .select({ course: roundsTable.course })
        .from(roundsTable)
        .where(and(inArray(roundsTable.id, myRoundIds), eq(roundsTable.visibility, "public")));
      const coursesSet = new Set(rows.map(r => r.course?.trim().toLowerCase()).filter(Boolean) as string[]);
      stats.coursesPlayed = coursesSet.size;
      stats.roundsPlayed = myRoundIds.length;
    }
  }

  res.json({
    id: target.id,
    fullName: target.fullName,
    handicap: target.handicap,
    profileVisibility: target.profileVisibility,
    createdAt: ser(target.createdAt),
    stats,
    recentRounds: [], // Populated by Task 25 once lib/feed.ts is created.
    followerCount,
    followingCount,
    viewerRelation: {
      isSelf: viewerId === target.id,
      isFollowing: !!followingRow,
      isFollowedBy: !!followedByRow,
    },
  });
});

router.get("/users/search", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 20;
  if (q.length < 1) {
    res.json([]);
    return;
  }

  // pg_trgm similarity search. We use `%` (the trigram-similarity operator)
  // and rank by similarity descending. Exclude private profiles.
  const nameHits = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, handicap: usersTable.handicap })
    .from(usersTable)
    .where(and(
      sql`${usersTable.fullName} % ${q}`,
      eq(usersTable.profileVisibility, "public"),
    ))
    .orderBy(desc(sql`similarity(${usersTable.fullName}, ${q})`))
    .limit(limit);

  // E.164 phone lookup if the query parses as a phone number. Treat anything
  // with a leading + and >= 7 digits as a phone candidate. Honor discoverableByPhone.
  const phoneCandidate = q.startsWith("+") && q.length >= 8 ? q : null;
  let phoneHits: typeof nameHits = [];
  if (phoneCandidate) {
    phoneHits = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName, handicap: usersTable.handicap })
      .from(usersTable)
      .where(and(
        eq(usersTable.phone, phoneCandidate),
        eq(usersTable.discoverableByPhone, true),
        eq(usersTable.profileVisibility, "public"),
      ))
      .limit(1);
  }

  // Merge, dedupe by id, cap to limit.
  const byId = new Map<number, typeof nameHits[number]>();
  for (const u of [...phoneHits, ...nameHits]) {
    if (!byId.has(u.id)) byId.set(u.id, u);
    if (byId.size >= limit) break;
  }
  res.json(Array.from(byId.values()));
});

router.get("/users/me/buddies", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;

  // Buddies = users who share a round with me. Join scores to map player -> round,
  // then self-join scores by roundId to find co-players, then join players to get userId.
  // Group by other userId, count distinct rounds, capture max round.updatedAt as last_played.
  const rows = await db.execute<{
    user_id: number;
    full_name: string;
    handicap: number | null;
    rounds_together: number;
    last_played_at: string | null;
  }>(sql`
    WITH my_players AS (
      SELECT id FROM ${playersTable} WHERE user_id = ${me}
    ),
    my_round_ids AS (
      SELECT DISTINCT round_id FROM ${scoresTable}
      WHERE player_id IN (SELECT id FROM my_players)
    ),
    co_player_rounds AS (
      SELECT DISTINCT s.round_id, p.user_id
      FROM ${scoresTable} s
      JOIN ${playersTable} p ON p.id = s.player_id
      WHERE s.round_id IN (SELECT round_id FROM my_round_ids)
        AND p.user_id IS NOT NULL
        AND p.user_id <> ${me}
    )
    SELECT
      cp.user_id        AS user_id,
      u.full_name       AS full_name,
      u.handicap        AS handicap,
      COUNT(DISTINCT cp.round_id)::int AS rounds_together,
      MAX(r.updated_at) AS last_played_at
    FROM co_player_rounds cp
    JOIN ${usersTable} u ON u.id = cp.user_id
    JOIN ${roundsTable} r ON r.id = cp.round_id
    GROUP BY cp.user_id, u.full_name, u.handicap
    ORDER BY rounds_together DESC, last_played_at DESC NULLS LAST
  `);

  const items = (rows.rows ?? []).map(r => ({
    userId: r.user_id,
    fullName: r.full_name,
    handicap: r.handicap,
    roundsTogether: r.rounds_together,
    lastPlayedAt: r.last_played_at,
  }));
  res.json(items);
});

export default router;
```

(The `summarizeFeedItems` helper is created in Task 25. The buddies query uses raw SQL via `db.execute` because Drizzle's CTE + group-by ergonomics get ugly here.)

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/users.ts
git commit -m "feat(server): users router (profile, search, buddies)"
```

---

### Task 21: Create the user-follows router

**Files:**
- Create: `artifacts/api-server/src/routes/user-follows.ts`

- [ ] **Step 1: Implement the router**

Create [artifacts/api-server/src/routes/user-follows.ts](../../../artifacts/api-server/src/routes/user-follows.ts):

```ts
import { Router, type IRouter } from "express";
import { and, eq, lt, desc } from "drizzle-orm";
import { db, usersTable, userFollowsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.post("/users/:userId/follow", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const followedId = Number(req.params.userId);
  if (!Number.isFinite(followedId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  const followerId = req.user!.id;
  if (followerId === followedId) {
    res.status(400).json({ error: "Cannot follow yourself" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, followedId));
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (target.profileVisibility === "private") {
    res.status(403).json({ error: "Profile is private" });
    return;
  }

  await db
    .insert(userFollowsTable)
    .values({ followerId, followedId })
    .onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/users/:userId/follow", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const followedId = Number(req.params.userId);
  if (!Number.isFinite(followedId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }
  await db
    .delete(userFollowsTable)
    .where(and(eq(userFollowsTable.followerId, req.user!.id), eq(userFollowsTable.followedId, followedId)));
  res.sendStatus(204);
});

router.get("/users/:userId/followers", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  const rows = await db
    .select({
      userId: usersTable.id,
      fullName: usersTable.fullName,
      handicap: usersTable.handicap,
      followedAt: userFollowsTable.createdAt,
    })
    .from(userFollowsTable)
    .innerJoin(usersTable, eq(usersTable.id, userFollowsTable.followerId))
    .where(and(
      eq(userFollowsTable.followedId, userId),
      eq(usersTable.profileVisibility, "public"),
      before ? lt(userFollowsTable.createdAt, before) : undefined,
    ))
    .orderBy(desc(userFollowsTable.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({ ...r, followedAt: ser(r.followedAt) })));
});

router.get("/users/:userId/following", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  const rows = await db
    .select({
      userId: usersTable.id,
      fullName: usersTable.fullName,
      handicap: usersTable.handicap,
      followedAt: userFollowsTable.createdAt,
    })
    .from(userFollowsTable)
    .innerJoin(usersTable, eq(usersTable.id, userFollowsTable.followedId))
    .where(and(
      eq(userFollowsTable.followerId, userId),
      eq(usersTable.profileVisibility, "public"),
      before ? lt(userFollowsTable.createdAt, before) : undefined,
    ))
    .orderBy(desc(userFollowsTable.createdAt))
    .limit(limit);

  res.json(rows.map(r => ({ ...r, followedAt: ser(r.followedAt) })));
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/user-follows.ts
git commit -m "feat(server): follow/unfollow and follower/following lists"
```

---

### Task 22: Extend the rounds PATCH route to handle visibility + completedAt

**Files:**
- Modify: `artifacts/api-server/src/routes/rounds.ts`

- [ ] **Step 1: Require auth and accept the new fields**

In [artifacts/api-server/src/routes/rounds.ts](../../../artifacts/api-server/src/routes/rounds.ts), replace the existing PATCH handler with:

```ts
router.patch("/trips/:tripId/rounds/:roundId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const params = UpdateRoundParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRoundBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Load the trip + round + caller's player to decide what they're allowed to change.
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  const [round] = await db.select().from(roundsTable)
    .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  const [callerPlayer] = await db.select().from(playersTable)
    .where(and(eq(playersTable.tripId, params.data.tripId), eq(playersTable.userId, req.user!.id)))
    .limit(1);

  const isTripCreator = trip.createdByUserId === req.user!.id;
  const isPlayerInRound = !!callerPlayer;

  // Visibility flips: trip creator only.
  if (parsed.data.visibility !== undefined && !isTripCreator) {
    res.status(403).json({ error: "Only the trip creator can change visibility" });
    return;
  }
  // completedAt: any player in the trip can mark complete.
  if (parsed.data.completedAt !== undefined && !isPlayerInRound && !isTripCreator) {
    res.status(403).json({ error: "Only players in this round can mark it complete" });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.course !== undefined) updateData.course = parsed.data.course;
  if (parsed.data.date !== undefined) updateData.date = parsed.data.date;
  if (parsed.data.par !== undefined) updateData.par = parsed.data.par;
  if (parsed.data.holeHcp !== undefined) updateData.holeHcp = parsed.data.holeHcp;
  if (parsed.data.gamesConfig !== undefined) updateData.gamesConfig = parsed.data.gamesConfig;
  if (parsed.data.handicapMode !== undefined) updateData.handicapMode = parsed.data.handicapMode;
  if (parsed.data.teeBox !== undefined) updateData.teeBox = parsed.data.teeBox;
  if (parsed.data.courseRating !== undefined) updateData.courseRating = parsed.data.courseRating;
  if (parsed.data.courseSlope !== undefined) updateData.courseSlope = parsed.data.courseSlope;
  if (parsed.data.visibility !== undefined) updateData.visibility = parsed.data.visibility;
  if (parsed.data.completedAt !== undefined) {
    updateData.completedAt = parsed.data.completedAt == null ? null : new Date(parsed.data.completedAt);
  }

  const [updated] = await db.update(roundsTable).set(updateData)
    .where(and(eq(roundsTable.id, params.data.roundId), eq(roundsTable.tripId, params.data.tripId)))
    .returning();
  res.json(UpdateRoundResponse.parse(ser(updated)));
});
```

- [ ] **Step 2: Add the imports**

At the top of [artifacts/api-server/src/routes/rounds.ts](../../../artifacts/api-server/src/routes/rounds.ts), update the `db` import to include `tripsTable`:

```ts
import { db, roundsTable, playersTable, userTripFollowsTable, tripsTable } from "@workspace/db";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/rounds.ts
git commit -m "feat(server): PATCH /rounds accepts visibility + completedAt with auth rules"
```

---

### Task 23: Create the round-kudos router

**Files:**
- Create: `artifacts/api-server/src/routes/round-kudos.ts`

- [ ] **Step 1: Implement**

Create [artifacts/api-server/src/routes/round-kudos.ts](../../../artifacts/api-server/src/routes/round-kudos.ts):

```ts
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, roundsTable, roundKudosTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.post("/rounds/:roundId/kudos", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.visibility === "private") {
    res.status(403).json({ error: "Round is private" });
    return;
  }
  await db.insert(roundKudosTable)
    .values({ userId: req.user!.id, roundId })
    .onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/rounds/:roundId/kudos", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  await db.delete(roundKudosTable)
    .where(and(eq(roundKudosTable.userId, req.user!.id), eq(roundKudosTable.roundId, roundId)));
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/round-kudos.ts
git commit -m "feat(server): kudos add/remove on /rounds/:roundId/kudos"
```

---

### Task 24: Create the round-comments router

**Files:**
- Create: `artifacts/api-server/src/routes/round-comments.ts`

- [ ] **Step 1: Implement**

Create [artifacts/api-server/src/routes/round-comments.ts](../../../artifacts/api-server/src/routes/round-comments.ts):

```ts
import { Router, type IRouter } from "express";
import { and, eq, asc, isNull } from "drizzle-orm";
import { db, roundsTable, roundCommentsTable, usersTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/rounds/:roundId/comments", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const rows = await db
    .select({
      id: roundCommentsTable.id,
      roundId: roundCommentsTable.roundId,
      userId: roundCommentsTable.userId,
      userFullName: usersTable.fullName,
      parentCommentId: roundCommentsTable.parentCommentId,
      body: roundCommentsTable.body,
      createdAt: roundCommentsTable.createdAt,
    })
    .from(roundCommentsTable)
    .innerJoin(usersTable, eq(usersTable.id, roundCommentsTable.userId))
    .where(eq(roundCommentsTable.roundId, roundId))
    .orderBy(asc(roundCommentsTable.createdAt));

  res.json(rows.map(r => ({ ...r, createdAt: ser(r.createdAt) })));
});

router.post("/rounds/:roundId/comments", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const body = String(req.body?.body ?? "").trim();
  if (body.length === 0 || body.length > 1000) {
    res.status(400).json({ error: "body required (1..1000 chars)" });
    return;
  }
  const parentCommentId = req.body?.parentCommentId == null ? null : Number(req.body.parentCommentId);

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.visibility === "private") {
    res.status(403).json({ error: "Round is private" });
    return;
  }

  // If replying, the parent must (a) be on the same round and (b) have null parentCommentId.
  if (parentCommentId != null) {
    const [parent] = await db.select().from(roundCommentsTable).where(eq(roundCommentsTable.id, parentCommentId));
    if (!parent || parent.roundId !== roundId || parent.parentCommentId != null) {
      res.status(400).json({ error: "Invalid parentCommentId" });
      return;
    }
  }

  const [row] = await db.insert(roundCommentsTable).values({
    roundId,
    userId: req.user!.id,
    parentCommentId,
    body,
  }).returning();

  const [user] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, req.user!.id));
  res.status(201).json({
    id: row.id,
    roundId: row.roundId,
    userId: row.userId,
    userFullName: user.fullName,
    parentCommentId: row.parentCommentId,
    body: row.body,
    createdAt: ser(row.createdAt),
  });
});

router.delete("/comments/:commentId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const commentId = Number(req.params.commentId);
  if (!Number.isFinite(commentId)) { res.status(400).json({ error: "Invalid commentId" }); return; }
  const [row] = await db.select().from(roundCommentsTable).where(eq(roundCommentsTable.id, commentId));
  if (!row) { res.status(404).json({ error: "Comment not found" }); return; }
  if (row.userId !== req.user!.id) {
    res.status(403).json({ error: "Not the author" });
    return;
  }
  await db.delete(roundCommentsTable).where(eq(roundCommentsTable.id, commentId));
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/round-comments.ts
git commit -m "feat(server): round comments with author-only delete and reply guard"
```

---

### Task 25: Create the feed library + social-aggregate route

**Files:**
- Create: `artifacts/api-server/src/lib/feed.ts`
- Create: `artifacts/api-server/src/routes/round-social.ts`

- [ ] **Step 1: Implement the feed library**

The `summarizeFeedItems(rounds, viewerId)` helper is reused by the feed route and the user profile route. Create [artifacts/api-server/src/lib/feed.ts](../../../artifacts/api-server/src/lib/feed.ts):

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  roundsTable,
  tripsTable,
  playersTable,
  scoresTable,
  roundKudosTable,
  roundCommentsTable,
  roundGroupAssignmentsTable,
  type Round,
} from "@workspace/db";
import { summarizeRound } from "./scoring";
import { ser } from "./serialize";

export type FeedPlayer = { playerId: number; playerName: string; userId: number | null };

export type FeedItem = {
  roundId: number;
  tripId: number;
  tripKind: "event" | "personal";
  name: string;
  course: string | null;
  date: string | null;
  completedAt: string | null;
  updatedAt: string;
  visibility: "public" | "private";
  players: FeedPlayer[];
  summary: {
    leaderName: string | null;
    leaderNet: number | null;
    leaderGross: number | null;
    holesPlayed: number;
    totalHoles: number;
  };
  kudosCount: number;
  commentCount: number;
  viewerHasKudosed: boolean;
};

// Build feed items for an arbitrary list of round rows. Loads all dependencies
// (players, scores, assignments, kudos, comments) in bulk to avoid N+1.
export async function summarizeFeedItems(rounds: Round[], viewerId: number): Promise<FeedItem[]> {
  if (rounds.length === 0) return [];
  const roundIds = rounds.map(r => r.id);
  const tripIds = Array.from(new Set(rounds.map(r => r.tripId)));

  const [trips, players, scores, assignments, kudosCounts, commentCounts, viewerKudos] = await Promise.all([
    db.select().from(tripsTable).where(inArray(tripsTable.id, tripIds)),
    db.select().from(playersTable).where(inArray(playersTable.tripId, tripIds)),
    db.select().from(scoresTable).where(inArray(scoresTable.roundId, roundIds)),
    db.select().from(roundGroupAssignmentsTable).where(inArray(roundGroupAssignmentsTable.roundId, roundIds)),
    db.select({ roundId: roundKudosTable.roundId, n: sql<number>`count(*)::int` })
      .from(roundKudosTable).where(inArray(roundKudosTable.roundId, roundIds))
      .groupBy(roundKudosTable.roundId),
    db.select({ roundId: roundCommentsTable.roundId, n: sql<number>`count(*)::int` })
      .from(roundCommentsTable).where(inArray(roundCommentsTable.roundId, roundIds))
      .groupBy(roundCommentsTable.roundId),
    db.select({ roundId: roundKudosTable.roundId })
      .from(roundKudosTable).where(and(inArray(roundKudosTable.roundId, roundIds), eq(roundKudosTable.userId, viewerId))),
  ]);

  const tripById = new Map(trips.map(t => [t.id, t]));
  const playersByTrip = new Map<number, typeof players>();
  for (const p of players) {
    const arr = playersByTrip.get(p.tripId) ?? [];
    arr.push(p);
    playersByTrip.set(p.tripId, arr);
  }
  const scoresByRound = new Map<number, Map<number, (number | null)[]>>();
  for (const s of scores) {
    const m = scoresByRound.get(s.roundId) ?? new Map<number, (number | null)[]>();
    m.set(s.playerId, s.holeScores as (number | null)[]);
    scoresByRound.set(s.roundId, m);
  }
  const assignsByRound = new Map<number, { playerId: number; groupNumber: number }[]>();
  for (const a of assignments) {
    const arr = assignsByRound.get(a.roundId) ?? [];
    arr.push({ playerId: a.playerId, groupNumber: a.groupNumber });
    assignsByRound.set(a.roundId, arr);
  }
  const kudosCountByRound = new Map(kudosCounts.map(k => [k.roundId, k.n]));
  const commentCountByRound = new Map(commentCounts.map(c => [c.roundId, c.n]));
  const viewerKudosed = new Set(viewerKudos.map(k => k.roundId));

  return rounds.map((r): FeedItem => {
    const trip = tripById.get(r.tripId)!;
    const tripPlayers = playersByTrip.get(r.tripId) ?? [];
    const summary = summarizeRound({
      roundId: r.id,
      par: r.par as number[],
      holeHcp: r.holeHcp as number[],
      handicapMode: r.handicapMode,
      course: { slope: r.courseSlope, rating: r.courseRating, totalPar: (r.par as number[]).reduce((a, b) => a + b, 0) },
      players: tripPlayers.map(p => ({ id: p.id, name: p.name, handicap: p.handicap })),
      scores: scoresByRound.get(r.id) ?? new Map(),
      assignments: assignsByRound.get(r.id) ?? [],
    });
    return {
      roundId: r.id,
      tripId: r.tripId,
      tripKind: trip.kind,
      name: r.name,
      course: r.course,
      date: r.date,
      completedAt: r.completedAt ? ser(r.completedAt) : null,
      updatedAt: ser(r.updatedAt),
      visibility: r.visibility,
      players: tripPlayers.map(p => ({ playerId: p.id, playerName: p.name, userId: p.userId })),
      summary,
      kudosCount: kudosCountByRound.get(r.id) ?? 0,
      commentCount: commentCountByRound.get(r.id) ?? 0,
      viewerHasKudosed: viewerKudosed.has(r.id),
    };
  });
}
```

- [ ] **Step 2: Implement the social-aggregate route**

Create [artifacts/api-server/src/routes/round-social.ts](../../../artifacts/api-server/src/routes/round-social.ts):

```ts
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, roundCommentsTable, roundKudosTable, roundsTable, usersTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/rounds/:roundId/social", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }

  const [kudosCountRow, viewerKudosRow, recentKudosRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(roundKudosTable).where(eq(roundKudosTable.roundId, roundId)),
    db.select().from(roundKudosTable)
      .where(and(eq(roundKudosTable.roundId, roundId), eq(roundKudosTable.userId, req.user!.id))).limit(1),
    db.select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        handicap: usersTable.handicap,
        createdAt: roundKudosTable.createdAt,
      })
      .from(roundKudosTable)
      .innerJoin(usersTable, eq(usersTable.id, roundKudosTable.userId))
      .where(eq(roundKudosTable.roundId, roundId))
      .orderBy(desc(roundKudosTable.createdAt))
      .limit(5),
  ]);

  const [commentCountRow, commentItems] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(roundCommentsTable).where(eq(roundCommentsTable.roundId, roundId)),
    db.select({
        id: roundCommentsTable.id,
        roundId: roundCommentsTable.roundId,
        userId: roundCommentsTable.userId,
        userFullName: usersTable.fullName,
        parentCommentId: roundCommentsTable.parentCommentId,
        body: roundCommentsTable.body,
        createdAt: roundCommentsTable.createdAt,
      })
      .from(roundCommentsTable)
      .innerJoin(usersTable, eq(usersTable.id, roundCommentsTable.userId))
      .where(eq(roundCommentsTable.roundId, roundId))
      .orderBy(asc(roundCommentsTable.createdAt)),
  ]);

  res.json({
    kudos: {
      count: kudosCountRow[0]?.n ?? 0,
      viewerHasKudosed: !!viewerKudosRow[0],
      recentUsers: recentKudosRows.map(r => ({ id: r.id, fullName: r.fullName, handicap: r.handicap })),
    },
    comments: {
      count: commentCountRow[0]?.n ?? 0,
      items: commentItems.map(c => ({ ...c, createdAt: ser(c.createdAt) })),
    },
  });
});

export default router;
```

- [ ] **Step 3: Backfill the users router's recentRounds with the feed library**

In [artifacts/api-server/src/routes/users.ts](../../../artifacts/api-server/src/routes/users.ts), add the import:

```ts
import { summarizeFeedItems } from "../lib/feed";
```

Find the `GET /users/:userId` handler. Inside the `if (myRoundIds.length > 0) { ... }` block, after the `coursesSet` / `stats` updates, add:

```ts
const recentRoundRows = await db
  .select()
  .from(roundsTable)
  .where(and(inArray(roundsTable.id, myRoundIds), eq(roundsTable.visibility, "public")))
  .orderBy(desc(sql`coalesce(${roundsTable.completedAt}, ${roundsTable.updatedAt})`))
  .limit(20);
var recentRounds = await summarizeFeedItems(recentRoundRows, viewerId);
```

(Using `var` here is intentional — we want to lift the binding so it's available below. If you'd rather, declare `let recentRounds: FeedItem[] = []` outside the `if` block instead.)

Then in the `res.json({ ... })` payload, replace `recentRounds: []` with `recentRounds: typeof recentRounds === "undefined" ? [] : recentRounds`. Or, cleaner: hoist a `let recentRounds: FeedItem[] = []` before the `if` block (matching the `stats` pattern), assign inside, and pass it directly.

Final shape of the relevant block:

```ts
let stats = { roundsPlayed: 0, bestNet: null as number | null, avgNetLast10: null as number | null, coursesPlayed: 0 };
let recentRounds: Awaited<ReturnType<typeof summarizeFeedItems>> = [];

if (myPlayerIds.length > 0) {
  const myScoreRows = await db.select().from(scoresTable).where(inArray(scoresTable.playerId, myPlayerIds));
  const myRoundIds = Array.from(new Set(myScoreRows.map(s => s.roundId)));
  if (myRoundIds.length > 0) {
    const courseRows = await db
      .select({ course: roundsTable.course })
      .from(roundsTable)
      .where(and(inArray(roundsTable.id, myRoundIds), eq(roundsTable.visibility, "public")));
    const coursesSet = new Set(courseRows.map(r => r.course?.trim().toLowerCase()).filter(Boolean) as string[]);
    stats.coursesPlayed = coursesSet.size;
    stats.roundsPlayed = myRoundIds.length;

    const recentRows = await db
      .select()
      .from(roundsTable)
      .where(and(inArray(roundsTable.id, myRoundIds), eq(roundsTable.visibility, "public")))
      .orderBy(desc(sql`coalesce(${roundsTable.completedAt}, ${roundsTable.updatedAt})`))
      .limit(20);
    recentRounds = await summarizeFeedItems(recentRows, viewerId);
  }
}

// ...later in res.json:
res.json({
  // ...
  stats,
  recentRounds,
  // ...
});
```

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/feed.ts artifacts/api-server/src/routes/round-social.ts artifacts/api-server/src/routes/users.ts
git commit -m "feat(server): feed library + round social aggregate + user profile recent rounds"
```

---

### Task 26: Create the feed route

**Files:**
- Create: `artifacts/api-server/src/routes/feed.ts`

- [ ] **Step 1: Implement**

Create [artifacts/api-server/src/routes/feed.ts](../../../artifacts/api-server/src/routes/feed.ts):

```ts
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, lt, sql, ne } from "drizzle-orm";
import {
  db,
  roundsTable,
  playersTable,
  scoresTable,
  userFollowsTable,
  usersTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { summarizeFeedItems } from "../lib/feed";

const router: IRouter = Router();

const SORT_KEY = sql`coalesce(${roundsTable.completedAt}, ${roundsTable.updatedAt})`;

router.get("/feed", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const tabRaw = String(req.query.tab ?? "");
  const tab: "buddies" | "following" | "all" =
    tabRaw === "buddies" || tabRaw === "following" || tabRaw === "all" ? tabRaw : "all";
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
  const beforeRaw = req.query.before ? String(req.query.before) : null;
  const before = beforeRaw ? new Date(beforeRaw) : null;
  const me = req.user!.id;

  // Resolve the set of "interesting" userIds for this tab.
  let interestingUserIds: number[] | null = null; // null = "no filter"
  if (tab === "following") {
    const rows = await db
      .select({ id: userFollowsTable.followedId })
      .from(userFollowsTable)
      .where(eq(userFollowsTable.followerId, me));
    interestingUserIds = rows.map(r => r.id);
    if (interestingUserIds.length === 0) {
      res.json({ items: [], nextBefore: null });
      return;
    }
  } else if (tab === "buddies") {
    const rows = await db.execute<{ user_id: number }>(sql`
      WITH my_player_ids AS (
        SELECT id FROM ${playersTable} WHERE user_id = ${me}
      ),
      my_round_ids AS (
        SELECT DISTINCT round_id FROM ${scoresTable}
        WHERE player_id IN (SELECT id FROM my_player_ids)
      )
      SELECT DISTINCT p.user_id
      FROM ${scoresTable} s
      JOIN ${playersTable} p ON p.id = s.player_id
      WHERE s.round_id IN (SELECT round_id FROM my_round_ids)
        AND p.user_id IS NOT NULL
        AND p.user_id <> ${me}
    `);
    interestingUserIds = (rows.rows ?? []).map(r => r.user_id);
    if (interestingUserIds.length === 0) {
      res.json({ items: [], nextBefore: null });
      return;
    }
  }

  // Find rounds whose player list intersects with `interestingUserIds` (or all rounds for tab=all).
  // For all-tab, exclude rounds where every linked player has profileVisibility=private OR userId is null.
  // For buddies/following, filter rounds to those that include any player with userId in interestingUserIds.

  // Build the set of candidate round IDs.
  let candidateRoundIds: number[];
  if (interestingUserIds == null) {
    // All public rounds, regardless of player linkage.
    const rows = await db
      .select({ id: roundsTable.id })
      .from(roundsTable)
      .where(and(
        eq(roundsTable.visibility, "public"),
        before ? lt(SORT_KEY, before) : undefined,
      ))
      .orderBy(desc(SORT_KEY))
      .limit(limit * 3); // overfetch to allow visibility filter below
    candidateRoundIds = rows.map(r => r.id);
  } else {
    const rows = await db
      .selectDistinct({ id: roundsTable.id, sortKey: SORT_KEY })
      .from(roundsTable)
      .innerJoin(playersTable, eq(playersTable.tripId, roundsTable.tripId))
      .where(and(
        eq(roundsTable.visibility, "public"),
        inArray(playersTable.userId, interestingUserIds),
        before ? lt(SORT_KEY, before) : undefined,
      ))
      .orderBy(desc(SORT_KEY))
      .limit(limit * 3);
    candidateRoundIds = rows.map(r => r.id);
  }

  if (candidateRoundIds.length === 0) {
    res.json({ items: [], nextBefore: null });
    return;
  }

  // Load the round rows, ordered.
  const rounds = await db
    .select()
    .from(roundsTable)
    .where(inArray(roundsTable.id, candidateRoundIds))
    .orderBy(desc(SORT_KEY));

  // For tab=all, exclude rounds where every linked player is private OR has null userId.
  let filteredRounds = rounds;
  if (tab === "all") {
    const tripIds = Array.from(new Set(rounds.map(r => r.tripId)));
    const rPlayers = await db.select().from(playersTable).where(inArray(playersTable.tripId, tripIds));
    const userIds = Array.from(new Set(rPlayers.map(p => p.userId).filter((id): id is number => id != null)));
    const users = userIds.length === 0 ? [] : await db.select({ id: usersTable.id, profileVisibility: usersTable.profileVisibility }).from(usersTable).where(inArray(usersTable.id, userIds));
    const visById = new Map(users.map(u => [u.id, u.profileVisibility]));
    filteredRounds = rounds.filter(r => {
      const playersOnRound = rPlayers.filter(p => p.tripId === r.tripId);
      // Keep round if at least one player has a userId AND public profile.
      return playersOnRound.some(p => p.userId != null && visById.get(p.userId) === "public");
    });
  }

  const page = filteredRounds.slice(0, limit);
  const items = await summarizeFeedItems(page, me);
  const last = page[page.length - 1];
  const nextBefore = page.length === limit && last ? ser(last.completedAt ?? last.updatedAt) : null;

  res.json({ items, nextBefore });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/feed.ts
git commit -m "feat(server): /feed endpoint with buddies/following/all tabs"
```

---

### Task 27: Create the solo-round route

**Files:**
- Create: `artifacts/api-server/src/routes/solo-round.ts`

- [ ] **Step 1: Implement**

Create [artifacts/api-server/src/routes/solo-round.ts](../../../artifacts/api-server/src/routes/solo-round.ts):

```ts
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tripsTable, roundsTable, playersTable } from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

const DEFAULT_PAR = Array(18).fill(4);
const DEFAULT_HCP = Array.from({ length: 18 }, (_, i) => i + 1);

router.post("/users/me/personal-trip/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!;
  const body = req.body ?? {};
  const name = String(body.name ?? "").trim();
  if (name.length === 0) { res.status(400).json({ error: "name required" }); return; }

  // Find-or-create personal trip.
  const [existing] = await db.select().from(tripsTable)
    .where(and(eq(tripsTable.createdByUserId, me.id), eq(tripsTable.kind, "personal")))
    .limit(1);

  let trip = existing;
  if (!trip) {
    [trip] = await db.insert(tripsTable).values({
      name: `${me.fullName}'s rounds`,
      kind: "personal",
      createdByUserId: me.id,
    }).returning();
  }

  // Create the round.
  const [round] = await db.insert(roundsTable).values({
    tripId: trip.id,
    name,
    course: body.course ?? null,
    date: body.date ?? null,
    par: Array.isArray(body.par) ? body.par : DEFAULT_PAR,
    holeHcp: Array.isArray(body.holeHcp) ? body.holeHcp : DEFAULT_HCP,
    teeBox: body.teeBox ?? null,
    courseRating: body.courseRating ?? null,
    courseSlope: body.courseSlope ?? null,
  }).returning();

  // Ensure the user has a player row in their personal trip.
  const [existingPlayer] = await db.select().from(playersTable)
    .where(and(eq(playersTable.tripId, trip.id), eq(playersTable.userId, me.id)))
    .limit(1);
  let player = existingPlayer;
  if (!player) {
    [player] = await db.insert(playersTable).values({
      tripId: trip.id,
      userId: me.id,
      name: me.fullName,
      handicap: me.handicap ?? 18,
    }).returning();
  }

  res.status(201).json({ tripId: trip.id, roundId: round.id, playerId: player.id });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/solo-round.ts
git commit -m "feat(server): solo-round endpoint (find-or-create personal trip)"
```

---

### Task 28: Wire all new routers + harden personal-trip privacy

**Files:**
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/trips.ts`

- [ ] **Step 1: Wire the new routers**

Replace [artifacts/api-server/src/routes/index.ts](../../../artifacts/api-server/src/routes/index.ts):

```ts
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersMeRouter from "./users-me";
import usersRouter from "./users";
import userFollowsRouter from "./user-follows";
import soloRoundRouter from "./solo-round";
import tripsRouter from "./trips";
import playersRouter from "./players";
import roundsRouter from "./rounds";
import scoresRouter from "./scores";
import scrambleScoresRouter from "./scramble-scores";
import leaderboardRouter from "./leaderboard";
import coursesRouter from "./courses";
import groupsRouter from "./groups";
import roundKudosRouter from "./round-kudos";
import roundCommentsRouter from "./round-comments";
import roundSocialRouter from "./round-social";
import feedRouter from "./feed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersMeRouter);
router.use(usersRouter);
router.use(userFollowsRouter);
router.use(soloRoundRouter);
router.use(tripsRouter);
router.use(playersRouter);
router.use(roundsRouter);
router.use(scoresRouter);
router.use(scrambleScoresRouter);
router.use(leaderboardRouter);
router.use(coursesRouter);
router.use(groupsRouter);
router.use(roundKudosRouter);
router.use(roundCommentsRouter);
router.use(roundSocialRouter);
router.use(feedRouter);

export default router;
```

- [ ] **Step 2: Restrict personal-trip detail visibility**

In [artifacts/api-server/src/routes/trips.ts](../../../artifacts/api-server/src/routes/trips.ts), find the `GET /trips/:tripId` handler and add a personal-trip ownership check. The spec says: personal trips return 404 to anyone other than the owner.

Open the file and locate the existing handler. Wrap the response so that if `trip.kind === "personal"` and the caller is not the creator, respond 404. Because the endpoint is currently unauthenticated, we need to optionally inspect the bearer token. Use the existing `requireAuth` middleware in optional mode — or, simpler, swap to `requireAuth` and respond 404 for personal-trip-not-owner.

Replace the handler with:

```ts
router.get("/trips/:tripId", async (req, res): Promise<void> => {
  const params = GetTripParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }

  if (trip.kind === "personal") {
    // Only the owner can fetch the personal trip envelope.
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) { res.status(404).json({ error: "Trip not found" }); return; }
    const { verifySessionToken } = await import("../lib/jwt");
    const payload = verifySessionToken(auth.slice(7).trim());
    if (!payload || payload.userId !== trip.createdByUserId) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
  }
  res.json(GetTripResponse.parse(ser(trip)));
});
```

(Re-read the current trips.ts to confirm `GetTripParams` / `GetTripResponse` import names and add any missing imports. If `verifySessionToken` isn't exported by `lib/jwt.ts`, expose it or use the existing `requireAuth` pattern.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: passes. Fix any cross-route imports as needed.

- [ ] **Step 4: Smoke-test the server boots**

```bash
pnpm --filter @workspace/api-server run dev
```

(In a separate terminal — Ctrl-C after `Listening on …`.)

Expected: server starts with no thrown errors. Then quit.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/trips.ts
git commit -m "feat(server): wire new routers and gate personal-trip GET to owner"
```

---

## Stage 5 — Client foundation

### Task 29: Add new routes to App.tsx (Feed default, profile, search)

**Files:**
- Modify: `artifacts/golf-scorecard/src/App.tsx`

- [ ] **Step 1: Add imports for the new pages and the search box**

The feed page goes at `/`, but logged-out viewers still need the landing. We'll do this with an inline switch inside the existing `/` route.

At the top of [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx), after the existing page imports, add:

```ts
import FeedPage from "@/pages/feed";
import UserProfilePage from "@/pages/user-profile";
```

- [ ] **Step 2: Rewrite the Router switch**

Replace the existing `Switch` block inside `Router()` with:

```tsx
<Switch>
  <Route path="/" component={HomeOrFeed} />
  <Route path="/landing" component={LandingPage} />
  <Route path="/trips" component={TripsPage} />
  <Route path="/trips/new" component={NewTripPage} />
  <Route path="/privacy" component={PrivacyPage} />
  <Route path="/me/trips" component={MyTripsPage} />
  <Route path="/profile" component={ProfilePage} />
  <Route path="/users/:userId" component={UserProfileOrSelf} />
  <Route path="/trips/:tripId" component={GatedTripHub} />
  <Route path="/trips/:tripId/rounds/:roundId" component={GatedRound} />
  <Route component={NotFound} />
</Switch>
```

And add two helper components above `Router()`:

```tsx
function HomeOrFeed() {
  const session = useAuthSession();
  return session ? <FeedPage /> : <LandingPage />;
}

function UserProfileOrSelf() {
  const { userId } = useParams<{ userId: string }>();
  const session = useAuthSession();
  const [, navigate] = useLocation();
  const id = Number(userId);
  useEffect(() => {
    if (session && id === session.user.id) {
      navigate("/profile", { replace: true });
    }
  }, [session, id, navigate]);
  if (!id) return <NotFound />;
  return <UserProfilePage userId={id} />;
}
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/App.tsx
git commit -m "feat(client): mount feed at / for signed-in users; add /users/:userId"
```

---

### Task 30: Make TripAuthGate accept read-only observer mode for public rounds

**Files:**
- Modify: `artifacts/golf-scorecard/src/components/trip-auth-gate.tsx`
- Modify: `artifacts/golf-scorecard/src/lib/trip-identity.ts`

- [ ] **Step 1: Auto-set observer identity for in-progress public rounds**

The spec says signed-in viewers with no player row in a public trip should land on the scorecard in observer mode. The current gate already supports `kind: "observer"` but only when manually picked. Add an effect: if the viewer is signed in, has no `useTripIdentity` entry, has no linked player in the trip, AND the gate is opened to a round path where `round.visibility=public`, auto-set `kind: "observer"` and skip the picker.

In [artifacts/golf-scorecard/src/components/trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx), after the existing auto-resolve-identity effect (around line 57–64), add:

```ts
// Auto-observer: if we're viewing a public trip but the viewer isn't a player
// in it, drop them into read-only mode instead of forcing the "Who are you?" picker.
useEffect(() => {
  if (identity) return;
  if (!session) return;
  if (!players) return;
  const isLinkedPlayer = players.some(p => p.userId === session.user.id);
  if (isLinkedPlayer) return;
  // Heuristic: when the URL is a /rounds/:roundId path the viewer is consuming
  // the scorecard, not opening the trip envelope — observer mode is appropriate.
  if (typeof window !== "undefined" && /\/rounds\/\d+/.test(window.location.pathname)) {
    setTripIdentity(tripId, { kind: "observer" });
  }
}, [identity, session, players, tripId]);
```

- [ ] **Step 2: Confirm trip-identity has a re-exported `setTripIdentity`**

[artifacts/golf-scorecard/src/lib/trip-identity.ts](../../../artifacts/golf-scorecard/src/lib/trip-identity.ts) already exports `setTripIdentity` — no edit needed unless the import in the gate file is missing it. The gate already imports both `useTripIdentity` and `setTripIdentity`.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/components/trip-auth-gate.tsx
git commit -m "feat(client): auto-observer for signed-in viewers on public rounds"
```

---

### Task 31: Add a user-search popover component

**Files:**
- Create: `artifacts/golf-scorecard/src/components/user-search.tsx`

- [ ] **Step 1: Implement the search component**

Create [artifacts/golf-scorecard/src/components/user-search.tsx](../../../artifacts/golf-scorecard/src/components/user-search.tsx):

```tsx
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useSearchUsers } from "@workspace/api-client-react";
import { Search } from "lucide-react";

const DEBOUNCE_MS = 200;

export function UserSearchBar() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const { data: results } = useSearchUsers(
    { q: debounced, limit: 20 },
    { query: { enabled: debounced.length > 0 } }
  );

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 px-3 h-10 rounded-full" style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--card-border))" }}>
        <Search size={14} aria-hidden style={{ color: "hsl(var(--muted-foreground))" }} />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search golfers…"
          className="flex-1 bg-transparent text-sm font-sans outline-none"
        />
      </div>
      {open && debounced.length > 0 && (
        <div className="absolute z-40 mt-2 w-full rounded-lg overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", boxShadow: "0 10px 24px -8px rgba(0,0,0,0.18)" }}>
          {(results ?? []).length === 0 ? (
            <div className="px-4 py-3 text-xs font-sans" style={{ color: "hsl(var(--muted-foreground))" }}>No matches</div>
          ) : (
            (results ?? []).map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => { setOpen(false); setQ(""); navigate(`/users/${u.id}`); }}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-accent transition-colors"
              >
                <span className="font-sans text-sm text-card-foreground">{u.fullName}</span>
                <span className="font-sans text-xs tabular-nums text-muted-foreground">
                  {u.handicap == null ? "—" : `hcp ${u.handicap.toFixed(1)}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/golf-scorecard/src/components/user-search.tsx
git commit -m "feat(client): user-search popover (debounced)"
```

---

### Task 32: Mount the search bar into the nav (signed-in only)

**Files:**
- Modify: `artifacts/golf-scorecard/src/App.tsx`

- [ ] **Step 1: Insert `<UserSearchBar />`**

In [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx), import:

```ts
import { UserSearchBar } from "@/components/user-search";
```

Inside the `<NavBar />` component, between the brand link and the right cluster, insert (only when `session` is truthy):

```tsx
{session && (
  <div className="flex-1 mx-3 max-w-xs hidden sm:block">
    <UserSearchBar />
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/golf-scorecard/src/App.tsx
git commit -m "feat(client): mount UserSearchBar in the nav"
```

---

## Stage 6 — Client pages

### Task 33: Build the Feed page

**Files:**
- Create: `artifacts/golf-scorecard/src/pages/feed.tsx`
- Create: `artifacts/golf-scorecard/src/components/feed-card.tsx`

- [ ] **Step 1: Implement the feed card**

Create [artifacts/golf-scorecard/src/components/feed-card.tsx](../../../artifacts/golf-scorecard/src/components/feed-card.tsx):

```tsx
import { useGiveKudos, useRevokeKudos, getGetFeedQueryKey, type FeedItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Heart, MessageCircle, MapPin } from "lucide-react";

type Props = { item: FeedItem };

export function FeedCard({ item }: Props) {
  const qc = useQueryClient();
  const give = useGiveKudos();
  const revoke = useRevokeKudos();
  const [, navigate] = useLocation();

  const isLive = item.completedAt == null;
  const tripKindLabel = item.tripKind === "personal" ? "Solo round" : null;

  function toggleKudos() {
    const mutate = (item.viewerHasKudosed ? revoke.mutate : give.mutate);
    mutate(
      { roundId: item.roundId },
      { onSettled: () => qc.invalidateQueries({ queryKey: getGetFeedQueryKey() }) }
    );
  }

  return (
    <article className="rounded-2xl bg-card border border-card-border px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em]"
          style={{ color: isLive ? "hsl(var(--brass-ink))" : "hsl(var(--muted-foreground))" }}
        >
          {isLive ? `Playing now · ${item.summary.holesPlayed}/${item.summary.totalHoles}` : "Final"}
        </span>
        {tripKindLabel && (
          <span className="text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">· {tripKindLabel}</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate(`/trips/${item.tripId}/rounds/${item.roundId}`)}
        className="block w-full text-left"
      >
        <h3 className="font-serif text-lg font-semibold text-card-foreground leading-tight">{item.name}</h3>
        {item.course && (
          <div className="flex items-center gap-1 mt-1 text-xs font-sans text-muted-foreground">
            <MapPin size={12} aria-hidden />
            {item.course}
          </div>
        )}
      </button>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-sans">
        {item.players.map(p => (
          p.userId ? (
            <Link key={p.playerId} href={`/users/${p.userId}`} className="text-card-foreground hover:underline">
              {p.playerName}
            </Link>
          ) : (
            <span key={p.playerId} className="text-muted-foreground">{p.playerName}</span>
          )
        ))}
      </div>

      {item.summary.leaderName && (
        <p className="mt-3 text-sm font-sans text-card-foreground">
          <span className="font-semibold">{item.summary.leaderName}</span>
          {item.summary.leaderNet != null && <> · net {item.summary.leaderNet}</>}
          {item.summary.leaderGross != null && <> · gross {item.summary.leaderGross}</>}
        </p>
      )}

      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={toggleKudos}
          aria-pressed={item.viewerHasKudosed}
          className="flex items-center gap-1 text-xs font-sans"
          style={{ color: item.viewerHasKudosed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
        >
          <Heart size={14} aria-hidden fill={item.viewerHasKudosed ? "currentColor" : "none"} />
          <span className="tabular-nums">{item.kudosCount}</span>
        </button>
        <span className="flex items-center gap-1 text-xs font-sans text-muted-foreground">
          <MessageCircle size={14} aria-hidden />
          <span className="tabular-nums">{item.commentCount}</span>
        </span>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Implement the feed page**

Create [artifacts/golf-scorecard/src/pages/feed.tsx](../../../artifacts/golf-scorecard/src/pages/feed.tsx):

```tsx
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { customFetch, getFeed, type FeedPage, type FeedItem } from "@workspace/api-client-react";
import { FeedCard } from "@/components/feed-card";
import { useAuthSession } from "@/lib/auth";
import { useListMyBuddies } from "@workspace/api-client-react";
import { SoloRoundModal } from "@/components/solo-round-modal";

type Tab = "buddies" | "following" | "all";

export default function FeedPage() {
  const session = useAuthSession();
  const [, navigate] = useLocation();
  const { data: buddies } = useListMyBuddies({ query: { enabled: !!session } });
  const [tab, setTab] = useState<Tab>(() => "all");
  const [soloOpen, setSoloOpen] = useState(false);

  // Default tab once buddies resolve.
  useEffect(() => {
    if (buddies && buddies.length > 0) setTab("buddies");
  }, [buddies]);

  const query = useInfiniteQuery({
    queryKey: ["feed", tab],
    queryFn: ({ pageParam }) =>
      getFeed({ tab, before: pageParam ?? undefined, limit: 20 }) as Promise<FeedPage>,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: !!session,
    refetchInterval: 30_000,
  });

  const items: FeedItem[] = useMemo(
    () => (query.data?.pages ?? []).flatMap(p => p.items),
    [query.data]
  );

  if (!session) return null;

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center gap-1 mb-4 border-b border-card-border">
          {(["buddies", "following", "all"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className="px-3 py-2 text-[11px] font-sans font-semibold uppercase tracking-[0.18em]"
              style={{
                color: tab === t ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                borderBottom: tab === t ? "2px solid hsl(var(--primary))" : "2px solid transparent",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {query.isLoading && (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-32 rounded-2xl animate-pulse bg-card border border-card-border" />)}</div>
        )}
        {!query.isLoading && items.length === 0 && (
          <p className="text-sm font-sans text-muted-foreground text-center py-12">
            {tab === "buddies" && "Play a round with someone to start seeing their rounds here."}
            {tab === "following" && "Find people you know and follow them to fill this feed."}
            {tab === "all" && "No public rounds yet."}
          </p>
        )}
        <div className="space-y-3">
          {items.map(item => <FeedCard key={item.roundId} item={item} />)}
        </div>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            className="w-full mt-4 py-3 rounded-full text-sm font-sans font-semibold bg-card border border-card-border"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setSoloOpen(true)}
        aria-label="Log a round"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
      >
        <Plus size={22} aria-hidden />
      </button>
      <SoloRoundModal open={soloOpen} onClose={() => setSoloOpen(false)} onCreated={({ tripId, roundId }) => navigate(`/trips/${tripId}/rounds/${roundId}`)} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/components/feed-card.tsx artifacts/golf-scorecard/src/pages/feed.tsx
git commit -m "feat(client): Feed page with three tabs and 30s live refetch"
```

---

### Task 34: Build the solo-round modal

**Files:**
- Create: `artifacts/golf-scorecard/src/components/solo-round-modal.tsx`

- [ ] **Step 1: Implement**

Create [artifacts/golf-scorecard/src/components/solo-round-modal.tsx](../../../artifacts/golf-scorecard/src/components/solo-round-modal.tsx):

```tsx
import { useState } from "react";
import { useCreateSoloRound } from "@workspace/api-client-react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (ids: { tripId: number; roundId: number; playerId: number }) => void;
};

export function SoloRoundModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const create = useCreateSoloRound();

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim() || (course.trim() || "New round");
    create.mutate(
      { data: { name: n, course: course.trim() || null } },
      { onSuccess: (resp) => { onCreated(resp); onClose(); setName(""); setCourse(""); } }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <form onSubmit={submit} className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg text-card-foreground">Log a round</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1"><X size={18} /></button>
        </div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Course</label>
        <input
          autoFocus
          value={course}
          onChange={e => setCourse(e.target.value)}
          placeholder="e.g. Bethpage Black"
          className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans mb-4"
          style={{ border: "1.5px solid hsl(var(--input))" }}
        />
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Round name (optional)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Defaults to the course name"
          className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans mb-5"
          style={{ border: "1.5px solid hsl(var(--input))" }}
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="w-full py-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm disabled:opacity-50"
        >
          {create.isPending ? "Starting…" : "Start round"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/golf-scorecard/src/components/solo-round-modal.tsx
git commit -m "feat(client): solo-round modal — course + name → POST /personal-trip/rounds"
```

---

### Task 35: Build the public user-profile page

**Files:**
- Create: `artifacts/golf-scorecard/src/pages/user-profile.tsx`

- [ ] **Step 1: Implement**

Create [artifacts/golf-scorecard/src/pages/user-profile.tsx](../../../artifacts/golf-scorecard/src/pages/user-profile.tsx):

```tsx
import { useGetUserProfile, useFollowUser, useUnfollowUser, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserPlus, UserMinus } from "lucide-react";
import { useLocation } from "wouter";
import { FeedCard } from "@/components/feed-card";

export default function UserProfilePage({ userId }: { userId: number }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data, isLoading } = useGetUserProfile(userId);
  const follow = useFollowUser();
  const unfollow = useUnfollowUser();

  if (isLoading || !data) {
    return <div className="min-h-dvh bg-background grid place-items-center"><div className="text-sm font-sans text-muted-foreground">Loading…</div></div>;
  }

  const isPrivate = data.profileVisibility === "private" && !data.viewerRelation.isSelf;

  function toggleFollow() {
    const mutate = data.viewerRelation.isFollowing ? unfollow.mutate : follow.mutate;
    mutate({ userId }, { onSettled: () => qc.invalidateQueries({ queryKey: getGetUserProfileQueryKey(userId) }) });
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-8 pb-5 bg-sidebar">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate("/")} className="text-xs font-sans mb-3 flex items-center gap-1.5" style={{ color: "hsl(var(--brass-muted))" }}>
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-serif text-primary">{data.fullName}</h1>
              {!isPrivate && data.handicap != null && (
                <p className="text-sm font-sans mt-1 text-[hsl(var(--brass-faint))]">Handicap {data.handicap.toFixed(1)}</p>
              )}
            </div>
            {!data.viewerRelation.isSelf && !isPrivate && (
              <button
                type="button"
                onClick={toggleFollow}
                aria-pressed={data.viewerRelation.isFollowing}
                className="px-4 py-2 rounded-full text-[11px] font-sans font-semibold uppercase tracking-[0.18em]"
                style={{
                  background: data.viewerRelation.isFollowing ? "transparent" : "hsl(var(--primary))",
                  color: data.viewerRelation.isFollowing ? "hsl(var(--brass-muted))" : "hsl(var(--primary-foreground))",
                  border: data.viewerRelation.isFollowing ? "1px solid hsla(42,52%,59%,0.45)" : "none",
                }}
              >
                {data.viewerRelation.isFollowing ? <><UserMinus size={12} className="inline mr-1" />Following</> : <><UserPlus size={12} className="inline mr-1" />Follow</>}
              </button>
            )}
          </div>
          {!isPrivate && (
            <div className="flex gap-5 mt-3 text-xs font-sans text-[hsl(var(--brass-faint))]">
              <span><strong className="text-[hsl(var(--brass-muted))]">{data.followerCount}</strong> followers</span>
              <span><strong className="text-[hsl(var(--brass-muted))]">{data.followingCount}</strong> following</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-3">
        {isPrivate ? (
          <p className="text-sm font-sans text-muted-foreground text-center py-12">This profile is private.</p>
        ) : (
          <>
            {data.stats && (
              <div className="rounded-2xl bg-card border border-card-border px-5 py-4 grid grid-cols-3 gap-3 text-center">
                <Stat label="Rounds" value={String(data.stats.roundsPlayed)} />
                <Stat label="Courses" value={String(data.stats.coursesPlayed)} />
                <Stat label="Best net" value={data.stats.bestNet == null ? "—" : String(data.stats.bestNet)} />
              </div>
            )}
            {(data.recentRounds ?? []).length > 0 ? (
              <div className="space-y-3">
                {(data.recentRounds ?? []).map(item => <FeedCard key={item.roundId} item={item} />)}
              </div>
            ) : (
              <p className="text-sm font-sans text-muted-foreground text-center py-12">No public rounds yet.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-serif text-lg font-semibold tabular-nums text-card-foreground">{value}</div>
      <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/user-profile.tsx
git commit -m "feat(client): /users/:userId profile page with follow + recent rounds"
```

---

### Task 36: Add settings (privacy + name) to /profile

**Files:**
- Modify: `artifacts/golf-scorecard/src/lib/auth.ts`
- Modify: `artifacts/golf-scorecard/src/pages/profile.tsx`

- [ ] **Step 0: Extend the AuthUser type with the new fields**

The session-stored user shape lives in [artifacts/golf-scorecard/src/lib/auth.ts](../../../artifacts/golf-scorecard/src/lib/auth.ts). Replace the `AuthUser` type definition with:

```ts
export type AuthUser = {
  id: number;
  phone: string;
  fullName: string;
  handicap?: number | null;
  discoverableByPhone: boolean;
  profileVisibility: "public" | "private";
  createdAt: string;
};
```

Existing sessions in localStorage may lack these fields — the `maybeRefreshSession()` call on app boot already re-hits `/auth/refresh` which returns a full User, populating the fields. Until then, default fall-throughs in the UI handle `undefined` gracefully (e.g. `!!session.user.discoverableByPhone`).

- [ ] **Step 1: Add a Settings section to ProfileContent**

In [artifacts/golf-scorecard/src/pages/profile.tsx](../../../artifacts/golf-scorecard/src/pages/profile.tsx), inside the `<main>` block, after `<StatsSection />`, add `<SettingsSection />` and import it from a new section component below.

Add this new component below `StatsSection`:

```tsx
function SettingsSection() {
  const session = useAuthSession();
  const updateMe = useUpdateMe();
  const { toast } = useToast();
  const [discoverable, setDiscoverable] = useState(!!session?.user.discoverableByPhone);
  const [profileVisibility, setProfileVisibility] = useState<"public" | "private">(session?.user.profileVisibility ?? "public");

  useEffect(() => {
    if (session) {
      setDiscoverable(!!session.user.discoverableByPhone);
      setProfileVisibility(session.user.profileVisibility);
    }
  }, [session]);

  function persist(patch: { discoverableByPhone?: boolean; profileVisibility?: "public" | "private" }) {
    updateMe.mutate(
      { data: patch },
      {
        onSuccess: (u) => {
          updateSessionUser({ discoverableByPhone: u.discoverableByPhone, profileVisibility: u.profileVisibility });
          toast({ description: "Settings saved", duration: 1500 });
        },
        onError: () => toast({ description: "Could not save", variant: "destructive" }),
      }
    );
  }

  if (!session) return null;
  return (
    <section className="bg-card border border-card-border rounded-2xl px-6 py-6">
      <h2 className="font-serif text-lg font-semibold text-card-foreground">Privacy</h2>
      <p className="font-sans text-xs text-muted-foreground mt-1 mb-4">
        Both default to safe values. Flip them deliberately if you want broader reach.
      </p>
      <div className="space-y-4">
        <ToggleRow
          label="Public profile"
          description="Off hides you from search and the All feed. People who already follow you keep access."
          checked={profileVisibility === "public"}
          onChange={(v) => { const next = v ? "public" : "private"; setProfileVisibility(next); persist({ profileVisibility: next }); }}
        />
        <ToggleRow
          label="Discoverable by phone"
          description="Off (default) blocks reverse phone lookup. On lets people who know your phone number find your profile."
          checked={discoverable}
          onChange={(v) => { setDiscoverable(v); persist({ discoverableByPhone: v }); }}
        />
      </div>
    </section>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-sans text-sm font-semibold text-card-foreground">{label}</div>
        <div className="font-sans text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 rounded-full shrink-0 transition-colors"
        style={{ background: checked ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
      >
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: checked ? "1.5rem" : "0.125rem" }} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render `<SettingsSection />` in the main block**

In `ProfileContent`, find the `<main>` section's space and add `<SettingsSection />` after `<StatsSection />`.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/profile.tsx
git commit -m "feat(client): profile privacy settings (visibility + phone discoverability)"
```

---

### Task 37: Add round-page additions (visibility, mark-complete, social strip, linkable names)

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`
- Create: `artifacts/golf-scorecard/src/components/round-social-strip.tsx`

- [ ] **Step 1: Implement the social strip**

Create [artifacts/golf-scorecard/src/components/round-social-strip.tsx](../../../artifacts/golf-scorecard/src/components/round-social-strip.tsx):

```tsx
import { useState } from "react";
import {
  useGetRoundSocial,
  useGiveKudos,
  useRevokeKudos,
  useCreateRoundComment,
  useDeleteRoundComment,
  getGetRoundSocialQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Heart, Trash2 } from "lucide-react";
import { useAuthSession } from "@/lib/auth";

export function RoundSocialStrip({ roundId }: { roundId: number }) {
  const session = useAuthSession();
  const qc = useQueryClient();
  const { data } = useGetRoundSocial(roundId);
  const give = useGiveKudos();
  const revoke = useRevokeKudos();
  const createComment = useCreateRoundComment();
  const deleteComment = useDeleteRoundComment();
  const [text, setText] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetRoundSocialQueryKey(roundId) });
  }
  function toggleKudos() {
    const mutate = data?.kudos.viewerHasKudosed ? revoke.mutate : give.mutate;
    mutate({ roundId }, { onSettled: invalidate });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    createComment.mutate(
      { roundId, data: { body: text.trim() } },
      { onSuccess: () => { setText(""); invalidate(); } }
    );
  }

  if (!data) return null;
  return (
    <section className="rounded-2xl bg-card border border-card-border px-5 py-4">
      <div className="flex items-center gap-4 mb-3">
        <button
          type="button"
          onClick={toggleKudos}
          className="flex items-center gap-1 text-sm font-sans"
          style={{ color: data.kudos.viewerHasKudosed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
        >
          <Heart size={16} fill={data.kudos.viewerHasKudosed ? "currentColor" : "none"} />
          <span className="tabular-nums">{data.kudos.count}</span>
        </button>
        <div className="flex gap-1 text-xs font-sans text-muted-foreground">
          {data.kudos.recentUsers.slice(0, 3).map(u => (
            <Link key={u.id} href={`/users/${u.id}`} className="hover:underline">{u.fullName}</Link>
          ))}
          {data.kudos.count > 3 && <span>+{data.kudos.count - 3} more</span>}
        </div>
      </div>

      <ul className="space-y-2 mb-3">
        {data.comments.items.map(c => (
          <li key={c.id} className="flex items-start gap-2">
            <Link href={`/users/${c.userId}`} className="font-sans text-sm font-semibold text-card-foreground hover:underline shrink-0">
              {c.userFullName}
            </Link>
            <p className="font-sans text-sm text-card-foreground flex-1">{c.body}</p>
            {session?.user.id === c.userId && (
              <button
                type="button"
                onClick={() => deleteComment.mutate({ commentId: c.id }, { onSettled: invalidate })}
                aria-label="Delete comment"
                className="text-muted-foreground"
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
        {data.comments.items.length === 0 && (
          <li className="text-xs font-sans text-muted-foreground italic">Be the first to leave a comment.</li>
        )}
      </ul>

      {session && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a comment…"
            maxLength={1000}
            className="flex-1 px-3 py-2 rounded-lg bg-popover text-card-foreground text-sm font-sans"
            style={{ border: "1.5px solid hsl(var(--input))" }}
          />
          <button
            type="submit"
            disabled={!text.trim() || createComment.isPending}
            className="px-4 rounded-lg bg-primary text-primary-foreground text-sm font-sans font-semibold disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire visibility + mark-complete into round.tsx**

The round page is large (87 KB). Don't rewrite — make targeted edits:

1. **Add the social strip:** Below the leaderboard render, insert `<RoundSocialStrip roundId={roundId} />`. Find the existing leaderboard rendering block in [artifacts/golf-scorecard/src/pages/round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) (search for "leaderboard" or the Leaderboard component) and add the strip immediately after.

2. **Visibility toggle in settings drawer:** Find the round settings drawer (search for the existing settings UI — likely a Sheet/Dialog that mutates the round via `useUpdateRound`). Add a labeled switch:

```tsx
<div className="flex items-start justify-between gap-3 mb-4">
  <div>
    <div className="font-sans text-sm font-semibold text-card-foreground">Public</div>
    <div className="font-sans text-xs text-muted-foreground mt-0.5">Shows in the feed and on co-players' profiles.</div>
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={round.visibility === "public"}
    onClick={() => updateRound.mutate({ tripId, roundId: round.id, data: { visibility: round.visibility === "public" ? "private" : "public" } })}
    className="relative h-6 w-11 rounded-full"
    style={{ background: round.visibility === "public" ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
  >
    <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: round.visibility === "public" ? "1.5rem" : "0.125rem" }} />
  </button>
</div>
```

3. **Mark-complete button:** Inside the same settings drawer or in a primary action zone, add:

```tsx
{round.completedAt == null && holesScoredAcrossField >= 9 && (
  <button
    type="button"
    onClick={() => updateRound.mutate({ tripId, roundId: round.id, data: { completedAt: new Date().toISOString() } })}
    className="w-full mt-3 py-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm"
  >
    Mark round complete
  </button>
)}
```

Replace `holesScoredAcrossField` with whatever the round page already computes (look for an existing `holesPlayed` or `progress` value in the page state — there's a leaderboard summary in the page already). If no such value exists, compute `const holesScoredAcrossField = Math.max(...players.map(p => p.holesPlayed));` from existing player stats.

4. **Linkable player names:** Find the cells that render each player's name in the scorecard grid and in the leaderboard list. Wrap them in a Wouter `<Link>` when `player.userId != null`:

```tsx
{player.userId != null ? (
  <Link href={`/users/${player.userId}`} className="hover:underline">{player.name}</Link>
) : (
  player.name
)}
```

Search for `player.name` or `playerName` in round.tsx and apply this pattern at each render site.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/golf-scorecard run typecheck
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/components/round-social-strip.tsx artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "feat(client): visibility toggle, mark-complete, social strip, linkable player names"
```

---

### Task 38: Hide personal trips from /me/trips

**Files:**
- Modify: `artifacts/api-server/src/routes/users-me.ts`

- [ ] **Step 1: Filter personal trips from listMyTrips**

In [artifacts/api-server/src/routes/users-me.ts](../../../artifacts/api-server/src/routes/users-me.ts), in the `GET /users/me/trips` handler, add a filter after both `viaPlayers` and `viaSaved` are loaded:

After the existing accumulation into `byTripId`, filter:

```ts
// Hide personal (solo-round) trips — they live in the feed instead of My Trips.
for (const [id, e] of byTripId) {
  if (e.trip.kind === "personal") byTripId.delete(id);
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/users-me.ts
git commit -m "feat(server): exclude personal trips from My Trips"
```

---

### Task 39: Ensure the new endpoints' query keys are exported and import sites resolve

**Files:**
- Touch: none directly — confirm Orval has emitted the expected helpers and fix any miss-named imports.

- [ ] **Step 1: Verify expected hook exports exist**

```bash
grep -l "useGetFeed\|useListMyBuddies\|useGetUserProfile\|useGiveKudos\|useRevokeKudos\|useCreateRoundComment\|useDeleteRoundComment\|useGetRoundSocial\|useSearchUsers\|useFollowUser\|useUnfollowUser\|useCreateSoloRound" lib/api-client-react/src/generated/
```

Expected: all of these resolve in the generated index. If a hook is missing, re-check the OpenAPI operationId — Orval's hook name derives from it (`getFeed` → `useGetFeed`).

- [ ] **Step 2: Typecheck the client**

```bash
pnpm --filter @workspace/golf-scorecard run typecheck
```

Expected: passes. If imports are off, adjust to match generated names.

- [ ] **Step 3: No commit yet — only fixups if needed. If you made any changes, commit them.**

```bash
git add artifacts/golf-scorecard/src
git commit -m "fix(client): align hook imports with regenerated client" --allow-empty
```

(`--allow-empty` is fine here — no harm if nothing changed.)

---

## Stage 7 — Verification

### Task 40: Run all automated checks

**Files:**
- Touch: none

- [ ] **Step 1: Workspace typecheck**

```bash
pnpm run typecheck
```

Expected: passes across all packages.

- [ ] **Step 2: Workspace build**

```bash
pnpm run build
```

Expected: passes — both api-server bundle and golf-scorecard Vite build succeed.

- [ ] **Step 3: Scoring tests**

```bash
pnpm --filter @workspace/api-server run test
```

Expected: all tests pass.

- [ ] **Step 4: Boot servers and smoke-load the new routes**

In separate terminals:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/golf-scorecard run dev
```

Then `curl` a guarded route to confirm the server wiring (replace `$TOKEN` with a valid JWT from a signed-in user — pick one from a browser localStorage `auth:session`):

```bash
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:$PORT/api/feed?tab=all | jq '.items[0] // {empty:true}'
```

Expected: a feed item shape OR `{empty:true}` if there are no public rounds yet — but NOT a 401, 404, or 500.

---

### Task 41: Manual end-to-end verification (per spec)

**Files:**
- Touch: none

Walk through every line of the **Verification** section of the spec. For each, mark the checkbox and note pass/fail.

- [ ] User A and User B play a round together via the existing trip flow → both appear in each other's Buddies tab on the Feed.
- [ ] User A logs a solo round via the floating "+" → appears in personal trip only, NOT in `/me/trips`. The new feed card shows up under All for everyone, and under Buddies for anyone A has played with.
- [ ] User A flips a round to private (via round settings drawer) → User B no longer sees it on All; still sees it inside the trip page itself.
- [ ] User C (stranger) searches "Kevin" via the nav search → finds User A → clicks Follow → next round A plays appears in C's Following tab.
- [ ] User A starts a round and scores 12 holes → C sees the live card with "PLAYING NOW · 12/18", auto-refetching every 30s. Tapping it routes to a read-only scorecard (no edit handlers exposed).
- [ ] User A's `/users/:id` profile, viewed by C, shows lifetime stats and recent rounds, with the private-flipped round absent.
- [ ] User A toggles `profileVisibility=private` in /profile settings → C's search no longer finds A; following remains in place.
- [ ] User A toggles `discoverableByPhone=on` then off → phone-format search query for A's number returns/excludes accordingly.
- [ ] Personal trip URL: as User A, `/trips/$personalTripId` loads. As User B, it returns 404.

Record any failures and fix before continuing.

- [ ] **Final commit**

If any documentation needs updating (CLAUDE.md, replit.md) — touch it now. Then:

```bash
git add -A
git status
git commit -m "chore: social feed phase 1 verification complete" --allow-empty
```

---

## Open items the plan deliberately leaves for execution-time judgement

- **bestNet / avgNetLast10 in user profile stats** — Task 20 currently returns `null` for these. The execution-time engineer should either (a) leave nulls and let the UI show "—" or (b) compute them by iterating `scores` rows for the user's player ids and running `computePlayerStats` per round. Either is acceptable for Phase 1 since the spec lists this as "Recent rounds" with stats as a strip, not a primary surface.
- **Course picker integration in solo-round modal** — Task 34 implements a free-text course field. The spec mentions pulling from the existing `/api/course-lookup` proxy as a typeahead. If time allows, swap the input for a typeahead using the existing `useLookupCourse*` hooks; otherwise free-text is acceptable for Phase 1 and matches `Round.course` being a free-text field today.
- **30s refetch scoped to in-viewport in-progress cards** — Task 33 currently sets `refetchInterval` on the whole infinite query. The spec suggests scoping via IntersectionObserver. Execution-time can land that optimization or leave the simpler whole-feed refetch until it becomes a perf issue.

These are not gaps — they're explicitly called out as polish that can happen at execution time without changing the contract.
