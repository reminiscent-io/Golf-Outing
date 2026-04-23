# Simple Auth Gate + Per-Round Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-trip password gate, persisted player identity, and per-round foursome assignments so each golfer lands on their own group's rows when entering scores.

**Architecture:** Password stored on `trips.password` (plaintext, lowercased compare). Server-side verify endpoint; client localStorage holds `{ playerId, playerName }` per trip. New `round_group_assignments` table with batch PUT API. Drag/drop editor on the round Setup tab; scorecard defaults to the signed-in player's group with a toggle to "All players".

**Tech Stack:** pnpm workspace, TypeScript 5.9, Drizzle ORM + PostgreSQL, Express 5, OpenAPI 3.1 via Orval (generates TanStack Query hooks + Zod schemas), React 19 + Vite + Wouter + TanStack Query, native HTML5 drag/drop (no new dep).

**Spec:** [docs/superpowers/specs/2026-04-23-simple-auth-and-groups-design.md](../specs/2026-04-23-simple-auth-and-groups-design.md)

**Test strategy note:** This project has no test infrastructure today (see spec "Testing" section). Each task ends with a manual verification step + commit. We do not add a test runner as part of this plan.

---

## Task 0: Fix pre-existing typecheck errors (baseline)

The current `main` branch fails `pnpm run typecheck` with "Property 'queryKey' is missing" errors in [artifacts/golf-scorecard/src/pages/round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) and [artifacts/golf-scorecard/src/pages/trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx). We need a clean baseline before layering on new work. Root cause: Orval-generated hooks' `options.query` type is `UseQueryOptions<...>` which in TanStack Query v5 requires a `queryKey`; the hooks default it internally but the input type doesn't reflect that. Fix: pass `queryKey` explicitly using the existing `getXxxQueryKey` helpers.

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`
- Modify: `artifacts/golf-scorecard/src/pages/trip-hub.tsx`

- [ ] **Step 1: Confirm the baseline failure**

Run: `pnpm run typecheck`
Expected: fails with TS2741 errors in `round.tsx` (lines 94, 95, 97, 100) and `trip-hub.tsx` (lines 49, 50, 51, 53) — and TS2352 at `round.tsx:256` for `GamesConfig` cast.

- [ ] **Step 2: Import missing query-key helpers in round.tsx**

In `artifacts/golf-scorecard/src/pages/round.tsx`, update the import block (currently lines 4-14) to add `getGetRoundQueryKey` and `getListPlayersQueryKey`:

```ts
import {
  useGetRound,
  useListPlayers,
  useGetScores,
  useGetRoundLeaderboard,
  useUpsertScore,
  useUpdateRound,
  getGetRoundQueryKey,
  getListPlayersQueryKey,
  getGetScoresQueryKey,
  getGetRoundLeaderboardQueryKey,
  getGetTripLeaderboardQueryKey,
} from "@workspace/api-client-react";
```

- [ ] **Step 3: Add explicit queryKey to the four hook calls in round.tsx**

Replace the four hook calls around lines 94-101 with:

```tsx
  const { data: round, isLoading: roundLoading } = useGetRound(tripId, roundId, {
    query: { queryKey: getGetRoundQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: scoreRows, isLoading: scoresLoading } = useGetScores(tripId, roundId, {
    query: { queryKey: getGetScoresQueryKey(tripId, roundId), enabled: !!tripId && !!roundId, refetchInterval: 10000 },
  });
  const { data: leaderboard, isLoading: lbLoading } = useGetRoundLeaderboard(tripId, roundId, {
    query: { queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId), enabled: subTab === "results", refetchInterval: 10000 },
  });
```

- [ ] **Step 4: Fix the GamesConfig cast in round.tsx**

On line 256, the current cast `const gc = round.gamesConfig as Record<string, boolean>;` fails because `GamesConfig` includes arrays. Replace that line with:

```ts
      const gc = round.gamesConfig as unknown as Record<string, boolean>;
```

- [ ] **Step 5: Import missing query-key helpers in trip-hub.tsx**

In `artifacts/golf-scorecard/src/pages/trip-hub.tsx`, update the import block (currently lines 4-17) to add `getGetTripQueryKey`:

```ts
import {
  useGetTrip,
  useListPlayers,
  useListRounds,
  useGetTripLeaderboard,
  useCreatePlayer,
  useUpdatePlayer,
  useDeletePlayer,
  useCreateRound,
  useDeleteRound,
  getGetTripQueryKey,
  getListPlayersQueryKey,
  getListRoundsQueryKey,
  getGetTripLeaderboardQueryKey,
} from "@workspace/api-client-react";
```

- [ ] **Step 6: Add explicit queryKey to the four hook calls in trip-hub.tsx**

Replace the four hook calls around lines 49-57 with:

```tsx
  const { data: trip, isLoading: tripLoading } = useGetTrip(tripId, {
    query: { queryKey: getGetTripQueryKey(tripId), enabled: !!tripId },
  });
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: rounds } = useListRounds(tripId, {
    query: { queryKey: getListRoundsQueryKey(tripId), enabled: !!tripId },
  });
  const { data: leaderboard, isLoading: lbLoading } = useGetTripLeaderboard(tripId, {
    query: {
      queryKey: getGetTripLeaderboardQueryKey(tripId),
      enabled: !!tripId && tab === "leaderboard",
      refetchInterval: 10000,
    },
  });
```

- [ ] **Step 7: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (zero errors).

- [ ] **Step 8: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/round.tsx artifacts/golf-scorecard/src/pages/trip-hub.tsx
git commit -m "Fix TanStack Query v5 queryKey typecheck errors on main"
```

---

## Task 1: Add `password` column to trips schema + push

**Files:**
- Modify: `lib/db/src/schema/trips.ts`

- [ ] **Step 1: Edit the schema**

Replace [lib/db/src/schema/trips.ts](../../../lib/db/src/schema/trips.ts) with:

```ts
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tripsTable = pgTable("trips", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  password: text("password").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTripSchema = createInsertSchema(tripsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrip = z.infer<typeof insertTripSchema>;
export type Trip = typeof tripsTable.$inferSelect;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck:libs`
Expected: PASS.

- [ ] **Step 3: Push schema to dev database**

Run: `pnpm --filter @workspace/db run push`
Expected: Drizzle prompts confirm the new column. Accept it. Output ends with success.

- [ ] **Step 4: Verify the column exists**

Run: `psql "$DATABASE_URL" -c "\d trips"`
Expected: output includes `password | text | not null default ''`. (If `psql` isn't available, run a quick query via the API server instead — skip this step.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/trips.ts
git commit -m "Add password column to trips table"
```

---

## Task 2: Update OpenAPI schemas for Trip + CreateTripBody; regenerate

We don't want `password` to appear in any `Trip` response — it's write-only on create/update. We'll keep the response shape unchanged, add `password` to `CreateTripBody` (optional), and add `UpdateTripBody.password`.

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Edit CreateTripBody and UpdateTripBody**

In `lib/api-spec/openapi.yaml`, find the `CreateTripBody` schema (around line 461). Replace it and `UpdateTripBody` with:

```yaml
    CreateTripBody:
      type: object
      properties:
        name:
          type: string
        description:
          type: ["string", "null"]
        password:
          type: string
          description: Plaintext soft gate password. Stored lowercased-compared. Empty string disables the gate.
      required:
        - name

    UpdateTripBody:
      type: object
      properties:
        name:
          type: string
        description:
          type: ["string", "null"]
        password:
          type: string
```

Leave the `Trip` schema unchanged — password stays server-side only.

- [ ] **Step 2: Regenerate client**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: completes without errors; updates files under `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts
git commit -m "Add password to Create/UpdateTripBody; regenerate clients"
```

---

## Task 3: Add `POST /trips/:tripId/auth` endpoint

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/trips.ts`
- Regenerate via codegen

- [ ] **Step 1: Add the path + schemas to openapi.yaml**

In `lib/api-spec/openapi.yaml`, add this new path block immediately after the `/trips/{tripId}` path block (before `/trips/{tripId}/players`, around line 127):

```yaml
  /trips/{tripId}/auth:
    post:
      operationId: authenticateTrip
      tags: [trips]
      summary: Verify a trip's soft-gate password
      parameters:
        - name: tripId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/AuthenticateTripBody"
      responses:
        "200":
          description: Password accepted (or trip has no password set)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AuthenticateTripResponse"
        "401":
          description: Password rejected
        "404":
          description: Trip not found
```

In the `components.schemas` section (after `UpdateTripBody`, around line 478 after our Task 2 edit), add:

```yaml
    AuthenticateTripBody:
      type: object
      properties:
        password:
          type: string
      required:
        - password

    AuthenticateTripResponse:
      type: object
      properties:
        ok:
          type: boolean
      required:
        - ok
```

- [ ] **Step 2: Regenerate**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS. `useAuthenticateTrip` now exists in the client.

- [ ] **Step 3: Implement the server route**

In `artifacts/api-server/src/routes/trips.ts`, add these imports to the existing `@workspace/api-zod` import block:

```ts
  AuthenticateTripParams,
  AuthenticateTripBody,
  AuthenticateTripResponse,
```

Wait — check the generated `api-zod` to confirm the exact names. Orval generates `AuthenticateTripParams` for path params and `AuthenticateTripBody` for the body. If names differ after Step 2, use whatever is actually exported. To confirm: `grep "authenticateTrip\|AuthenticateTrip" lib/api-zod/src/generated/api.ts | head -10`.

Then, append this handler before the `export default router;` line (before line 76 in the pre-edit file):

```ts
router.post("/trips/:tripId/auth", async (req, res): Promise<void> => {
  const params = AuthenticateTripParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AuthenticateTripBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, params.data.tripId));
  if (!trip) {
    res.status(404).json({ error: "Trip not found" });
    return;
  }
  const stored = (trip.password ?? "").toLowerCase();
  const provided = parsed.data.password.toLowerCase();
  if (stored === "" || stored === provided) {
    res.json(AuthenticateTripResponse.parse({ ok: true }));
    return;
  }
  res.status(401).json({ error: "Password rejected" });
});
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Smoke-test the endpoint**

Start the API server in one terminal:
```
pnpm --filter @workspace/api-server run dev
```

In another terminal — after seeding a trip's password in Task 14, or with a trip whose password is `""` — call:
```
curl -s -X POST http://localhost:3000/api/trips/1/auth -H 'Content-Type: application/json' -d '{"password":"anything"}'
```
Expected (empty password trip): `{"ok":true}`.

Skip this verification if no trip exists yet — we'll do end-to-end smoke at Task 14.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts artifacts/api-server/src/routes/trips.ts
git commit -m "Add POST /trips/:tripId/auth endpoint"
```

---

## Task 4: Add `round_group_assignments` schema + push

**Files:**
- Create: `lib/db/src/schema/round-group-assignments.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Create `lib/db/src/schema/round-group-assignments.ts`:

```ts
import { pgTable, serial, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { roundsTable } from "./rounds";
import { playersTable } from "./players";

export const roundGroupAssignmentsTable = pgTable("round_group_assignments", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  groupNumber: integer("group_number").notNull(),
}, (t) => ({
  roundPlayerUnique: uniqueIndex("round_player_unique").on(t.roundId, t.playerId),
}));

export type RoundGroupAssignment = typeof roundGroupAssignmentsTable.$inferSelect;
```

- [ ] **Step 2: Re-export from the schema index**

Modify `lib/db/src/schema/index.ts`:

```ts
export * from "./trips";
export * from "./players";
export * from "./rounds";
export * from "./scores";
export * from "./round-group-assignments";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck:libs`
Expected: PASS.

- [ ] **Step 4: Push schema**

Run: `pnpm --filter @workspace/db run push`
Expected: Drizzle confirms new table and unique index. Accept.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/round-group-assignments.ts lib/db/src/schema/index.ts
git commit -m "Add round_group_assignments table"
```

---

## Task 5: Groups API (OpenAPI + Express routes)

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Create: `artifacts/api-server/src/routes/groups.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Add paths + schemas to openapi.yaml**

In `lib/api-spec/openapi.yaml`, add a `groups` tag to the tags list (after the `leaderboard` tag entry around line 22):

```yaml
  - name: groups
    description: Per-round foursome assignments
```

Add this path block after the `/trips/{tripId}/rounds/{roundId}/leaderboard` block (around line 411):

```yaml
  /trips/{tripId}/rounds/{roundId}/groups:
    get:
      operationId: listRoundGroups
      tags: [groups]
      summary: List foursome assignments for a round
      parameters:
        - name: tripId
          in: path
          required: true
          schema:
            type: integer
        - name: roundId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Group assignments
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoundGroupAssignments"
    put:
      operationId: putRoundGroups
      tags: [groups]
      summary: Replace all foursome assignments for a round
      parameters:
        - name: tripId
          in: path
          required: true
          schema:
            type: integer
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
              $ref: "#/components/schemas/RoundGroupAssignments"
      responses:
        "200":
          description: Saved assignments
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RoundGroupAssignments"
        "400":
          description: One or more players do not belong to this trip
        "404":
          description: Round not found or not part of the trip
```

Add to `components.schemas` (at the end, after `SkinHoleResult`):

```yaml
    RoundGroupAssignment:
      type: object
      properties:
        playerId:
          type: integer
        groupNumber:
          type: integer
      required:
        - playerId
        - groupNumber

    RoundGroupAssignments:
      type: object
      properties:
        assignments:
          type: array
          items:
            $ref: "#/components/schemas/RoundGroupAssignment"
      required:
        - assignments
```

- [ ] **Step 2: Regenerate client**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS. New hooks `useListRoundGroups` and `usePutRoundGroups` exist.

- [ ] **Step 3: Create the groups route file**

Create `artifacts/api-server/src/routes/groups.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, roundsTable, playersTable, roundGroupAssignmentsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import {
  ListRoundGroupsParams,
  PutRoundGroupsParams,
  PutRoundGroupsBody,
  ListRoundGroupsResponse,
  PutRoundGroupsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trips/:tripId/rounds/:roundId/groups", async (req, res): Promise<void> => {
  const params = ListRoundGroupsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [round] = await db.select().from(roundsTable).where(and(
    eq(roundsTable.id, params.data.roundId),
    eq(roundsTable.tripId, params.data.tripId),
  ));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  const rows = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    groupNumber: roundGroupAssignmentsTable.groupNumber,
  }).from(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, params.data.roundId));
  res.json(ListRoundGroupsResponse.parse(ser({ assignments: rows })));
});

router.put("/trips/:tripId/rounds/:roundId/groups", async (req, res): Promise<void> => {
  const params = PutRoundGroupsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = PutRoundGroupsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Verify round belongs to trip
  const [round] = await db.select().from(roundsTable).where(and(
    eq(roundsTable.id, params.data.roundId),
    eq(roundsTable.tripId, params.data.tripId),
  ));
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }

  const playerIds = parsed.data.assignments.map(a => a.playerId);

  // Verify every player belongs to the trip (empty array short-circuits)
  if (playerIds.length > 0) {
    const validPlayers = await db.select({ id: playersTable.id })
      .from(playersTable)
      .where(and(eq(playersTable.tripId, params.data.tripId), inArray(playersTable.id, playerIds)));
    if (validPlayers.length !== new Set(playerIds).size) {
      res.status(400).json({ error: "One or more players do not belong to this trip" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(roundGroupAssignmentsTable).where(eq(roundGroupAssignmentsTable.roundId, params.data.roundId));
    if (parsed.data.assignments.length > 0) {
      await tx.insert(roundGroupAssignmentsTable).values(
        parsed.data.assignments.map(a => ({
          roundId: params.data.roundId,
          playerId: a.playerId,
          groupNumber: a.groupNumber,
        }))
      );
    }
  });

  res.json(PutRoundGroupsResponse.parse(ser({ assignments: parsed.data.assignments })));
});

export default router;
```

- [ ] **Step 4: Register the router**

Modify `artifacts/api-server/src/routes/index.ts`:

```ts
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripsRouter from "./trips";
import playersRouter from "./players";
import roundsRouter from "./rounds";
import scoresRouter from "./scores";
import leaderboardRouter from "./leaderboard";
import coursesRouter from "./courses";
import groupsRouter from "./groups";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tripsRouter);
router.use(playersRouter);
router.use(roundsRouter);
router.use(scoresRouter);
router.use(leaderboardRouter);
router.use(coursesRouter);
router.use(groupsRouter);

export default router;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS. If you see "Cannot find name X" for one of the generated Zod schemas, run `grep "ListRoundGroups\|PutRoundGroups" lib/api-zod/src/generated/api.ts` to find the actual export names and update imports.

- [ ] **Step 6: Smoke-test**

Start the API server (`pnpm --filter @workspace/api-server run dev`), then from a trip with a round (IDs you know):

```
curl -s http://localhost:3000/api/trips/1/rounds/1/groups
```
Expected: `{"assignments":[]}`.

```
curl -s -X PUT http://localhost:3000/api/trips/1/rounds/1/groups \
  -H 'Content-Type: application/json' \
  -d '{"assignments":[{"playerId":1,"groupNumber":1}]}'
```
Expected: echoes the same body back.

Repeat the GET to verify it persists. If no trip/round/player exists yet, skip and rely on Task 14.

- [ ] **Step 7: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated lib/api-zod/src/index.ts artifacts/api-server/src/routes/groups.ts artifacts/api-server/src/routes/index.ts
git commit -m "Add GET/PUT /trips/:tripId/rounds/:roundId/groups endpoints"
```

---

## Task 6: Identity hook + localStorage helpers

**Files:**
- Create: `artifacts/golf-scorecard/src/lib/trip-identity.ts`

- [ ] **Step 1: Create the module**

Create `artifacts/golf-scorecard/src/lib/trip-identity.ts`:

```ts
import { useEffect, useState } from "react";

export type TripIdentity = { playerId: number; playerName: string };

const key = (tripId: number) => `auth:trip:${tripId}`;

function readIdentity(tripId: number): TripIdentity | null {
  try {
    const raw = localStorage.getItem(key(tripId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.playerId === "number" &&
      typeof parsed.playerName === "string"
    ) {
      return { playerId: parsed.playerId, playerName: parsed.playerName };
    }
    return null;
  } catch {
    return null;
  }
}

export function setTripIdentity(tripId: number, identity: TripIdentity): void {
  localStorage.setItem(key(tripId), JSON.stringify(identity));
  // Trigger storage listeners in the current tab
  window.dispatchEvent(new StorageEvent("storage", { key: key(tripId) }));
}

export function clearTripIdentity(tripId: number): void {
  localStorage.removeItem(key(tripId));
  window.dispatchEvent(new StorageEvent("storage", { key: key(tripId) }));
}

export function useTripIdentity(tripId: number): TripIdentity | null {
  const [identity, setIdentity] = useState<TripIdentity | null>(() => readIdentity(tripId));

  useEffect(() => {
    setIdentity(readIdentity(tripId));
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key === key(tripId)) {
        setIdentity(readIdentity(tripId));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tripId]);

  return identity;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/lib/trip-identity.ts
git commit -m "Add trip identity storage + React hook"
```

---

## Task 7: `TripAuthGate` component

**Files:**
- Create: `artifacts/golf-scorecard/src/components/trip-auth-gate.tsx`

- [ ] **Step 1: Create the component**

Create `artifacts/golf-scorecard/src/components/trip-auth-gate.tsx`:

```tsx
import { useState, type ReactNode } from "react";
import { useAuthenticateTrip, useListPlayers, getListPlayersQueryKey } from "@workspace/api-client-react";
import { useTripIdentity, setTripIdentity } from "@/lib/trip-identity";

type Props = {
  tripId: number;
  children: ReactNode;
};

export function TripAuthGate({ tripId, children }: Props) {
  const identity = useTripIdentity(tripId);
  const [step, setStep] = useState<"password" | "identity">("password");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | "">("");

  const authenticate = useAuthenticateTrip();
  const { data: players } = useListPlayers(tripId, {
    query: {
      queryKey: getListPlayersQueryKey(tripId),
      enabled: step === "identity",
    },
  });

  if (identity) {
    return <>{children}</>;
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    authenticate.mutate(
      { tripId, data: { password } },
      {
        onSuccess: () => setStep("identity"),
        onError: () => setPasswordError("Wrong password. Try again."),
      }
    );
  }

  function handleIdentitySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedPlayerId === "" || !players) return;
    const player = players.find(p => p.id === selectedPlayerId);
    if (!player) return;
    setTripIdentity(tripId, { playerId: player.id, playerName: player.name });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "hsl(158 65% 9%)" }}>
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: "hsl(42 45% 91%)" }}>
        <h2 className="text-xl font-serif mb-4" style={{ color: "hsl(38 30% 14%)" }}>
          {step === "password" ? "Trip access" : "Who are you?"}
        </h2>

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit}>
            <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Password
            </label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            {passwordError && (
              <div className="text-xs font-sans mb-3" style={{ color: "hsl(0 55% 40%)" }}>{passwordError}</div>
            )}
            <button
              type="submit"
              disabled={authenticate.isPending}
              className="w-full py-2.5 rounded-lg font-sans font-600 text-sm"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {authenticate.isPending ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "identity" && (
          <form onSubmit={handleIdentitySubmit}>
            <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Select your name
            </label>
            <select
              autoFocus
              value={selectedPlayerId}
              onChange={e => setSelectedPlayerId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            >
              <option value="">— choose —</option>
              {(players ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={selectedPlayerId === ""}
              className="w-full py-2.5 rounded-lg font-sans font-600 text-sm disabled:opacity-50"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              Enter
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/components/trip-auth-gate.tsx
git commit -m "Add TripAuthGate component"
```

---

## Task 8: Wire `TripAuthGate` into App routes

**Files:**
- Modify: `artifacts/golf-scorecard/src/App.tsx`

- [ ] **Step 1: Wrap trip and round routes**

Replace [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx) with:

```tsx
import { Switch, Route, Router as WouterRouter, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import TripsPage from "@/pages/trips";
import TripHubPage from "@/pages/trip-hub";
import RoundPage from "@/pages/round";
import { TripAuthGate } from "@/components/trip-auth-gate";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

function GatedTripHub() {
  const { tripId } = useParams<{ tripId: string }>();
  const id = Number(tripId);
  if (!id) return <NotFound />;
  return (
    <TripAuthGate tripId={id}>
      <TripHubPage />
    </TripAuthGate>
  );
}

function GatedRound() {
  const { tripId } = useParams<{ tripId: string; roundId: string }>();
  const id = Number(tripId);
  if (!id) return <NotFound />;
  return (
    <TripAuthGate tripId={id}>
      <RoundPage />
    </TripAuthGate>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={TripsPage} />
      <Route path="/trips/:tripId" component={GatedTripHub} />
      <Route path="/trips/:tripId/rounds/:roundId" component={GatedRound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/App.tsx
git commit -m "Wrap trip-scoped routes with TripAuthGate"
```

---

## Task 9: Add password field to "Create Trip" form

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/trips.tsx`

- [ ] **Step 1: Add state + input + submit payload**

In `artifacts/golf-scorecard/src/pages/trips.tsx`, after `const [tripName, setTripName] = useState("");` (line 19), add:

```tsx
  const [tripPassword, setTripPassword] = useState("");
```

Replace the `createTrip.mutate` call (lines 24-34) with:

```tsx
    createTrip.mutate(
      { data: { name: tripName.trim(), password: tripPassword } },
      {
        onSuccess: (trip) => {
          queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
          setShowCreate(false);
          setTripName("");
          setTripPassword("");
          navigate(`/trips/${trip.id}`);
        },
      }
    );
```

In the form JSX, after the trip-name `<input>` (ends around line 91), insert:

```tsx
            <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2 mt-3" style={{ color: "hsl(38 20% 38%)" }}>
              Password (optional)
            </label>
            <input
              type="password"
              value={tripPassword}
              onChange={e => setTripPassword(e.target.value)}
              placeholder="leave blank for open access"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{
                background: "white",
                color: "hsl(38 30% 14%)",
                border: "1.5px solid hsl(38 25% 72%)",
              }}
            />
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/trips.tsx
git commit -m "Add optional password field to trip creation form"
```

---

## Task 10: "Signed in as" header control

**Files:**
- Create: `artifacts/golf-scorecard/src/components/signed-in-as.tsx`
- Modify: `artifacts/golf-scorecard/src/pages/trip-hub.tsx`
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`

- [ ] **Step 1: Create the shared component**

Create `artifacts/golf-scorecard/src/components/signed-in-as.tsx`:

```tsx
import { useTripIdentity, clearTripIdentity } from "@/lib/trip-identity";

export function SignedInAs({ tripId }: { tripId: number }) {
  const identity = useTripIdentity(tripId);
  if (!identity) return null;
  return (
    <div className="text-xs font-sans flex items-center gap-2" style={{ color: "hsl(42 25% 60%)" }}>
      <span>Signed in as <strong style={{ color: "hsl(42 52% 59%)" }}>{identity.playerName}</strong></span>
      <span>·</span>
      <button
        onClick={() => clearTripIdentity(tripId)}
        className="underline hover:opacity-80"
        style={{ color: "hsl(42 35% 65%)" }}
      >
        switch
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount in trip-hub page header**

In `artifacts/golf-scorecard/src/pages/trip-hub.tsx`, add this import near the other local imports:

```ts
import { SignedInAs } from "@/components/signed-in-as";
```

Locate the trip-hub header element (the page's top `<div style={{ background: "hsl(158 65% 9%)" }}>` block — search for `trip?.name` to find it). Inside the max-width container, right below the trip name/description, render `<SignedInAs tripId={tripId} />`. Example insertion:

```tsx
        {trip?.description && (
          <p className="text-sm font-sans mt-1" style={{ color: "hsl(42 25% 60%)" }}>{trip.description}</p>
        )}
        <div className="mt-2">
          <SignedInAs tripId={tripId} />
        </div>
```

Place this `<div className="mt-2">` block immediately after whichever element renders the trip description (or name if description is absent). If the exact structure differs, put the component below the heading within the same header card, not outside the card.

- [ ] **Step 3: Mount in round page header**

In `artifacts/golf-scorecard/src/pages/round.tsx`, add the import:

```ts
import { SignedInAs } from "@/components/signed-in-as";
```

In the round header (the `<div className="px-4 pt-7 pb-4 ...">` block around line 344), insert after the round name/meta line, inside the `max-w-5xl mx-auto` container:

```tsx
          <div className="mt-2">
            <SignedInAs tripId={tripId} />
          </div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/components/signed-in-as.tsx artifacts/golf-scorecard/src/pages/trip-hub.tsx artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "Show signed-in player with switch control in trip and round headers"
```

---

## Task 11: `RoundGroupsEditor` component (drag/drop)

**Files:**
- Create: `artifacts/golf-scorecard/src/components/round-groups-editor.tsx`

- [ ] **Step 1: Create the component**

Create `artifacts/golf-scorecard/src/components/round-groups-editor.tsx`:

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

type Assignment = { playerId: number; groupNumber: number };

type Props = {
  tripId: number;
  roundId: number;
};

export function RoundGroupsEditor({ tripId, roundId }: Props) {
  const queryClient = useQueryClient();
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: groupsData } = useListRoundGroups(tripId, roundId, {
    query: { queryKey: getListRoundGroupsQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const putGroups = usePutRoundGroups();

  const serverAssignments: Assignment[] = groupsData?.assignments ?? [];

  // Derive the set of group numbers that should be shown. Start with server
  // groups; the user can locally append an empty Group N+1 via "Add group".
  const serverGroupNumbers = useMemo(() => {
    const s = new Set<number>(serverAssignments.map(a => a.groupNumber));
    // Always show at least Group 1 so there's somewhere to drop.
    s.add(1);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverAssignments]);

  const [extraGroups, setExtraGroups] = useState<number[]>([]);

  // Drop any "extra" groups that have since been populated on the server.
  useEffect(() => {
    setExtraGroups(prev => prev.filter(n => !serverGroupNumbers.includes(n)));
  }, [serverGroupNumbers]);

  const allGroupNumbers = useMemo(() => {
    const s = new Set<number>([...serverGroupNumbers, ...extraGroups]);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverGroupNumbers, extraGroups]);

  const assignmentByPlayer = useMemo(() => {
    const m = new Map<number, number>();
    serverAssignments.forEach(a => m.set(a.playerId, a.groupNumber));
    return m;
  }, [serverAssignments]);

  const unassignedPlayers = (players ?? []).filter(p => !assignmentByPlayer.has(p.id));

  function save(nextAssignments: Assignment[]) {
    putGroups.mutate(
      { tripId, roundId, data: { assignments: nextAssignments } },
      {
        onMutate: async () => {
          const qk = getListRoundGroupsQueryKey(tripId, roundId);
          await queryClient.cancelQueries({ queryKey: qk });
          const prev = queryClient.getQueryData(qk);
          queryClient.setQueryData(qk, { assignments: nextAssignments });
          return { prev };
        },
        onError: (_err, _vars, ctx) => {
          if (ctx?.prev !== undefined) {
            queryClient.setQueryData(getListRoundGroupsQueryKey(tripId, roundId), ctx.prev);
          }
          queryClient.invalidateQueries({ queryKey: getListRoundGroupsQueryKey(tripId, roundId) });
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: getListRoundGroupsQueryKey(tripId, roundId) });
        },
      }
    );
  }

  function movePlayer(playerId: number, toGroup: number | "unassigned") {
    const others = serverAssignments.filter(a => a.playerId !== playerId);
    const next = toGroup === "unassigned" ? others : [...others, { playerId, groupNumber: toGroup }];
    save(next);
  }

  function addGroup() {
    const nextNumber = (allGroupNumbers[allGroupNumbers.length - 1] ?? 0) + 1;
    setExtraGroups(prev => [...prev, nextNumber]);
  }

  function removeEmptyGroup(groupNumber: number) {
    // Only allowed for empty groups; handler skipped if any assignment matches.
    if (serverAssignments.some(a => a.groupNumber === groupNumber)) return;
    setExtraGroups(prev => prev.filter(n => n !== groupNumber));
  }

  function onDragStart(e: React.DragEvent, playerId: number) {
    e.dataTransfer.setData("text/plain", String(playerId));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent, target: number | "unassigned") {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const playerId = Number(raw);
    if (!playerId) return;
    movePlayer(playerId, target);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max py-2">
        <GroupColumn
          title="Unassigned"
          players={unassignedPlayers.map(p => ({ id: p.id, name: p.name }))}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={e => onDrop(e, "unassigned")}
        />
        {allGroupNumbers.map(gn => {
          const assigned = serverAssignments
            .filter(a => a.groupNumber === gn)
            .map(a => {
              const p = players?.find(pl => pl.id === a.playerId);
              return p ? { id: p.id, name: p.name } : null;
            })
            .filter((x): x is { id: number; name: string } => x !== null);
          const canRemove = assigned.length === 0 && extraGroups.includes(gn);
          return (
            <GroupColumn
              key={gn}
              title={`Group ${gn}`}
              players={assigned}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, gn)}
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

type GroupColumnProps = {
  title: string;
  players: Array<{ id: number; name: string }>;
  onDragStart: (e: React.DragEvent, playerId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onRemove?: () => void;
};

function GroupColumn({ title, players, onDragStart, onDragOver, onDrop, onRemove }: GroupColumnProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="min-w-[180px] w-[180px] rounded-xl p-3"
      style={{ background: "hsl(158 35% 14%)", border: "1px solid hsl(158 40% 20%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
          {title}
        </div>
        {onRemove && (
          <button onClick={onRemove} className="hover:opacity-80" style={{ color: "hsl(42 20% 55%)" }}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="space-y-2 min-h-[40px]">
        {players.map(p => (
          <div
            key={p.id}
            draggable
            onDragStart={e => onDragStart(e, p.id)}
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/golf-scorecard/src/components/round-groups-editor.tsx
git commit -m "Add RoundGroupsEditor with drag-and-drop assignment"
```

---

## Task 12: Mount `RoundGroupsEditor` in the Setup sub-tab

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`

- [ ] **Step 1: Import the editor**

Near the other local imports at the top of `artifacts/golf-scorecard/src/pages/round.tsx`:

```ts
import { RoundGroupsEditor } from "@/components/round-groups-editor";
```

- [ ] **Step 2: Render in the Setup tab**

Locate the Setup tab body (search for the conditional `subTab === "setup"`). Inside that block, add this section near the top of the Setup content (above the course lookup or par/hcp inputs — wherever makes sense for your layout):

```tsx
            <section className="mb-6">
              <h2 className="text-sm font-sans font-600 uppercase tracking-widest mb-3" style={{ color: "hsl(42 52% 59%)" }}>
                Groups
              </h2>
              <RoundGroupsEditor tripId={tripId} roundId={roundId} />
            </section>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "Mount RoundGroupsEditor in round Setup tab"
```

---

## Task 13: Scorecard filtering by group

**Files:**
- Modify: `artifacts/golf-scorecard/src/pages/round.tsx`

- [ ] **Step 1: Import identity + groups hooks**

Add to the `@workspace/api-client-react` import block in `round.tsx`:

```ts
  useListRoundGroups,
  getListRoundGroupsQueryKey,
```

Add the identity import:

```ts
import { useTripIdentity } from "@/lib/trip-identity";
```

- [ ] **Step 2: Fetch groups + compute filter**

Inside `RoundPage()`, after the `useGetRoundLeaderboard` call (around the existing line 101), add:

```tsx
  const identity = useTripIdentity(tripId);
  const { data: groupsData } = useListRoundGroups(tripId, roundId, {
    query: { queryKey: getListRoundGroupsQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const myGroupNumber: number | undefined = identity && groupsData
    ? groupsData.assignments.find(a => a.playerId === identity.playerId)?.groupNumber
    : undefined;

  const viewKey = `round:${roundId}:view`;
  const [viewMode, setViewMode] = useState<"mine" | "all">(() => {
    try {
      const stored = localStorage.getItem(viewKey);
      if (stored === "mine" || stored === "all") return stored;
    } catch {}
    return "mine";
  });
  useEffect(() => {
    try { localStorage.setItem(viewKey, viewMode); } catch {}
  }, [viewMode, viewKey]);

  const effectiveMode: "mine" | "all" = myGroupNumber === undefined ? "all" : viewMode;

  const groupPlayerIds = new Set<number>(
    (groupsData?.assignments ?? []).filter(a => a.groupNumber === myGroupNumber).map(a => a.playerId)
  );
  const visiblePlayers = effectiveMode === "mine" && myGroupNumber !== undefined
    ? (players ?? []).filter(p => groupPlayerIds.has(p.id))
    : (players ?? []);
```

- [ ] **Step 3: Use `visiblePlayers` instead of `players` in the scorecard grid**

Find every use of `players` inside the Scorecard sub-tab body (the `subTab === "scorecard"` block) that renders rows/cells — replace those with `visiblePlayers`. Keep the Setup tab and the `playingHcps` calculation using the full `players` list (handicap math should reflect the full field, not the filtered view).

As an anchor: the mapping like `players?.map(p => …)` inside the scorecard rendering becomes `visiblePlayers.map(p => …)`. The key-navigation helper inside `handleKeyDown` (around existing line 154) should also use `visiblePlayers` so Tab cycles within the visible group.

- [ ] **Step 4: Add the toggle above the grid**

Inside the Scorecard sub-tab body, render this toggle immediately above the scorecard grid — only if `myGroupNumber !== undefined`:

```tsx
              {myGroupNumber !== undefined && (
                <div className="flex items-center gap-2 mb-3 text-xs font-sans">
                  <button
                    onClick={() => setViewMode("mine")}
                    className="px-3 py-1.5 rounded-lg font-600"
                    style={{
                      background: viewMode === "mine" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                      color: viewMode === "mine" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
                    }}
                  >
                    My group
                  </button>
                  <button
                    onClick={() => setViewMode("all")}
                    className="px-3 py-1.5 rounded-lg font-600"
                    style={{
                      background: viewMode === "all" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                      color: viewMode === "all" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
                    }}
                  >
                    All players
                  </button>
                </div>
              )}
```

- [ ] **Step 5: Highlight the signed-in player's row**

For each row in the scorecard grid rendered from `visiblePlayers.map(...)`, add a conditional class/style so the signed-in player's row has a subtle ring. Example addition to the row container style:

```tsx
                    ...(identity?.playerId === p.id
                      ? { boxShadow: "inset 0 0 0 2px hsl(42 52% 59% / 0.6)" }
                      : {}),
```

Merge into the existing `style={{...}}` spread of the row wrapper. If the row doesn't already have a `style`, add one.

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "Default scorecard to signed-in player's group with toggle and highlight"
```

---

## Task 14: Seed Kiawah trip password + full end-to-end smoke test

**Files:**
- None (manual DB update + manual browser smoke).

- [ ] **Step 1: Seed the Kiawah trip password**

Start the API server once (`pnpm --filter @workspace/api-server run dev`), list trips to find the Kiawah trip's ID:

```
curl -s http://localhost:3000/api/trips | jq
```

With the ID (e.g. `1`), PATCH the password:

```
curl -s -X PATCH http://localhost:3000/api/trips/1 \
  -H 'Content-Type: application/json' \
  -d '{"password":"kiawah"}'
```

Verify authentication works:

```
curl -s -X POST http://localhost:3000/api/trips/1/auth -H 'Content-Type: application/json' -d '{"password":"KIAWAH"}'
```
Expected: `{"ok":true}` (case-insensitive).

```
curl -s -X POST http://localhost:3000/api/trips/1/auth -H 'Content-Type: application/json' -d '{"password":"nope"}'
```
Expected: HTTP 401.

- [ ] **Step 2: Run the frontend dev server**

Build / start the frontend per the project's pattern. The golf-scorecard `artifacts/golf-scorecard/package.json` will expose a `dev` script. Run it:

```
pnpm --filter @workspace/golf-scorecard run dev
```

Open the printed URL in a browser.

- [ ] **Step 3: Smoke tests — check each of the following**

Walk through these by hand and confirm each works:

1. On `/` trips list: unchanged behavior. Click the Kiawah trip.
2. Auth gate appears. Enter wrong password → "Wrong password" error.
3. Enter `KIAWAH` (any casing) → advances to identity step.
4. Dropdown shows all players on the trip. Select yourself → lands on trip hub.
5. Header shows "Signed in as <Name> • switch".
6. Open DevTools → Application → Local Storage. Confirm `auth:trip:1` = `{"playerId":N,"playerName":"..."}`.
7. Refresh the page. Gate is skipped.
8. Click "switch" → gate re-appears.
9. Click into a round → gate re-appears if you logged out; otherwise goes straight in.
10. Round page header also shows "Signed in as".
11. Setup tab: see the Groups section. Drag players between Unassigned, Group 1, and add a second group. Verify assignments persist across reload.
12. Scorecard tab: toggle visible only when your player has a group. Default shows just your group. Toggle to "All players" → shows everyone. Refresh preserves the toggle.
13. Your row is visually highlighted (ring) in both views.
14. Create a new trip without a password → open it → gate skips the password step but still asks for identity.

- [ ] **Step 4: Commit nothing, or a trivial doc note if you touched anything**

No code changes expected in this task.

---

## Plan self-review checklist

Before marking the plan done, confirm each spec requirement has a task:

- Password on trip (DB) → Task 1 ✓
- `POST /trips/:tripId/auth` endpoint → Task 3 ✓
- Password field on trip create form → Task 9 ✓
- `TripAuthGate` with two-step flow → Task 7 ✓
- localStorage identity + hook → Task 6 ✓
- "Signed in as" with switch → Task 10 ✓
- `round_group_assignments` table → Task 4 ✓
- Groups GET/PUT API → Task 5 ✓
- Drag/drop admin UI on Setup tab → Tasks 11-12 ✓
- Scorecard filter + toggle + highlight → Task 13 ✓
- Seed Kiawah password + E2E smoke → Task 14 ✓

## Risks & things to watch for

- **Generated-type naming:** Orval derives Zod / TanStack names from `operationId`. Task 3 and Task 5 introduce new operationIds (`authenticateTrip`, `listRoundGroups`, `putRoundGroups`); if Orval normalizes them differently than expected, the server-side imports in `@workspace/api-zod` will fail to resolve — grep the generated `api.ts` to find the real names and adjust.
- **Drizzle push prompts:** `pnpm --filter @workspace/db run push` is interactive. If you're running via a non-TTY agent, you may need to pass `--accept-data-loss` or use the non-interactive flag (check `pnpm --filter @workspace/db run push --help`).
- **Layout of round.tsx:** The file is large (~1000+ lines expected). When editing the Setup tab body (Task 12) and Scorecard tab body (Task 13), search for `subTab === "setup"` and `subTab === "scorecard"` to anchor your edits. If the conditionals render via a function/switch, adjust accordingly.
- **Password echoed in API:** The `Trip` schema deliberately omits `password` so GET responses never leak it. If any test or UI tries to read `trip.password`, that field won't exist — which is correct.
