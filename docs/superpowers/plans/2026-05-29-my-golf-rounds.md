# My Golf — Round-First Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a round the primary unit in the UX and schema, replace `My Trips` nav with `My Golf` (Rounds + Trips sub-tabs), retire the `kind='personal'` hidden trip concept.

**Architecture:** Two-phase Drizzle `db push` with a data-migration script in between (rounds and players become nullable on `tripId`; personal-trip rows get rewritten and deleted). One unified `POST /rounds` replaces the trip-scoped and solo-only creation paths. The frontend gets one new page (`/my-golf`) with two sub-tabs and a new round-detail route (`/rounds/:roundId`) for trip-less rounds.

**Tech Stack:** Drizzle ORM → Postgres; Express 5 + Pino; OpenAPI YAML → Orval-generated React Query hooks + Zod v4 validators; React 19 + Vite + Wouter + TanStack Query + Tailwind 4 + shadcn/ui. Workspace uses pnpm; never use npm/yarn (preinstall hook blocks them).

**Reference spec:** [docs/superpowers/specs/2026-05-29-my-golf-rounds-design.md](../specs/2026-05-29-my-golf-rounds-design.md).

**Test posture:** This codebase has one existing unit-test file ([artifacts/api-server/src/lib/scoring.test.ts](../../artifacts/api-server/src/lib/scoring.test.ts)) using `node:test` + `node:assert/strict`. There is no HTTP-route or React-component test harness. The migration script gets a unit test (because Postgres-against-snapshot is the only way to verify it safely). Routes and frontend get **manual smoke checks** documented per task, run via the local dev servers (`pnpm run dev`).

---

## File Structure

**New files:**
- `scripts/migrate-retire-personal-trips.ts` — one-shot data migration.
- `scripts/migrate-retire-personal-trips.test.ts` — unit test for the migration logic (helper functions only, no live DB).
- `artifacts/api-server/src/routes/rounds-me.ts` — new server routes: `POST /rounds`, `GET /rounds/:roundId`, `PATCH /rounds/:roundId`, `DELETE /rounds/:roundId`, `GET /users/me/rounds`.
- `artifacts/golf-scorecard/src/pages/my-golf.tsx` — new top-level page with sub-tab routing.
- `artifacts/golf-scorecard/src/components/my-rounds-list.tsx` — rounds list with month grouping, filter chips, in-progress badges.
- `artifacts/golf-scorecard/src/components/my-trips-list.tsx` — extracted from today's `my-trips.tsx` (Created/Joined/Watching buckets, delete button).
- `artifacts/golf-scorecard/src/components/trip-picker.tsx` — small dropdown used inside the log-round modal.

**Modified files:**
- `lib/db/src/schema/rounds.ts` — drop `notNull` on `tripId` (phase 1).
- `lib/db/src/schema/players.ts` — drop `notNull` on `tripId`; add `players_solo_per_user` partial unique index (phase 1).
- `lib/db/src/schema/trips.ts` — drop `kind` column and `trips_personal_per_user` partial unique index (phase 2, after migration).
- `lib/api-spec/openapi.yaml` — add new endpoints/schemas; remove `createSoloRound` op and its schemas (phase 2).
- `artifacts/api-server/src/routes/index.ts` — register the new `rounds-me` router; unregister `solo-round` router after deletion.
- `artifacts/api-server/src/routes/feed.ts` — update join to be left join (trip optional); add `tripId: null` handling.
- `artifacts/api-server/src/routes/users-me.ts` — remove the "hide personal trips" filter at lines 54-57.
- `artifacts/api-server/src/routes/trips.ts` — remove the `kind === 'personal'` branches at lines 22-25, 58-67.
- `artifacts/golf-scorecard/src/App.tsx` — add `/my-golf` and `/rounds/:roundId` routes; redirect `/me/trips`; swap NavBar link from "My Trips" to "My Golf".
- `artifacts/golf-scorecard/src/components/solo-round-modal.tsx` — add optional Trip dropdown; switch from `useCreateSoloRound` to `useCreateRound2` (or whatever orval names the new unified endpoint hook).
- `artifacts/golf-scorecard/src/components/feed-card.tsx` — switch the `onClick` navigate to `/rounds/:id` when `tripId` is null.
- `artifacts/golf-scorecard/src/pages/round.tsx` — adapt to optional trip context (hide group-assignment UI and trip-leaderboard back-link when `round.tripId` is null).
- `artifacts/golf-scorecard/src/pages/my-trips.tsx` — replaced by the redirect to `/my-golf?tab=trips`; the bucketing logic moves into `my-trips-list.tsx`.

**Deleted files:**
- `artifacts/api-server/src/routes/solo-round.ts` — replaced by `rounds-me.ts`.

---

## Phase 1 — Drizzle schema phase 1 + DB push

### Task 1: Make `rounds.tripId` nullable in the Drizzle schema

**Files:**
- Modify: `lib/db/src/schema/rounds.ts`

- [ ] **Step 1: Edit `lib/db/src/schema/rounds.ts`**

Find the `tripId` column definition (line 9):

```ts
tripId: integer("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
```

Replace with:

```ts
tripId: integer("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm --filter @workspace/db run typecheck`
Expected: passes with no errors. (Type of `Round.tripId` becomes `number | null`.)

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/rounds.ts
git commit -m "Make rounds.tripId nullable for trip-less rounds"
```

### Task 2: Make `players.tripId` nullable and add `players_solo_per_user` partial unique index

**Files:**
- Modify: `lib/db/src/schema/players.ts`

- [ ] **Step 1: Edit `lib/db/src/schema/players.ts`**

Replace the entire file contents with:

```ts
import { pgTable, text, serial, integer, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tripsTable } from "./trips";
import { usersTable } from "./users";

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  tripId: integer("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  handicap: real("handicap").notNull().default(18),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // At most one solo-player row per user (rows where tripId IS NULL).
  uniqueIndex("players_solo_per_user").on(t.userId).where(sql`${t.tripId} IS NULL`),
]);

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
```

The changes: `tripId` no longer `.notNull()`, the file now imports `sql` and `uniqueIndex`, and the table builder gets a partial unique index argument.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/db run typecheck`
Expected: passes. `Player.tripId` is now `number | null`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/players.ts
git commit -m "Make players.tripId nullable with partial unique index per user"
```

### Task 3: Push phase-1 schema to the local DB

**Files:** None modified — this is a runtime operation.

- [ ] **Step 1: Confirm `DATABASE_URL` is set**

Run: `echo $DATABASE_URL || cat .env | grep DATABASE_URL`
Expected: a Postgres connection string. If missing, source `.env` first: `set -a; source .env; set +a`.

- [ ] **Step 2: Push the schema**

Run: `pnpm --filter @workspace/db run push`
Expected: Drizzle reports the column nullability change on `rounds.trip_id` and `players.trip_id`, plus creation of the `players_solo_per_user` index. Accept the changes when prompted (or use `pnpm --filter @workspace/db run push-force` if Drizzle reports unrecoverable changes you've verified are safe — none expected here).

- [ ] **Step 3: Verify in psql (optional)**

Run:
```bash
psql "$DATABASE_URL" -c "\d rounds" | grep trip_id
psql "$DATABASE_URL" -c "\d players" | grep trip_id
psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE indexname = 'players_solo_per_user'"
```
Expected: `trip_id` columns no longer show `not null`. The partial unique index exists with `WHERE (trip_id IS NULL)`.

No commit — schema files were committed in tasks 1 and 2.

---

## Phase 2 — OpenAPI changes + codegen

### Task 4: Add `POST /rounds` to the OpenAPI spec

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Insert the new path block before `/trips/{tripId}/rounds`**

Find the line `  /trips/{tripId}/rounds:` (around line 824). Immediately above it, insert:

```yaml
  /rounds:
    post:
      operationId: createRoundV2
      tags: [rounds]
      summary: Create a round, optionally attached to a trip
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateRoundV2Body"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateRoundV2Response"
        "401":
          description: Unauthorized
        "403":
          description: Caller is not a player or follower of the requested trip

```

Note: `createRoundV2` operationId is chosen to avoid collision with the existing trip-scoped `createRound`. (The trip-scoped one stays for the trip-hub's "Add round" button.)

- [ ] **Step 2: Add `CreateRoundV2Body` and `CreateRoundV2Response` schemas**

Find the line `    CreateRoundBody:` (around line 1999). Immediately above it, insert:

```yaml
    CreateRoundV2Body:
      type: object
      properties:
        tripId:
          type: ["integer", "null"]
          description: Optional trip to attach this round to. Caller must be a player or follower of that trip.
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

    CreateRoundV2Response:
      type: object
      properties:
        tripId:
          type: ["integer", "null"]
        roundId:
          type: integer
        playerId:
          type: integer
      required: [roundId, playerId]

```

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "Add POST /rounds OpenAPI definition for unified round creation"
```

### Task 5: Add `GET /rounds/:roundId`, `PATCH /rounds/:roundId`, `DELETE /rounds/:roundId`

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Append solo round detail paths inside the `/rounds:` block**

Find the `/rounds:` block from Task 4. Replace it with the extended version (this adds three new top-level paths under `/rounds/{roundId}`):

```yaml
  /rounds:
    post:
      operationId: createRoundV2
      tags: [rounds]
      summary: Create a round, optionally attached to a trip
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateRoundV2Body"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateRoundV2Response"
        "401":
          description: Unauthorized
        "403":
          description: Caller is not a player or follower of the requested trip

  /rounds/{roundId}:
    get:
      operationId: getSoloRound
      tags: [rounds]
      summary: Get a round by id (works for both solo and trip rounds)
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Round
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Round"
        "404":
          description: Not found or not visible
    patch:
      operationId: updateSoloRound
      tags: [rounds]
      summary: Update a solo round (trip-attached rounds use the trip-scoped endpoint)
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
              $ref: "#/components/schemas/UpdateRoundBody"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Round"
        "403":
          description: Caller does not own this round
        "404":
          description: Round not found
    delete:
      operationId: deleteSoloRound
      tags: [rounds]
      summary: Delete a solo round
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
          description: Deleted
        "403":
          description: Caller does not own this round
        "404":
          description: Round not found

```

- [ ] **Step 2: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "Add solo round detail endpoints to OpenAPI"
```

### Task 6: Add `GET /users/me/rounds`

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Insert before `/users/me/personal-trip/rounds` (which we delete later)**

Find the line `  /users/me/personal-trip/rounds:` (around line 306). Immediately above it, insert:

```yaml
  /users/me/rounds:
    get:
      operationId: listMyRounds
      tags: [users]
      summary: All rounds where the caller has a player row, joined to optional trip
      security:
        - bearerAuth: []
      parameters:
        - name: filter
          in: query
          required: false
          schema:
            type: string
            enum: [all, solo, trip]
            default: all
      responses:
        "200":
          description: Rounds
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/MyRoundsItem"
        "401":
          description: Unauthorized

```

- [ ] **Step 2: Add `MyRoundsItem` schema**

Find `    CreateRoundV2Body:` (added in Task 4). Immediately above it, insert:

```yaml
    MyRoundsItem:
      type: object
      properties:
        round:
          $ref: "#/components/schemas/Round"
        trip:
          oneOf:
            - $ref: "#/components/schemas/Trip"
            - type: "null"
        gross:
          type: ["integer", "null"]
          description: Caller's gross total if the round is complete, else null.
        net:
          type: ["number", "null"]
          description: Caller's net total relative to par if the round is complete, else null.
        holesPlayed:
          type: integer
          description: Number of holes the caller has a score for.
      required: [round, holesPlayed]

```

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "Add GET /users/me/rounds OpenAPI definition for the rounds list"
```

### Task 7: Run codegen + typecheck

**Files:** None edited — codegen regenerates `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

- [ ] **Step 1: Regenerate client + validators**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: Orval prints "Generated successfully" messages for both `react-client` and `zod`. The script ends with `pnpm --filter ... typecheck` already chained — if anything regresses, it'll surface here.

- [ ] **Step 2: Inspect the generated hooks**

Run: `grep -E "useCreateRoundV2|useListMyRounds|useGetSoloRound|useUpdateSoloRound|useDeleteSoloRound" lib/api-client-react/src/generated -r | head -10`
Expected: each hook name appears at least once.

- [ ] **Step 3: Verify the Zod validators**

Run: `grep -E "CreateRoundV2Body|MyRoundsItem|ListMyRoundsParams" lib/api-zod/src/generated -r | head -10`
Expected: each schema name appears.

- [ ] **Step 4: Top-level typecheck**

Run: `pnpm run typecheck`
Expected: passes (nothing consumes these yet, so it should be green). If anything breaks, stop and fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "Regenerate api-client-react and api-zod from updated OpenAPI"
```

---

## Phase 3 — Server endpoints

### Task 8: Create the `rounds-me.ts` router scaffold and register it

**Files:**
- Create: `artifacts/api-server/src/routes/rounds-me.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create the scaffold**

Write to `artifacts/api-server/src/routes/rounds-me.ts`:

```ts
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  roundsTable,
  playersTable,
  tripsTable,
  scoresTable,
  userTripFollowsTable,
  usersTable,
} from "@workspace/db";
import { ser } from "../lib/serialize";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { verifySession } from "../lib/jwt";

const DEFAULT_PAR = Array(18).fill(4);
const DEFAULT_HCP = Array.from({ length: 18 }, (_, i) => i + 1);

const router: IRouter = Router();

export default router;
```

- [ ] **Step 2: Register the router in `routes/index.ts`**

Edit `artifacts/api-server/src/routes/index.ts`. Add the import alongside the others:

```ts
import roundsMeRouter from "./rounds-me";
```

And mount it after `roundsRouter`:

```ts
router.use(roundsMeRouter);
```

(Order doesn't matter functionally — Express matches the first route that matches — but keep related routers grouped.)

- [ ] **Step 3: Build + typecheck the api server**

Run: `pnpm --filter @workspace/api-server run build`
Expected: passes. (The build uses esbuild + a typecheck step.)

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/rounds-me.ts artifacts/api-server/src/routes/index.ts
git commit -m "Scaffold rounds-me router and register it"
```

### Task 9: Implement `POST /rounds`

**Files:**
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Add the handler**

In `rounds-me.ts`, before the `export default router;` line, insert:

```ts
import { CreateRoundV2Body } from "@workspace/api-zod";

router.post("/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const parsed = CreateRoundV2Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const tripId = body.tripId ?? null;

  // Trip-attached round: caller must be a player OR a follower OR the trip creator.
  if (tripId !== null) {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
    if (!trip) { res.status(403).json({ error: "Not a member of this trip" }); return; }
    const [playerRow] = await db
      .select()
      .from(playersTable)
      .where(and(eq(playersTable.tripId, tripId), eq(playersTable.userId, userId)))
      .limit(1);
    const isCreator = trip.createdByUserId === userId;
    let allowed = !!playerRow || isCreator;
    if (!allowed) {
      const [followRow] = await db
        .select()
        .from(userTripFollowsTable)
        .where(and(eq(userTripFollowsTable.tripId, tripId), eq(userTripFollowsTable.userId, userId)))
        .limit(1);
      allowed = !!followRow;
    }
    if (!allowed) { res.status(403).json({ error: "Not a member of this trip" }); return; }
  }

  // Insert the round (tripId may be null for solo).
  const [round] = await db.insert(roundsTable).values({
    tripId,
    createdByUserId: userId,
    name: body.name,
    course: body.course ?? null,
    date: body.date ?? null,
    par: (body.par as number[] | undefined) ?? DEFAULT_PAR,
    holeHcp: (body.holeHcp as number[] | undefined) ?? DEFAULT_HCP,
    teeBox: body.teeBox ?? null,
    courseRating: body.courseRating ?? null,
    courseSlope: body.courseSlope ?? null,
  }).returning();

  // Find-or-create the caller's player row in the right scope.
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!me) { res.status(500).json({ error: "User not found" }); return; }

  const playerWhere = tripId === null
    ? and(isNull(playersTable.tripId), eq(playersTable.userId, userId))
    : and(eq(playersTable.tripId, tripId), eq(playersTable.userId, userId));

  const [existingPlayer] = await db.select().from(playersTable).where(playerWhere).limit(1);
  let player = existingPlayer;
  if (!player) {
    [player] = await db.insert(playersTable).values({
      tripId,
      userId,
      name: me.fullName,
      handicap: me.handicap ?? 18,
    }).returning();
  }

  res.status(201).json({ tripId, roundId: round.id, playerId: player.id });
});
```

- [ ] **Step 2: Build the api server**

Run: `pnpm --filter @workspace/api-server run build`
Expected: passes.

- [ ] **Step 3: Manual smoke check**

Start the dev server: `pnpm run dev` (if not already running). In another terminal, with a valid bearer token (grab it from `localStorage.getItem('auth:session')` in the running app):

```bash
TOKEN="<paste the JWT from the running app>"
# Solo round
curl -s -X POST http://localhost:${API_PORT:-3000}/api/rounds \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke test solo"}' | jq
# Expect: {"tripId":null,"roundId":<n>,"playerId":<m>}
```

Expected: returns 201 with `tripId: null`. In psql: `SELECT * FROM rounds WHERE name='Smoke test solo';` shows `trip_id` null. Clean up: `DELETE FROM rounds WHERE name='Smoke test solo';`.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/rounds-me.ts
git commit -m "Implement POST /rounds with optional trip attachment"
```

### Task 10: Implement `GET /rounds/:roundId`

**Files:**
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Add the handler**

In `rounds-me.ts`, before `export default router;`, insert:

```ts
router.get("/rounds/:roundId", async (req, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId)).limit(1);
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }

  // Visibility rules:
  // - Trip rounds: defer to the existing /trips/:tripId/rounds/:roundId logic;
  //   here we mirror it (private rounds only visible to players in the same trip).
  // - Solo rounds (tripId null): the creator always sees it; everyone else
  //   needs the round to be public AND completed.
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const payload = token ? verifySession(token) : null;

  if (round.tripId === null) {
    const isCreator = !!payload && payload.userId === round.createdByUserId;
    if (!isCreator) {
      if (round.visibility !== "public" || !round.completedAt) {
        res.status(404).json({ error: "Round not found" });
        return;
      }
    }
  } else if (round.visibility === "private") {
    if (!payload) { res.status(404).json({ error: "Round not found" }); return; }
    const [callerPlayer] = await db.select().from(playersTable)
      .where(and(eq(playersTable.tripId, round.tripId), eq(playersTable.userId, payload.userId)))
      .limit(1);
    if (!callerPlayer) { res.status(404).json({ error: "Round not found" }); return; }
  }

  res.json(ser(round));
});
```

- [ ] **Step 2: Build + smoke**

Run: `pnpm --filter @workspace/api-server run build`
Then with the dev server up, hit it:

```bash
# Replace ROUND_ID with a real id from your DB
curl -s http://localhost:${API_PORT:-3000}/api/rounds/<ROUND_ID> | jq
```

Expected: returns the round JSON if visible, else `{"error":"Round not found"}` with 404.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/rounds-me.ts
git commit -m "Implement GET /rounds/:roundId (solo + trip read with visibility rules)"
```

### Task 11: Implement `PATCH /rounds/:roundId` (solo rounds only)

**Files:**
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Add the handler**

In `rounds-me.ts`, before `export default router;`, insert:

```ts
import { UpdateRoundBody } from "@workspace/api-zod";

router.patch("/rounds/:roundId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  const parsed = UpdateRoundBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId)).limit(1);
  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.tripId !== null) {
    // Use the trip-scoped endpoint for trip rounds.
    res.status(404).json({ error: "Round not found" });
    return;
  }
  if (round.createdByUserId !== userId) {
    res.status(403).json({ error: "Only the round creator can update this round" });
    return;
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.course !== undefined) updateData.course = data.course;
  if (data.date !== undefined) updateData.date = data.date;
  if (data.par !== undefined) updateData.par = data.par;
  if (data.holeHcp !== undefined) updateData.holeHcp = data.holeHcp;
  if (data.gamesConfig !== undefined) updateData.gamesConfig = data.gamesConfig;
  if (data.handicapMode !== undefined) updateData.handicapMode = data.handicapMode;
  if (data.teeBox !== undefined) updateData.teeBox = data.teeBox;
  if (data.courseRating !== undefined) updateData.courseRating = data.courseRating;
  if (data.courseSlope !== undefined) updateData.courseSlope = data.courseSlope;
  if (data.visibility !== undefined) updateData.visibility = data.visibility;
  if (data.completedAt !== undefined) {
    updateData.completedAt = data.completedAt == null ? null : new Date(data.completedAt);
  }

  const [updated] = await db.update(roundsTable).set(updateData).where(eq(roundsTable.id, roundId)).returning();
  res.json(ser(updated));
});
```

- [ ] **Step 2: Build + smoke**

```bash
pnpm --filter @workspace/api-server run build
# With a token + a roundId you own:
curl -s -X PATCH http://localhost:${API_PORT:-3000}/api/rounds/<ROUND_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Renamed via PATCH"}' | jq
```

Expected: 200 with the updated round; the `name` field reflects the change.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/rounds-me.ts
git commit -m "Implement PATCH /rounds/:roundId for solo rounds"
```

### Task 12: Implement `DELETE /rounds/:roundId` (solo rounds only)

**Files:**
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Add the handler**

In `rounds-me.ts`, before `export default router;`, insert:

```ts
router.delete("/rounds/:roundId", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }

  const [round] = await db.select({
    id: roundsTable.id,
    tripId: roundsTable.tripId,
    createdByUserId: roundsTable.createdByUserId,
  }).from(roundsTable).where(eq(roundsTable.id, roundId)).limit(1);

  if (!round) { res.status(404).json({ error: "Round not found" }); return; }
  if (round.tripId !== null) {
    // Trip rounds delete via /trips/:tripId/rounds/:roundId.
    res.status(404).json({ error: "Round not found" });
    return;
  }
  if (round.createdByUserId !== userId) {
    res.status(403).json({ error: "Only the round creator can delete this round" });
    return;
  }

  await db.delete(roundsTable).where(eq(roundsTable.id, roundId));
  res.sendStatus(204);
});
```

- [ ] **Step 2: Build + smoke**

Already verified the path exists; manually test by creating a solo round (Task 9 smoke) and deleting it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  http://localhost:${API_PORT:-3000}/api/rounds/<ROUND_ID> \
  -H "Authorization: Bearer $TOKEN"
# Expect: 204
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/rounds-me.ts
git commit -m "Implement DELETE /rounds/:roundId for solo rounds"
```

### Task 13: Implement `GET /users/me/rounds`

**Files:**
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Add the handler**

In `rounds-me.ts`, before `export default router;`, insert:

```ts
router.get("/users/me/rounds", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const userId = req.user!.id;
  const filter = req.query["filter"];
  const filterValue = filter === "solo" ? "solo" : filter === "trip" ? "trip" : "all";

  // Caller's player rows — across all trips and the solo bucket (tripId null).
  const myPlayers = await db.select().from(playersTable).where(eq(playersTable.userId, userId));
  if (myPlayers.length === 0) { res.json([]); return; }
  const myPlayerIds = myPlayers.map(p => p.id);

  // Rounds the caller has a player row in (via scores). For a round with no scores yet,
  // the caller is included by being the creator.
  const myScoreRows = await db
    .select({ roundId: scoresTable.roundId, playerId: scoresTable.playerId, holeScores: scoresTable.holeScores })
    .from(scoresTable)
    .where(inArray(scoresTable.playerId, myPlayerIds));

  const scoredRoundIds = new Set(myScoreRows.map(r => r.roundId));
  const createdRows = await db
    .select({ id: roundsTable.id })
    .from(roundsTable)
    .where(eq(roundsTable.createdByUserId, userId));
  for (const r of createdRows) scoredRoundIds.add(r.id);

  if (scoredRoundIds.size === 0) { res.json([]); return; }

  const rounds = await db.select().from(roundsTable).where(inArray(roundsTable.id, Array.from(scoredRoundIds)));
  const filtered = rounds.filter(r => {
    if (filterValue === "solo") return r.tripId === null;
    if (filterValue === "trip") return r.tripId !== null;
    return true;
  });

  // Pull all trips referenced in one query.
  const tripIds = Array.from(new Set(filtered.map(r => r.tripId).filter((x): x is number => x !== null)));
  const trips = tripIds.length > 0
    ? await db.select().from(tripsTable).where(inArray(tripsTable.id, tripIds))
    : [];
  const tripById = new Map(trips.map(t => [t.id, t]));

  // Build a map of (roundId → caller's score row) so we can compute gross/net/holesPlayed.
  const scoreByRound = new Map<number, { holeScores: (number | null)[] }>();
  for (const row of myScoreRows) {
    const existing = scoreByRound.get(row.roundId);
    if (!existing) scoreByRound.set(row.roundId, { holeScores: row.holeScores });
  }

  const items = filtered
    .map(round => {
      const trip = round.tripId !== null ? tripById.get(round.tripId) ?? null : null;
      const score = scoreByRound.get(round.id);
      let gross: number | null = null;
      let net: number | null = null;
      let holesPlayed = 0;
      if (score) {
        let sum = 0;
        let played = 0;
        for (let h = 0; h < 18; h++) {
          const s = score.holeScores[h];
          if (s != null) { sum += s; played++; }
        }
        holesPlayed = played;
        if (played === 18) {
          gross = sum;
          const parTotal = round.par.reduce((a, b) => a + b, 0);
          net = sum - parTotal; // Simple gross-vs-par; net handicap math lives in scoring.ts
                                 // and the list view treats this as a rough delta.
        }
      }
      return { round: ser(round), trip: trip ? ser(trip) : null, gross, net, holesPlayed };
    })
    .sort((a, b) => {
      const aDate = a.round.date ?? a.round.createdAt;
      const bDate = b.round.date ?? b.round.createdAt;
      return String(bDate).localeCompare(String(aDate));
    });

  res.json(items);
});
```

Note: the gross/net math here is intentionally simple — the **full** handicap-adjusted scoring lives in `scoring.ts` and is run on the round detail/leaderboard pages. The list view only needs a rough at-a-glance number, so we compute gross + gross-vs-par. If you want full WHS net here later, swap in `computePlayerStats` from `scoring.ts`.

- [ ] **Step 2: Build + smoke**

```bash
pnpm --filter @workspace/api-server run build
curl -s "http://localhost:${API_PORT:-3000}/api/users/me/rounds" \
  -H "Authorization: Bearer $TOKEN" | jq 'length, .[0]'
curl -s "http://localhost:${API_PORT:-3000}/api/users/me/rounds?filter=solo" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
curl -s "http://localhost:${API_PORT:-3000}/api/users/me/rounds?filter=trip" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
```

Expected: `all` returns all rounds you have a player in; `solo` and `trip` partition them; counts add up.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/rounds-me.ts
git commit -m "Implement GET /users/me/rounds with all/solo/trip filter"
```

### Task 14: Update feed.ts join for nullable tripId

**Files:**
- Modify: `artifacts/api-server/src/routes/feed.ts`

- [ ] **Step 1: Read the current feed file end-to-end so you understand the joins**

Run: `cat artifacts/api-server/src/routes/feed.ts | head -200`

Look for any `INNER JOIN` or `.innerJoin(tripsTable, ...)` that joins rounds → trips. Each must become `.leftJoin(tripsTable, ...)`. Look for any `SELECT` that pulls trip name/id and used to assume non-null — those need to be nullable in the response shape.

- [ ] **Step 2: Change innerJoin to leftJoin where rounds joins trips**

If you find:
```ts
.innerJoin(tripsTable, eq(tripsTable.id, roundsTable.tripId))
```
Change to:
```ts
.leftJoin(tripsTable, eq(tripsTable.id, roundsTable.tripId))
```

If the SELECT pulls `tripName: tripsTable.name`, it now yields `string | null`. The `FeedItem` schema in `openapi.yaml` already has `tripId` (let me verify — if not, this is a follow-up). For now, just allow null in the response: pass `tripName ?? null` and `tripId ?? null` to the client.

- [ ] **Step 3: Build the api server**

Run: `pnpm --filter @workspace/api-server run build`
Expected: passes. If TS complains about the leftJoin nullability, follow the error and add `?? null` projections.

- [ ] **Step 4: Smoke test**

```bash
curl -s "http://localhost:${API_PORT:-3000}/api/feed?tab=all&limit=5" | jq '.items[0]'
```
Expected: still returns feed items; for solo rounds (after migration in Phase 7), `tripId` will be null but the item is still returned. (Pre-migration, the feed contains personal-trip rounds with their personal-trip tripId — that's fine; the change is only that the join is now tolerant of null.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/feed.ts
git commit -m "Use leftJoin for rounds→trips in feed query (tripId is nullable)"
```

---

## Phase 4 — Frontend route + nav scaffold

### Task 15: Extract `MyTripsList` from `my-trips.tsx`

**Files:**
- Create: `artifacts/golf-scorecard/src/components/my-trips-list.tsx`

- [ ] **Step 1: Move the trip-list rendering into its own component**

Create `artifacts/golf-scorecard/src/components/my-trips-list.tsx` with the following content. This lifts the Created/Joined/Watching bucketing, the `TripRow`, the `DeleteTripButton`, and the date-formatting helpers from `my-trips.tsx`:

```tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyTrips,
  useDeleteTrip,
  getListMyTripsQueryKey,
  type UserTripAssociation,
} from "@workspace/api-client-react";
import type { AuthSession } from "@/lib/auth";
import { Flag, ChevronRight, Plus, Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const BRASS = "hsl(42 52% 59%)";
const BRASS_MUTED = "hsl(42 35% 70%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const CREAM = "hsl(42 45% 91%)";
const CREAM_BORDER = "hsl(38 25% 78%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const FOREST_HAIRLINE = "hsl(158 30% 28%)";
const DANGER = "hsl(2 62% 44%)";

export function MyTripsList({ session }: Readonly<{ session: AuthSession }>) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useListMyTrips();
  const deleteTrip = useDeleteTrip();

  function handleDeleteTrip(tripId: number) {
    deleteTrip.mutate(
      { tripId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() }) },
    );
  }

  const myUserId = session.user.id;
  const trips = items ?? [];
  const hasAny = trips.length > 0;

  const created: UserTripAssociation[] = [];
  const joined: UserTripAssociation[] = [];
  const watching: UserTripAssociation[] = [];
  for (const item of trips) {
    const isOwn = item.trip.createdByUserId === myUserId;
    const isPlayer = item.via === "player" || item.via === "both";
    if (isOwn) created.push(item);
    else if (isPlayer) joined.push(item);
    else watching.push(item);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
        ))}
      </div>
    );
  }
  if (!hasAny) {
    return (
      <div className="text-center py-16">
        <div
          className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center"
          style={{ background: FOREST_ACCENT, border: "1px solid hsl(42 60% 48%)" }}
        >
          <Flag size={22} style={{ color: BRASS }} strokeWidth={1.6} />
        </div>
        <p className="font-sans text-sm mb-6 max-w-xs mx-auto" style={{ color: BRASS_FAINT, lineHeight: 1.55 }}>
          You haven't joined or saved any trips yet. Start one and invite the group.
        </p>
        <button
          onClick={() => navigate("/trips/new")}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-sans font-semibold text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
          style={{
            background: BRASS,
            color: "hsl(38 30% 12%)",
            boxShadow: "0 1px 0 hsl(42 60% 48%) inset, 0 14px 30px -12px hsla(42, 60%, 50%, 0.55), 0 2px 0 hsla(0,0%,0%,0.18)",
            letterSpacing: "0.04em",
          }}
        >
          <Plus size={16} strokeWidth={2.25} />
          New Trip
        </button>
      </div>
    );
  }

  return (
    <div>
      {created.length > 0 && (
        <Section label="Created">
          {created.map(item => (
            <TripRow
              key={item.trip.id}
              item={item}
              variant="primary"
              onClick={() => navigate(`/trips/${item.trip.id}`)}
              onDelete={() => handleDeleteTrip(item.trip.id)}
              deletePending={deleteTrip.isPending && deleteTrip.variables?.tripId === item.trip.id}
            />
          ))}
        </Section>
      )}
      {joined.length > 0 && (
        <Section label="Joined">
          {joined.map(item => (
            <TripRow
              key={item.trip.id}
              item={item}
              variant="primary"
              onClick={() => navigate(`/trips/${item.trip.id}`)}
            />
          ))}
        </Section>
      )}
      {watching.length > 0 && (
        <Section label="Watching">
          {watching.map(item => (
            <TripRow
              key={item.trip.id}
              item={item}
              variant="watching"
              onClick={() => navigate(`/trips/${item.trip.id}`)}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="flex items-center gap-3 mb-3 px-1">
        <span className="text-[10px] font-sans font-bold uppercase" style={{ color: BRASS, letterSpacing: "0.32em" }}>
          {label}
        </span>
        <span className="flex-1 border-t border-dashed" style={{ borderColor: FOREST_HAIRLINE }} />
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function parseLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatTripDates(range: UserTripAssociation["dateRange"]): string | null {
  if (!range) return null;
  const start = parseLocalDate(range.start);
  const end = parseLocalDate(range.end);
  if (!start || !end) return null;
  const sameDay = range.start === range.end;
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const monthDayYear = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (sameDay) return monthDayYear(start);
  if (sameMonth) return `${monthDay(start)}–${end.getDate()}, ${end.getFullYear()}`;
  if (sameYear) return `${monthDay(start)} – ${monthDay(end)}, ${end.getFullYear()}`;
  return `${monthDayYear(start)} – ${monthDayYear(end)}`;
}

function TripRow({
  item,
  variant,
  onClick,
  onDelete,
  deletePending,
}: Readonly<{
  item: UserTripAssociation;
  variant: "primary" | "watching";
  onClick: () => void;
  onDelete?: () => void;
  deletePending?: boolean;
}>) {
  const dateLabel = formatTripDates(item.dateRange);

  if (variant === "watching") {
    return (
      <div
        onClick={onClick}
        className="rounded-xl px-4 py-3 cursor-pointer flex items-center justify-between gap-3 group transition-opacity hover:opacity-90"
        style={{ background: FOREST_ACCENT, border: `1px solid ${FOREST_HAIRLINE}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="font-sans font-semibold text-sm truncate" style={{ color: BRASS_MUTED }}>
            {item.trip.name}
          </div>
          {dateLabel && (
            <div className="text-xs mt-0.5 truncate" style={{ color: BRASS_FAINT }}>
              {dateLabel}
            </div>
          )}
        </div>
        <ChevronRight size={16} style={{ color: "hsl(42 25% 45%)" }} />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="rounded-xl px-5 py-4 cursor-pointer flex items-center justify-between gap-3 group transition-transform hover:scale-[1.005]"
      style={{ background: CREAM, border: `1px solid ${CREAM_BORDER}` }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="rounded-lg p-2" style={{ background: FOREST_ACCENT }}>
          <Flag size={16} style={{ color: BRASS }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif font-medium text-[17px] leading-tight truncate" style={{ color: INK }}>
            {item.trip.name}
          </div>
          {dateLabel && (
            <div className="text-xs mt-1 truncate" style={{ color: INK_SOFT }}>
              {dateLabel}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onDelete && (
          <DeleteTripButton tripName={item.trip.name} pending={!!deletePending} onConfirm={onDelete} />
        )}
        <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
      </div>
    </div>
  );
}

function DeleteTripButton({
  tripName,
  pending,
  onConfirm,
}: Readonly<{ tripName: string; pending: boolean; onConfirm: () => void }>) {
  const [open, setOpen] = useState(false);
  function handleConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onConfirm();
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete ${tripName}`}
          disabled={pending}
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg p-2 transition-colors hover:bg-black/5 disabled:opacity-60"
          style={{ color: DANGER }}
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{tripName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the trip and everything attached to it — all rounds,
            players, scores, comments and kudos. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-[hsl(2_62%_44%)] hover:bg-[hsl(2_62%_38%)] focus-visible:ring-[hsl(2_62%_44%)]"
          >
            Delete trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes. (`my-trips.tsx` is unchanged; the new file is unused for now.)

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/components/my-trips-list.tsx
git commit -m "Extract MyTripsList component for reuse in /my-golf"
```

### Task 16: Build the `MyRoundsList` component

**Files:**
- Create: `artifacts/golf-scorecard/src/components/my-rounds-list.tsx`

- [ ] **Step 1: Write the component**

Create `artifacts/golf-scorecard/src/components/my-rounds-list.tsx`:

```tsx
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useListMyRounds, type MyRoundsItem } from "@workspace/api-client-react";
import { Flag, ChevronRight } from "lucide-react";

const BRASS = "hsl(42 52% 59%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 50%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const CREAM_BORDER = "hsl(38 25% 88%)";
const AMBER_BG = "hsl(42 80% 90%)";
const AMBER_FG = "hsl(35 60% 30%)";
const UNDER_PAR = "hsl(150 50% 30%)";

type Filter = "all" | "solo" | "trip";

export function MyRoundsList() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data: items, isLoading } = useListMyRounds({ filter });
  const safeItems: MyRoundsItem[] = items ?? [];

  // Compute counts for chips from a *single* fetch of all items.
  // Cheaper than three separate queries.
  const { allCount, soloCount, tripCount } = useMemo(() => {
    let solo = 0, trip = 0;
    for (const it of safeItems) {
      if (it.round.tripId === null) solo++;
      else trip++;
    }
    return { allCount: safeItems.length, soloCount: solo, tripCount: trip };
  }, [safeItems]);

  const grouped = useMemo(() => groupByMonth(safeItems), [safeItems]);

  if (isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 rounded-md animate-pulse" style={{ background: "hsl(38 30% 90%)" }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <FilterChips filter={filter} onChange={setFilter} all={allCount} solo={soloCount} trip={tripCount} />
      {safeItems.length === 0 ? <EmptyState filter={filter} /> : (
        <div>
          {grouped.map(g => (
            <section key={g.label}>
              <div
                className="text-[10px] font-sans font-bold uppercase pt-4 pb-2 px-5"
                style={{ color: "hsl(42 50% 40%)", letterSpacing: "0.32em" }}
              >
                {g.label}
              </div>
              {g.items.map(item => <RoundRow key={item.round.id} item={item} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChips({
  filter, onChange, all, solo, trip,
}: Readonly<{ filter: Filter; onChange: (f: Filter) => void; all: number; solo: number; trip: number }>) {
  const chips: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: all },
    { value: "solo", label: "Solo", count: solo },
    { value: "trip", label: "Trip", count: trip },
  ];
  return (
    <div className="flex gap-2 px-5 py-3 border-b" style={{ borderColor: CREAM_BORDER }}>
      {chips.map(c => {
        const active = filter === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={active}
            className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] px-3 py-1.5 rounded-full transition-colors"
            style={{
              background: active ? "hsl(158 65% 9%)" : "white",
              color: active ? BRASS : "hsl(38 20% 38%)",
              border: active ? "1px solid hsl(158 65% 9%)" : "1px solid hsl(38 25% 78%)",
            }}
          >
            {c.label} <span style={{ opacity: 0.6, fontWeight: 500 }}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ filter }: Readonly<{ filter: Filter }>) {
  const msg = filter === "solo" ? "No solo rounds yet."
    : filter === "trip" ? "No trip rounds yet."
    : "You haven't logged any rounds yet. Log one to get started.";
  return (
    <div className="text-center py-16 px-5">
      <div className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center"
        style={{ background: FOREST_ACCENT, border: "1px solid hsl(42 60% 48%)" }}>
        <Flag size={22} style={{ color: BRASS }} strokeWidth={1.6} />
      </div>
      <p className="font-sans text-sm" style={{ color: BRASS_FAINT, lineHeight: 1.55 }}>{msg}</p>
    </div>
  );
}

function RoundRow({ item }: Readonly<{ item: MyRoundsItem }>) {
  const [, navigate] = useLocation();
  const r = item.round;
  const trip = item.trip;
  const inProgress = !r.completedAt;
  const detailHref = r.tripId === null ? `/rounds/${r.id}` : `/trips/${r.tripId}/rounds/${r.id}`;

  const dateInfo = parseDateForRow(r.date ?? r.createdAt);
  const grossLabel = inProgress ? "—" : (item.gross != null ? String(item.gross) : "—");
  const netLabel = inProgress
    ? "play"
    : (item.net != null ? `${item.net > 0 ? "+" : item.net < 0 ? "−" : ""}${Math.abs(item.net)} net` : "");

  return (
    <div
      onClick={() => navigate(detailHref)}
      className="flex items-start gap-3 px-5 py-3.5 cursor-pointer transition-colors hover:bg-black/[0.02] border-t"
      style={{ borderColor: CREAM_BORDER, background: "white" }}
    >
      <div className="w-9 flex-shrink-0 text-center">
        <div className="font-serif text-[22px] leading-none" style={{ color: INK }}>{dateInfo.day}</div>
        <div className="text-[9px] tracking-[0.18em] mt-0.5 uppercase" style={{ color: INK_SOFT }}>{dateInfo.weekday}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-serif text-[15px] font-medium" style={{ color: INK }}>{r.course ?? r.name}</div>
        <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: INK_SOFT }}>
          {inProgress && (
            <>
              <span className="font-bold uppercase tracking-[0.1em] text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: AMBER_BG, color: AMBER_FG }}>In progress</span>
              <span>· {item.holesPlayed} of 18 holes</span>
            </>
          )}
          {!inProgress && trip && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/trips/${trip.id}`); }}
              className="font-bold uppercase tracking-[0.12em] text-[9px] px-1.5 py-0.5 rounded-full transition-opacity hover:opacity-85"
              style={{ background: FOREST_ACCENT, color: BRASS }}
            >
              {trip.name}
            </button>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="font-serif text-[18px] font-medium" style={{ color: INK }}>{grossLabel}</div>
        <div className="text-[11px] mt-0.5" style={{ color: item.net != null && item.net < 0 ? UNDER_PAR : INK_SOFT }}>
          {netLabel}
        </div>
      </div>
      <ChevronRight size={18} style={{ color: "hsl(38 25% 65%)" }} className="self-center ml-1" />
    </div>
  );
}

type Grouped = { label: string; items: MyRoundsItem[] };

function groupByMonth(items: MyRoundsItem[]): Grouped[] {
  const byKey = new Map<string, Grouped>();
  for (const it of items) {
    const raw = it.round.date ?? it.round.createdAt;
    const d = parseLocalOrIso(raw);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const bucket = byKey.get(key) ?? { label, items: [] };
    bucket.items.push(it);
    byKey.set(key, bucket);
  }
  // Map iteration preserves insertion order, and our items are already date-desc,
  // so the month buckets come out date-desc too.
  return Array.from(byKey.values());
}

function parseLocalOrIso(s: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateForRow(s: string): { day: string; weekday: string } {
  const d = parseLocalOrIso(s);
  if (!d) return { day: "—", weekday: "" };
  return {
    day: String(d.getDate()).padStart(2, "0"),
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes. (Imports `useListMyRounds` and `MyRoundsItem` from the regenerated client; if either is missing, re-run Task 7 codegen.)

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/components/my-rounds-list.tsx
git commit -m "Add MyRoundsList component (filter chips, month grouping, in-progress state)"
```

### Task 17: Create the `MyGolfPage` page with sub-tab routing

**Files:**
- Create: `artifacts/golf-scorecard/src/pages/my-golf.tsx`

- [ ] **Step 1: Write the page**

Create `artifacts/golf-scorecard/src/pages/my-golf.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Plus } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";
import { useAuthSession, type AuthSession } from "@/lib/auth";
import { MyRoundsList } from "@/components/my-rounds-list";
import { MyTripsList } from "@/components/my-trips-list";
import { SoloRoundModal } from "@/components/solo-round-modal";

type Tab = "rounds" | "trips";

const BRASS = "hsl(42 52% 59%)";
const BRASS_FAINT = "hsl(42 25% 60%)";

export default function MyGolfPage() {
  const session = useAuthSession();
  if (!session) {
    return <RequireSignIn mandatory>{null}</RequireSignIn>;
  }
  return <MyGolfContent session={session} />;
}

function MyGolfContent({ session }: Readonly<{ session: AuthSession }>) {
  const [location, navigate] = useLocation();
  // Parse ?tab= from the URL so /my-golf?tab=trips lands on Trips.
  const tab: Tab = useMemo(() => {
    const search = location.includes("?") ? location.slice(location.indexOf("?")) : "";
    const params = new URLSearchParams(search);
    return params.get("tab") === "trips" ? "trips" : "rounds";
  }, [location]);
  const [logRoundOpen, setLogRoundOpen] = useState(false);

  function setTab(next: Tab) {
    navigate(next === "trips" ? "/my-golf?tab=trips" : "/my-golf", { replace: true });
  }

  function handlePrimaryCTA() {
    if (tab === "rounds") setLogRoundOpen(true);
    else navigate("/trips/new");
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-0" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Home
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-serif" style={{ color: BRASS }}>My Golf</h1>
              <p className="text-sm font-sans mt-1" style={{ color: BRASS_FAINT }}>Your rounds and trips.</p>
            </div>
            <button
              onClick={handlePrimaryCTA}
              aria-label={tab === "rounds" ? "Log a round" : "Start a new trip"}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full font-sans text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90 active:opacity-80"
              style={{
                background: BRASS,
                color: "hsl(38 30% 12%)",
                boxShadow: "0 1px 0 hsl(42 60% 48%) inset, 0 8px 18px -8px hsla(42, 60%, 50%, 0.55)",
                letterSpacing: "0.12em",
              }}
            >
              <Plus size={14} strokeWidth={2.25} />
              {tab === "rounds" ? "Log round" : "New trip"}
            </button>
          </div>
          <div className="flex gap-5 mt-6 -mb-px">
            <TabButton active={tab === "rounds"} onClick={() => setTab("rounds")}>Rounds</TabButton>
            <TabButton active={tab === "trips"} onClick={() => setTab("trips")}>Trips</TabButton>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto" style={{ background: "hsl(38 40% 96%)" }}>
        {tab === "rounds" ? <MyRoundsList /> : (
          <div className="px-6 py-6">
            <MyTripsList session={session} />
          </div>
        )}
      </div>

      <SoloRoundModal
        open={logRoundOpen}
        onClose={() => setLogRoundOpen(false)}
        onCreated={({ tripId, roundId }) => navigate(tripId == null ? `/rounds/${roundId}` : `/trips/${tripId}/rounds/${roundId}`)}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }: Readonly<{ active: boolean; onClick: () => void; children: React.ReactNode }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] pb-3"
      style={{
        color: active ? BRASS : "hsl(42 25% 55%)",
        borderBottom: active ? `2px solid ${BRASS}` : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes. **Known shim:** the `SoloRoundModal` `onCreated` callback already accepts `{ tripId, roundId, playerId }`. When we update the modal in Task 19 to optionally return `tripId: null`, this caller branches on it. No change needed here.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/my-golf.tsx
git commit -m "Add MyGolfPage with Rounds/Trips sub-tabs"
```

### Task 18: Wire `/my-golf` and `/me/trips` redirect into the router; swap NavBar link

**Files:**
- Modify: `artifacts/golf-scorecard/src/App.tsx`

- [ ] **Step 1: Add the route + a small redirect component**

In `App.tsx`, after the existing `MyTripsPage` import, add:

```ts
import MyGolfPage from "@/pages/my-golf";
```

Add this component above `function Router()`:

```tsx
function MyTripsRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/my-golf?tab=trips", { replace: true }); }, [navigate]);
  return null;
}
```

In the `<Switch>`, replace the existing `<Route path="/me/trips" component={MyTripsPage} />` with:

```tsx
<Route path="/my-golf" component={MyGolfPage} />
<Route path="/me/trips" component={MyTripsRedirect} />
```

- [ ] **Step 2: Update NavBar — change "My Trips" link to "My Golf"**

In the `NavBar` component, find:

```tsx
const isMyTrips = location === "/me/trips";
```

Replace with:

```tsx
const isMyGolf = location.startsWith("/my-golf");
```

Then change every reference from `isMyTrips` → `isMyGolf`, change `href="/me/trips"` → `href="/my-golf"`, change `aria-label="..."` and the visible text from `My Trips` → `My Golf`.

(The Link block to change is around lines 112-129 of the current App.tsx.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 4: Smoke test in browser**

Start the dev servers if not running: `pnpm run dev`. Navigate to `http://localhost:${UI_PORT:-5173}/`. Verify:
- Nav shows "My Golf" (not "My Trips").
- Clicking "My Golf" lands on `/my-golf` and shows the Rounds tab.
- Manually visit `/my-golf?tab=trips` — shows the Trips tab (the existing Created/Joined/Watching list).
- Visit `/me/trips` — redirects to `/my-golf?tab=trips`.

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/App.tsx
git commit -m "Add /my-golf route, redirect /me/trips, swap nav link"
```

### Task 19: Build the `TripPicker` and wire it into the log-round modal

**Files:**
- Create: `artifacts/golf-scorecard/src/components/trip-picker.tsx`
- Modify: `artifacts/golf-scorecard/src/components/solo-round-modal.tsx`

- [ ] **Step 1: Create `trip-picker.tsx`**

```tsx
import { useListMyTrips } from "@workspace/api-client-react";

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
};

export function TripPicker({ value, onChange }: Readonly<Props>) {
  const { data: trips } = useListMyTrips();
  // Only trips where the caller has a player row (created or joined). Saved-only
  // trips don't make sense as a destination because they're not yours to add to.
  const choices = (trips ?? []).filter(t => t.via === "player" || t.via === "both");

  return (
    <select
      value={value === null ? "" : String(value)}
      onChange={e => {
        const raw = e.target.value;
        onChange(raw === "" ? null : Number(raw));
      }}
      className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans"
      style={{ border: "1.5px solid hsl(var(--input))" }}
    >
      <option value="">None (solo)</option>
      {choices.map(c => (
        <option key={c.trip.id} value={c.trip.id}>{c.trip.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Modify `solo-round-modal.tsx` to use the new endpoint + picker**

Edit `artifacts/golf-scorecard/src/components/solo-round-modal.tsx`. Replace its contents with:

```tsx
import { useState } from "react";
import { useCreateRoundV2 } from "@workspace/api-client-react";
import { X } from "lucide-react";
import { CourseSearchField } from "@/components/course-search-field";
import { TripPicker } from "@/components/trip-picker";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (ids: { tripId: number | null; roundId: number; playerId: number }) => void;
};

export function SoloRoundModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [tripId, setTripId] = useState<number | null>(null);
  const [teeBox, setTeeBox] = useState<string | null>(null);
  const [courseRating, setCourseRating] = useState<number | null>(null);
  const [courseSlope, setCourseSlope] = useState<number | null>(null);
  const [par, setPar] = useState<number[] | null>(null);
  const [holeHcp, setHoleHcp] = useState<number[] | null>(null);
  const create = useCreateRoundV2();

  if (!open) return null;

  function reset() {
    setName("");
    setCourse("");
    setTripId(null); // Non-sticky — every open of the modal resets to solo.
    setTeeBox(null);
    setCourseRating(null);
    setCourseSlope(null);
    setPar(null);
    setHoleHcp(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = course.trim();
    const n = name.trim() || (c || "New round");
    create.mutate(
      {
        data: {
          tripId,
          name: n,
          course: c || null,
          teeBox,
          courseRating,
          courseSlope,
          ...(par ? { par } : {}),
          ...(holeHcp ? { holeHcp } : {}),
        },
      },
      { onSuccess: (resp) => { onCreated(resp); onClose(); reset(); } }
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
        <div className="mb-3">
          <CourseSearchField
            autoFocus
            placeholder="Search for a club or course…"
            onCourseSelected={(detail) => setCourse(detail.clubName)}
            onTeeApplied={(tee, detail) => {
              setCourse(detail.clubName);
              setTeeBox(tee.name);
              setCourseRating(tee.rating);
              setCourseSlope(tee.slope);
              setPar(tee.par);
              setHoleHcp(tee.holeHcp);
            }}
            onCleared={() => {
              setCourse("");
              setTeeBox(null);
              setCourseRating(null);
              setCourseSlope(null);
              setPar(null);
              setHoleHcp(null);
            }}
          />
        </div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Course name</label>
        <input
          value={course}
          onChange={e => setCourse(e.target.value)}
          placeholder="e.g. Bethpage Black"
          className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans mb-4"
          style={{ border: "1.5px solid hsl(var(--input))" }}
        />
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Trip (optional)</label>
        <div className="mb-4">
          <TripPicker value={tripId} onChange={setTripId} />
        </div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Round name (optional)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={course.trim() ? `Defaults to "${course.trim()}"` : "Defaults to the course name"}
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

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes. If `useCreateRoundV2` is missing, re-run codegen (Task 7). If `tripId: null` is rejected, the OpenAPI schema in Task 4 needs `nullable: true` — check that `type: ["integer", "null"]` was written as a YAML array.

- [ ] **Step 4: Smoke test**

Start dev servers if down. From `/my-golf`, click `+ Log round`. Verify:
- Modal opens, default trip is "None (solo)".
- Pick a course; submit. You land on `/rounds/<id>` (solo flow).
- Open the modal again. Pick a trip from the dropdown. Submit. You land on `/trips/<tripId>/rounds/<id>` (trip flow).

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/components/trip-picker.tsx artifacts/golf-scorecard/src/components/solo-round-modal.tsx
git commit -m "Add TripPicker to log-round modal; switch to unified POST /rounds"
```

---

## Phase 5 — Round detail for solo rounds

> **Honest scope note:** [round.tsx](../../artifacts/golf-scorecard/src/pages/round.tsx) is ~1500 lines and is fundamentally trip-scoped — every data hook (`useGetRound`, `useListPlayers`, `useGetScores`, `useGetRoundLeaderboard`, `useTripIdentity`, `useListRoundGroups`, `useGetTrip`, scramble hooks) takes a required `tripId`, and the layout assumes multiple players, groups, and a trip back-link. Adapting it in-place is a substantial refactor.
>
> Pragmatic path: build a focused `SoloRoundPage` component for `/rounds/:roundId` that includes only what makes sense for a single-player round (round metadata, single-player 18-hole grid, completion toggle, kudos/comments). It reuses kudos/comments components (which are already round-scoped, not trip-scoped) and duplicates the score grid logic. Future cleanup: extract a shared `<ScoreGrid>` from both pages — out of scope here.

### Task 20: Add flat `/rounds/:roundId/scores` endpoints (server + OpenAPI)

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/rounds-me.ts`

- [ ] **Step 1: Add OpenAPI paths under the `/rounds/{roundId}` block**

Find the `/rounds/{roundId}:` block from Task 5. After its `delete:` operation, append two new sibling paths (note: these are new top-level keys, not nested):

```yaml
  /rounds/{roundId}/scores:
    get:
      operationId: getSoloRoundScores
      tags: [scores]
      summary: Get all score rows for a (solo) round, keyed by roundId only
      parameters:
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Scores
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/PlayerScore"
    put:
      operationId: upsertSoloRoundScore
      tags: [scores]
      summary: Upsert one player's score for one hole (solo round path)
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
              $ref: "#/components/schemas/UpsertScoreBody"
      responses:
        "200":
          description: Upserted
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PlayerScore"
```

- [ ] **Step 2: Implement the handlers in `rounds-me.ts`**

In `rounds-me.ts`, before `export default router;`, insert:

```ts
import { UpsertScoreBody } from "@workspace/api-zod";

router.get("/rounds/:roundId/scores", async (req, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  const scores = await db.select().from(scoresTable).where(eq(scoresTable.roundId, roundId));
  res.json(ser(scores));
});

router.put("/rounds/:roundId/scores", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const roundId = Number(req.params.roundId);
  if (!Number.isFinite(roundId)) { res.status(400).json({ error: "Invalid roundId" }); return; }
  const parsed = UpsertScoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { playerId, hole, score } = parsed.data;
  const holeIdx = hole - 1;
  if (holeIdx < 0 || holeIdx > 17) { res.status(400).json({ error: "Hole must be between 1 and 18" }); return; }

  // The caller must own the player they're scoring for.
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId)).limit(1);
  if (!player || player.userId !== req.user!.id) {
    res.status(403).json({ error: "Cannot score for another player" });
    return;
  }

  const [existing] = await db.select().from(scoresTable)
    .where(and(eq(scoresTable.roundId, roundId), eq(scoresTable.playerId, playerId)))
    .limit(1);

  let row;
  if (existing) {
    const newHoleScores = [...(existing.holeScores as (number | null)[])];
    while (newHoleScores.length < 18) newHoleScores.push(null);
    newHoleScores[holeIdx] = score ?? null;
    [row] = await db.update(scoresTable)
      .set({ holeScores: newHoleScores, updatedAt: new Date() })
      .where(eq(scoresTable.id, existing.id))
      .returning();
  } else {
    const newHoleScores = Array(18).fill(null) as (number | null)[];
    newHoleScores[holeIdx] = score ?? null;
    [row] = await db.insert(scoresTable).values({ roundId, playerId, holeScores: newHoleScores }).returning();
  }
  res.json(ser(row));
});
```

- [ ] **Step 3: Regenerate + typecheck + smoke**

Run:
```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run build
```
Expected: codegen adds `useGetSoloRoundScores`, `useUpsertSoloRoundScore`. Build passes.

Smoke (with a real solo round and player you own):
```bash
curl -s "http://localhost:${API_PORT:-3000}/api/rounds/<ROUND_ID>/scores" | jq
curl -s -X PUT "http://localhost:${API_PORT:-3000}/api/rounds/<ROUND_ID>/scores" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"playerId":<PLAYER_ID>,"hole":1,"score":4}' | jq
```
Expected: GET returns an array; PUT returns the upserted PlayerScore row.

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml artifacts/api-server/src/routes/rounds-me.ts lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "Add flat /rounds/:id/scores endpoints for solo round detail page"
```

### Task 21: Create `SoloRoundPage` component

**Files:**
- Create: `artifacts/golf-scorecard/src/pages/solo-round.tsx`
- Modify: `artifacts/golf-scorecard/src/App.tsx`

This is the biggest single task in the plan — budget ~60-90 minutes. You're building a focused page that supports: round metadata header, single-player score grid (1 row × 18 holes), per-hole input via tap, gross/net totals, "Mark complete" toggle, comments + kudos via existing components.

- [ ] **Step 1: Sketch the structure first**

Before writing code, open [round.tsx](../../artifacts/golf-scorecard/src/pages/round.tsx) and identify these regions:
- Header / course summary (~lines 1000-1100)
- Score input grid (look for `holeScores`, the per-hole tap handler)
- Comments + kudos integration (look for `RoundSocialStrip` or similar)
- The complete-round button

You'll copy the patterns from these regions into the new file but in a single-player flavor. Do NOT directly import these as components — they're inline in the trip page and assume the multi-player layout.

- [ ] **Step 2: Create the scaffold**

Create `artifacts/golf-scorecard/src/pages/solo-round.tsx`:

```tsx
import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  useGetSoloRound,
  useUpdateSoloRound,
  useDeleteSoloRound,
  useGetSoloRoundScores,
  useUpsertSoloRoundScore,
  getGetSoloRoundQueryKey,
  getGetSoloRoundScoresQueryKey,
} from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/auth";
import NotFound from "@/pages/not-found";

const BRASS = "hsl(42 52% 59%)";
const INK = "hsl(38 30% 14%)";

export default function SoloRoundPage() {
  const { roundId: roundIdStr } = useParams<{ roundId: string }>();
  const roundId = Number(roundIdStr);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const session = useAuthSession();

  const { data: round, isLoading } = useGetSoloRound(roundId, {
    query: { queryKey: getGetSoloRoundQueryKey(roundId), enabled: !!roundId },
  });
  const { data: scoreRows } = useGetSoloRoundScores(roundId, {
    query: { queryKey: getGetSoloRoundScoresQueryKey(roundId), enabled: !!roundId },
  });
  const updateRound = useUpdateSoloRound();
  const upsertScore = useUpsertSoloRoundScore();

  // The caller owns the round (server enforces it); for a solo round the caller's
  // player is the only score row.
  const myScoreRow = scoreRows?.[0] ?? null;
  const myPlayerId = myScoreRow?.playerId ?? null;
  const holeScores = (myScoreRow?.holeScores as (number | null)[] | undefined) ?? Array(18).fill(null);

  const { gross, netVsPar, holesPlayed } = useMemo(() => {
    if (!round) return { gross: null as number | null, netVsPar: null as number | null, holesPlayed: 0 };
    let sum = 0;
    let played = 0;
    for (let h = 0; h < 18; h++) {
      const s = holeScores[h];
      if (s != null) { sum += s; played++; }
    }
    const parTotal = round.par.reduce((a, b) => a + b, 0);
    return { gross: played > 0 ? sum : null, netVsPar: played === 18 ? sum - parTotal : null, holesPlayed: played };
  }, [round, holeScores]);

  function setHole(hole: number, score: number | null) {
    if (myPlayerId == null) return;
    upsertScore.mutate(
      { roundId, data: { playerId: myPlayerId, hole, score } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSoloRoundScoresQueryKey(roundId) }) },
    );
  }

  function toggleComplete() {
    if (!round) return;
    const next = round.completedAt ? null : new Date().toISOString();
    updateRound.mutate(
      { roundId, data: { completedAt: next } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSoloRoundQueryKey(roundId) }) },
    );
  }

  if (!roundId) return <NotFound />;
  if (isLoading) return <div className="min-h-dvh bg-background flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!round) return <NotFound />;

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate("/my-golf")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            My Golf
          </button>
          <h1 className="text-2xl font-serif" style={{ color: BRASS }}>{round.course ?? round.name}</h1>
          {round.date && (
            <p className="text-sm font-sans mt-1" style={{ color: "hsl(42 25% 60%)" }}>{round.date}</p>
          )}
          <div className="flex items-center gap-6 mt-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "hsl(42 25% 55%)" }}>Gross</div>
              <div className="text-xl font-serif" style={{ color: BRASS }}>{gross ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "hsl(42 25% 55%)" }}>Net vs par</div>
              <div className="text-xl font-serif" style={{ color: BRASS }}>
                {netVsPar == null ? "—" : `${netVsPar > 0 ? "+" : netVsPar < 0 ? "−" : ""}${Math.abs(netVsPar)}`}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "hsl(42 25% 55%)" }}>Holes</div>
              <div className="text-xl font-serif" style={{ color: BRASS }}>{holesPlayed} / 18</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 py-4">
        <SoloHoleGrid par={round.par} holeScores={holeScores} onSetHole={setHole} disabled={myPlayerId == null} />
        <button
          type="button"
          onClick={toggleComplete}
          disabled={updateRound.isPending}
          className="mt-6 w-full py-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm disabled:opacity-50"
        >
          {round.completedAt ? "Mark in progress" : "Mark round complete"}
        </button>
      </div>
    </div>
  );
}

function SoloHoleGrid({
  par, holeScores, onSetHole, disabled,
}: Readonly<{ par: number[]; holeScores: (number | null)[]; onSetHole: (hole: number, score: number | null) => void; disabled: boolean }>) {
  return (
    <div className="grid grid-cols-9 gap-1.5">
      {Array.from({ length: 18 }, (_, i) => {
        const hole = i + 1;
        const currentValue = holeScores[i];
        const holePar = par[i] ?? 4;
        return (
          <div key={hole} className="flex flex-col items-center">
            <div className="text-[9px] tracking-[0.12em] uppercase font-bold mb-1" style={{ color: "hsl(38 20% 50%)" }}>{hole}</div>
            <input
              type="number"
              min={1}
              max={15}
              value={currentValue ?? ""}
              disabled={disabled}
              onChange={e => {
                const raw = e.target.value;
                onSetHole(hole, raw === "" ? null : Number(raw));
              }}
              className="w-full text-center font-serif text-base rounded-md py-1.5 disabled:opacity-50"
              style={{ background: "hsl(42 45% 91%)", color: INK, border: "1px solid hsl(38 25% 78%)" }}
              placeholder={String(holePar)}
            />
          </div>
        );
      })}
    </div>
  );
}
```

This is intentionally a simpler grid than the trip page's grid — no per-hole-handicap stroke dots, no scramble/best-ball overlays, no group-completion indicators. For v1 of solo rounds, just a clean number entry per hole. If we want feature parity later, the right move is extracting a shared grid component from round.tsx; that's its own follow-up.

- [ ] **Step 3: Register the route in App.tsx**

In `App.tsx`, add the import:

```tsx
import SoloRoundPage from "@/pages/solo-round";
```

In the `<Switch>`, add (before the trip-scoped round route):

```tsx
<Route path="/rounds/:roundId" component={SoloRoundRouteGuard} />
```

And add a guard wrapper above `function Router()`:

```tsx
function SoloRoundRouteGuard() {
  const session = useAuthSession();
  if (!session) return <RequireSignIn mandatory>{null}</RequireSignIn>;
  return <SoloRoundPage />;
}
```

(`RequireSignIn` is already imported in the codebase; verify the import path — it's likely `@/components/require-sign-in`.)

- [ ] **Step 4: Typecheck + smoke**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

Browser smoke: log a solo round via `/my-golf` → land on `/rounds/<id>`. Verify:
- Course header shows.
- 18 input fields render with par as placeholder.
- Type a score in hole 1 — it persists (refresh confirms).
- Gross / Holes counters update.
- "Mark round complete" toggles to show "Mark in progress".

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/solo-round.tsx artifacts/golf-scorecard/src/App.tsx
git commit -m "Add SoloRoundPage for trip-less round detail with simple hole grid"
```

### Task 22: Update `feed-card.tsx` to deep-link to the right route

**Files:**
- Modify: `artifacts/golf-scorecard/src/components/feed-card.tsx`

- [ ] **Step 1: Switch the onClick navigate**

In `feed-card.tsx` find the line:

```ts
onClick={() => navigate(`/trips/${item.tripId}/rounds/${item.roundId}`)}
```

Replace with:

```ts
onClick={() => navigate(item.tripId == null ? `/rounds/${item.roundId}` : `/trips/${item.tripId}/rounds/${item.roundId}`)}
```

(The `FeedItem.tripId` becomes nullable when the feed query's join changes in Task 14.)

- [ ] **Step 2: Make `FeedItem.tripId` nullable in OpenAPI if it isn't already**

In `lib/api-spec/openapi.yaml`, find the `FeedItem` schema. Look at its `tripId` property. If it's `type: integer`, change it to `type: ["integer", "null"]`. (If it's already nullable, skip this.)

- [ ] **Step 3: Regenerate + typecheck**

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/golf-scorecard run typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/components/feed-card.tsx lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "Route feed cards to /rounds/:id for trip-less rounds"
```

---

## Phase 6 — Data migration

### Task 23: Write the migration script with a unit-testable helper

**Files:**
- Create: `scripts/migrate-retire-personal-trips.ts`
- Create: `scripts/migrate-retire-personal-trips.test.ts`

- [ ] **Step 1: Write the script**

Create `scripts/migrate-retire-personal-trips.ts`:

```ts
/*
 * One-shot migration: retire kind='personal' trips.
 *
 * For each personal trip:
 *  - delete its user_trip_follows rows (defensive)
 *  - null out its rounds.trip_id (the rounds become solo)
 *  - null out its players.trip_id (the player row becomes the user's solo player)
 *  - delete the trip row
 *
 * Idempotent: running again finds zero personal trips.
 *
 * Run: pnpm tsx scripts/migrate-retire-personal-trips.ts
 */
import { Pool } from "pg";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

export type MigrationSummary = {
  tripsRetired: number;
  roundsDetached: number;
  playersDetached: number;
  followsRemoved: number;
};

export async function migrate(pool: Pool): Promise<MigrationSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tripsRes = await client.query<{ id: number }>(
      "SELECT id FROM trips WHERE kind = 'personal'",
    );
    const ids = tripsRes.rows.map(r => r.id);
    if (ids.length === 0) {
      await client.query("COMMIT");
      return { tripsRetired: 0, roundsDetached: 0, playersDetached: 0, followsRemoved: 0 };
    }

    const followsRes = await client.query(
      "DELETE FROM user_trip_follows WHERE trip_id = ANY($1::int[])",
      [ids],
    );
    const followsRemoved = followsRes.rowCount ?? 0;

    const roundsRes = await client.query(
      "UPDATE rounds SET trip_id = NULL WHERE trip_id = ANY($1::int[])",
      [ids],
    );
    const roundsDetached = roundsRes.rowCount ?? 0;

    const playersRes = await client.query(
      "UPDATE players SET trip_id = NULL WHERE trip_id = ANY($1::int[])",
      [ids],
    );
    const playersDetached = playersRes.rowCount ?? 0;

    const tripsDeleteRes = await client.query(
      "DELETE FROM trips WHERE id = ANY($1::int[])",
      [ids],
    );
    const tripsRetired = tripsDeleteRes.rowCount ?? 0;

    await client.query("COMMIT");
    return { tripsRetired, roundsDetached, playersDetached, followsRemoved };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const summary = await migrate(pool);
    console.log("Migration complete:", JSON.stringify(summary));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the test file**

Create `scripts/migrate-retire-personal-trips.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrate } from "./migrate-retire-personal-trips";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

describe("migrate-retire-personal-trips", () => {
  it("is idempotent — running twice on a clean DB reports zero work", async () => {
    if (!TEST_DATABASE_URL) {
      console.log("Skipping: set TEST_DATABASE_URL to run integration test");
      return;
    }
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      // First pass migrates whatever's there.
      await migrate(pool);
      // Second pass should be a no-op.
      const summary = await migrate(pool);
      assert.equal(summary.tripsRetired, 0);
      assert.equal(summary.roundsDetached, 0);
      assert.equal(summary.playersDetached, 0);
      assert.equal(summary.followsRemoved, 0);
    } finally {
      await pool.end();
    }
  });
});
```

This intentionally guards the test on `TEST_DATABASE_URL` — we don't want it running against the dev DB. To actually exercise it, create a throwaway test database, seed it with personal trips, then run:

```bash
TEST_DATABASE_URL=postgres://… pnpm tsx --test scripts/migrate-retire-personal-trips.test.ts
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit scripts/migrate-retire-personal-trips.ts scripts/migrate-retire-personal-trips.test.ts`
Expected: passes. If `pg` types are missing, add it as a dev dep at workspace root: `pnpm add -D pg @types/pg -w` (the workspace catalog already has `pg` for `@workspace/db`; verify).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-retire-personal-trips.ts scripts/migrate-retire-personal-trips.test.ts
git commit -m "Add data migration script for retiring personal trips"
```

### Task 24: Dry-run + actual run of the migration against `DATABASE_URL`

**Files:** None modified — runtime only.

- [ ] **Step 1: Snapshot the DB**

Before running, take a `pg_dump` so you can roll back if anything goes sideways:

```bash
pg_dump "$DATABASE_URL" -F c -f .superpowers/brainstorm/pre-my-golf-migration.dump
```

(Or whatever backup mechanism you use for the Replit DB — the important thing is having a known-good snapshot.)

- [ ] **Step 2: Inspect the current state**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS personal_trips FROM trips WHERE kind = 'personal';"
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS rounds_in_personal_trips FROM rounds r JOIN trips t ON t.id = r.trip_id WHERE t.kind = 'personal';"
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS players_in_personal_trips FROM players p JOIN trips t ON t.id = p.trip_id WHERE t.kind = 'personal';"
```

Record the three counts.

- [ ] **Step 3: Run the migration**

```bash
pnpm tsx scripts/migrate-retire-personal-trips.ts
```

Expected output: `Migration complete: {"tripsRetired":N,"roundsDetached":M,"playersDetached":P,"followsRemoved":Q}` where N, M, P match the counts you recorded in Step 2.

- [ ] **Step 4: Verify**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM trips WHERE kind = 'personal';"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM rounds WHERE trip_id IS NULL;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM players WHERE trip_id IS NULL;"
```

Expected: personal trip count is 0; null-tripId rounds and players counts equal M and P from Step 3.

- [ ] **Step 5: Run the migration a second time (idempotency check)**

```bash
pnpm tsx scripts/migrate-retire-personal-trips.ts
```

Expected: `{"tripsRetired":0,"roundsDetached":0,"playersDetached":0,"followsRemoved":0}`.

No commit — this task only ran scripts. The next task removes the `kind` column.

---

## Phase 7 — Cleanup + phase-2 schema push

### Task 25: Remove personal-trip special cases from server code

**Files:**
- Delete: `artifacts/api-server/src/routes/solo-round.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/users-me.ts`
- Modify: `artifacts/api-server/src/routes/trips.ts`

- [ ] **Step 1: Delete the solo-round route file**

```bash
git rm artifacts/api-server/src/routes/solo-round.ts
```

- [ ] **Step 2: Remove the import and registration**

In `artifacts/api-server/src/routes/index.ts`, delete the line:

```ts
import soloRoundRouter from "./solo-round";
```

and the line:

```ts
router.use(soloRoundRouter);
```

- [ ] **Step 3: Remove the "hide personal trips" filter in users-me.ts**

In `artifacts/api-server/src/routes/users-me.ts`, delete this block (currently at lines 54-57):

```ts
  // Hide personal (solo-round) trips — they live in the feed instead of My Trips.
  for (const [id, e] of byTripId) {
    if (e.trip.kind === "personal") byTripId.delete(id);
  }
```

- [ ] **Step 4: Remove the `kind === 'personal'` branches in trips.ts**

In `artifacts/api-server/src/routes/trips.ts`:

At lines 22-25, the listing endpoint filters by `kind = 'event'`. Replace:
```ts
    .where(eq(tripsTable.kind, "event"))
```
with no filter (trips listing now returns all trips since there's no `kind` distinction):
```ts
    // No kind filter — all trips are event-style after the personal-trip retirement.
```
(Update the surrounding query so the `.where()` call goes away cleanly. If the chain was `db.select().from(tripsTable).where(eq(…)).orderBy(…)`, it becomes `db.select().from(tripsTable).orderBy(…)`.)

At lines 58-67, the personal-trip access check. Delete:
```ts
  if (trip.kind === "personal") {
    // Only the owner can fetch the personal trip envelope.
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) { res.status(404).json({ error: "Trip not found" }); return; }
    const payload = verifySession(auth.slice(7).trim());
    if (!payload || payload.userId !== trip.createdByUserId) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
  }
```
The `verifySession` and auth-header import may become unused — remove if so (let the compiler tell you).

- [ ] **Step 5: Build + smoke test**

Run: `pnpm --filter @workspace/api-server run build`
Expected: passes. Hit:

```bash
curl -s "http://localhost:${API_PORT:-3000}/api/users/me/trips" -H "Authorization: Bearer $TOKEN" | jq 'length'
```
Expected: returns the same number of trips as before (no personal trips exist anymore, so the filter is a no-op).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/solo-round.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/users-me.ts artifacts/api-server/src/routes/trips.ts
git commit -m "Remove personal-trip special cases from server (post-migration)"
```

### Task 26: Drop `trips.kind` and the personal-trip unique index from the Drizzle schema

**Files:**
- Modify: `lib/db/src/schema/trips.ts`

- [ ] **Step 1: Edit the schema**

Replace `lib/db/src/schema/trips.ts` with:

```ts
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const tripsTable = pgTable("trips", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTripSchema = createInsertSchema(tripsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof tripsTable.$inferSelect;
```

(Removed: `kind` column, `uniqueIndex("trips_personal_per_user")`, `sql` import.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/db run typecheck`
Expected: passes. If anything else in the codebase references `trip.kind`, the compiler will flag it — fix any holdouts (server routes were cleaned in Task 24; check `lib/api-client-react` generated types — the `Trip` schema in OpenAPI may still have `kind`, which the next task removes).

- [ ] **Step 3: Push phase-2 schema**

Run: `pnpm --filter @workspace/db run push`
Expected: Drizzle reports dropping the `kind` column and the `trips_personal_per_user` index. Accept.

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/trips.ts
git commit -m "Drop trips.kind column and personal-trip unique index"
```

### Task 27: Remove `kind` from the OpenAPI `Trip` schema + retire `createSoloRound` endpoint

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Remove `kind` from the `Trip` schema**

Find the `Trip:` schema in `openapi.yaml`. Around line 1226 there's:

```yaml
        kind:
          type: string
          enum: [event, personal]
          description: '`event` = shared trip with friends. `personal` = solo-round bucket, one per user.'
```

Delete this property. If `kind` is in the `required:` list for `Trip`, remove it.

- [ ] **Step 2: Remove the `/users/me/personal-trip/rounds` path block**

Around line 306, delete the entire `/users/me/personal-trip/rounds:` block (the path and its POST operation — 22 lines).

- [ ] **Step 3: Remove `CreateSoloRoundBody` and `CreateSoloRoundResponse` schemas**

Around lines 1577-1613, delete those two schema definitions.

- [ ] **Step 4: Regenerate codegen**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: passes. The generated `Trip` type loses `kind`; `useCreateSoloRound` disappears.

- [ ] **Step 5: Fix any consumers that still referenced `kind` or `useCreateSoloRound`**

Run: `pnpm run typecheck`
Expected: passes. If anything broke, it's almost certainly in code that still imports `useCreateSoloRound` or reads `trip.kind` — fix per the compiler.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "Remove kind from Trip OpenAPI; retire createSoloRound endpoint"
```

### Task 28: Final regression sweep

**Files:** None modified — verification only.

- [ ] **Step 1: Top-level checks**

```bash
pnpm run typecheck
pnpm run build
```
Expected: both pass.

- [ ] **Step 2: Manual smoke matrix in browser** (dev servers up)

Walk through each item; each should work end-to-end:

- `/` → feed loads. A solo round in the feed links to `/rounds/:id`.
- `/my-golf` → Rounds tab shows your rounds with month grouping. Filter chips `All | Solo | Trip` partition correctly. Tap a trip badge → goes to `/trips/:tripId`. Tap a row → goes to the right detail route.
- `/my-golf?tab=trips` → shows Created / Joined / Watching buckets.
- `/me/trips` → redirects to `/my-golf?tab=trips`.
- `+ Log round` from `/my-golf` → modal opens with trip picker defaulting to "None". Submitting with trip = None → lands on `/rounds/:id`. Submitting with trip selected → lands on `/trips/:tripId/rounds/:id`.
- `+ New trip` from the Trips sub-tab → `/trips/new` → creating a trip works (unchanged behavior).
- Existing trip hub `/trips/:tripId` → all tabs work; "Add round" inside the trip still works (uses the trip-scoped endpoint, untouched).
- Round detail `/rounds/:id` → 18-hole grid works; completion toggle works; back navigates to `/my-golf`.
- Round detail `/trips/:tripId/rounds/:id` → same as before, including group-assignment editor and trip-leaderboard back-link.

- [ ] **Step 3: Final commit if anything was touched up during the sweep**

If you tweaked code during the sweep (e.g., a label, a tiny bug), commit it:

```bash
git add <paths>
git commit -m "Final touch-ups from regression sweep"
```

If nothing needed touching, skip this step.

---

## Self-review (already completed by author)

**Spec coverage:**
- Round-first model and `/my-golf` nav — Tasks 17, 18.
- Rounds list with filter + month grouping — Task 16.
- Trips sub-tab reuses today's bucketing — Task 15.
- Trip picker on log-round modal, non-sticky — Task 19.
- New `POST /rounds` and `GET/PATCH/DELETE /rounds/:id` — Tasks 9–12.
- Flat `/rounds/:id/scores` endpoints (needed by SoloRoundPage) — Task 20.
- `GET /users/me/rounds` with filter — Task 13.
- `/rounds/:id` frontend route + SoloRoundPage component — Task 21.
- Feed left-join + feed-card linking — Tasks 14, 22.
- Two-phase Drizzle push with data migration in between — Phases 1, 6, 7.
- `trips.kind` and `trips_personal_per_user` drops — Tasks 26, 27.
- `/me/trips` redirect — Task 18.

**Type consistency:** `MyRoundsItem` is created in OpenAPI Task 6 and consumed in Task 16. `useCreateRoundV2` is created in Task 4 and consumed in Task 19. `useListMyRounds` in Task 6 → consumed in Task 16. `useGetSoloRound`, `useUpdateSoloRound`, `useDeleteSoloRound` in Task 5 → consumed in Task 21. `useGetSoloRoundScores`, `useUpsertSoloRoundScore` in Task 20 → consumed in Task 21. The hook names match (Orval derives them from `operationId`). Schema names (`CreateRoundV2Body`, `CreateRoundV2Response`, `MyRoundsItem`) are referenced consistently.

**Placeholder scan:** None — every step has the actual content needed.
