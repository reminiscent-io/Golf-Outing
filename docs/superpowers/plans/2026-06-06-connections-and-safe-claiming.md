# Connections & Safe Phone-Tag Claiming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Connections surface (people you've played with) plus a safe claiming flow so a tagged player can link their account via an OTP-verified phone match or a single-use share code — and no random account holder can ever claim a round.

**Architecture:** Security-critical logic lives in two pure, unit-tested lib modules (`claim.ts`, `connections.ts`) following the repo's existing "logic in `src/lib/`, routes are thin glue" pattern ([scoring.ts](../../../artifacts/api-server/src/lib/scoring.ts)). The DB gains two write-only columns on `players` (`invited_phone`, `claim_code`). The OpenAPI spec is the source of truth — new endpoints and schemas are added there, then Orval regenerates the React Query hooks and Zod validators. The frontend adds a Connections tab, a phone-tag field, share affordances, a claim-review modal, and a public `/claim/:code` landing page.

**Tech Stack:** Express 5 + Drizzle (PostgreSQL) backend; React 19 + Wouter + TanStack Query frontend; OpenAPI + Orval codegen; `tsx --test` (Node built-in test runner) for unit tests.

---

## Testing approach (read first)

This repo's test runner is `tsx --test src/lib/*.test.ts` — **pure-function unit tests only**, no DB/integration harness. So:

- **Tasks 2 & 3 are strict TDD** — the security guard and grouping logic are pure functions with colocated `*.test.ts` files. Write the test, watch it fail, implement, watch it pass.
- **Route and frontend tasks** are verified by `pnpm run typecheck`, successful codegen, and a documented manual check (curl with a dev token / UI smoke). We do **not** fabricate an integration-test framework that doesn't exist.

**Getting a dev bearer token** (Twilio unset in dev → OTP code is always `000000`):

```bash
# 1. Request OTP (creates/updates the user)
curl -s -X POST localhost:3000/api/auth/request-otp \
  -H 'content-type: application/json' \
  -d '{"phone":"+15551230001","fullName":"Test Tagger"}'
# 2. Verify to get a JWT
curl -s -X POST localhost:3000/api/auth/verify-otp \
  -H 'content-type: application/json' \
  -d '{"phone":"+15551230001","code":"000000","fullName":"Test Tagger"}'
# → copy the "token" field into $TOKEN for later curls
```

---

## Task 1: Add `invited_phone` and `claim_code` columns to the players schema

**Files:**
- Modify: [lib/db/src/schema/players.ts](../../../lib/db/src/schema/players.ts)

- [ ] **Step 1: Add the columns and indexes**

Replace the file's body with (adds two nullable columns + the `index` import + two indexes):

```ts
import { pgTable, text, serial, integer, real, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  // Reserve this row for a specific person. E.164, normalized via normalizePhone.
  // null = open placeholder (claimable by anyone via the picker). Write-only; never serialized to clients.
  invitedPhone: text("invited_phone"),
  // Single-use share-link token. Cleared on claim. Write-only; never serialized to clients.
  claimCode: text("claim_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // At most one solo-player row per user (rows where tripId IS NULL).
  uniqueIndex("players_solo_per_user").on(t.userId).where(sql`${t.tripId} IS NULL`),
  // Sign-in claimable lookup: rows tagged to a phone.
  index("players_invited_phone_idx").on(t.invitedPhone),
  // Share-code lookup. Partial so the many NULLs don't collide on a unique index.
  uniqueIndex("players_claim_code_idx").on(t.claimCode).where(sql`${t.claimCode} IS NOT NULL`),
]);

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/db run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Push the schema to the dev database**

Run: `pnpm --filter @workspace/db run push`
Expected: Drizzle reports adding `invited_phone`, `claim_code`, and the two indexes. No data loss prompts (columns are nullable, additive).

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/players.ts
git commit -m "feat(db): add invited_phone + claim_code to players for safe claiming"
```

---

## Task 2: Claim safety primitives (`src/lib/claim.ts`) — TDD

This module is **the security boundary**. Every property is unit-tested.

**Files:**
- Create: `artifacts/api-server/src/lib/claim.ts`
- Test: `artifacts/api-server/src/lib/claim.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/claim.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isClaimableByPhone,
  isClaimableByCode,
  canClaim,
  generateClaimCode,
  publicPlayer,
  type ClaimRow,
} from "./claim";

const open: ClaimRow = { userId: null, invitedPhone: null, claimCode: null };
const tagged: ClaimRow = { userId: null, invitedPhone: "+15551230001", claimCode: null };
const coded: ClaimRow = { userId: null, invitedPhone: null, claimCode: "SECRET" };
const claimed: ClaimRow = { userId: 7, invitedPhone: "+15551230001", claimCode: "SECRET" };

describe("isClaimableByPhone", () => {
  it("allows an open (untagged) unclaimed row for anyone", () => {
    assert.equal(isClaimableByPhone(open, "+15559999999"), true);
  });
  it("allows a tagged row only for the matching phone", () => {
    assert.equal(isClaimableByPhone(tagged, "+15551230001"), true);
    assert.equal(isClaimableByPhone(tagged, "+15559999999"), false);
  });
  it("never allows an already-claimed row", () => {
    assert.equal(isClaimableByPhone(claimed, "+15551230001"), false);
  });
});

describe("isClaimableByCode", () => {
  it("allows when the code matches an unclaimed coded row", () => {
    assert.equal(isClaimableByCode(coded, "SECRET"), true);
  });
  it("rejects a wrong, missing, or null code", () => {
    assert.equal(isClaimableByCode(coded, "WRONG"), false);
    assert.equal(isClaimableByCode(coded, null), false);
    assert.equal(isClaimableByCode(coded, undefined), false);
    assert.equal(isClaimableByCode(open, "SECRET"), false); // row has no code
  });
  it("never allows an already-claimed row even with the right code", () => {
    assert.equal(isClaimableByCode(claimed, "SECRET"), false);
  });
});

describe("canClaim", () => {
  it("is true when phone OR code authorizes", () => {
    assert.equal(canClaim(tagged, { callerPhone: "+15551230001" }), true);
    assert.equal(canClaim(coded, { callerPhone: "+15559999999", code: "SECRET" }), true);
  });
  it("is false when neither authorizes", () => {
    assert.equal(canClaim(tagged, { callerPhone: "+15559999999", code: "WRONG" }), false);
  });
});

describe("generateClaimCode", () => {
  it("returns a url-safe token and is unique per call", () => {
    const a = generateClaimCode();
    const b = generateClaimCode();
    assert.match(a, /^[A-Za-z0-9_-]{16,}$/);
    assert.notEqual(a, b);
  });
});

describe("publicPlayer", () => {
  it("strips invitedPhone and claimCode, keeps everything else", () => {
    const row = { id: 1, name: "Dave", invitedPhone: "+1555", claimCode: "x", userId: null };
    const pub = publicPlayer(row);
    assert.equal("invitedPhone" in pub, false);
    assert.equal("claimCode" in pub, false);
    assert.equal(pub.id, 1);
    assert.equal(pub.name, "Dave");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server run test`
Expected: FAIL — `Cannot find module './claim'`.

- [ ] **Step 3: Write the minimal implementation**

Create `artifacts/api-server/src/lib/claim.ts`:

```ts
import { randomBytes } from "node:crypto";

/** The minimal player-row shape the claim guard reasons about. */
export type ClaimRow = {
  userId: number | null;
  invitedPhone: string | null;
  claimCode: string | null;
};

/**
 * THE security boundary. A row may be claimed by a caller's verified phone iff it is
 * unclaimed AND either open (no tag) or tagged to exactly that phone.
 */
export function isClaimableByPhone(row: ClaimRow, callerPhone: string): boolean {
  if (row.userId !== null) return false;
  return row.invitedPhone === null || row.invitedPhone === callerPhone;
}

/** A row may be claimed via a share code iff it is unclaimed and the code matches exactly. */
export function isClaimableByCode(row: ClaimRow, code: string | null | undefined): boolean {
  if (row.userId !== null) return false;
  if (!code) return false;
  return row.claimCode !== null && row.claimCode === code;
}

/** Combined authorization used by the claim endpoint. */
export function canClaim(row: ClaimRow, opts: { callerPhone: string; code?: string | null }): boolean {
  return isClaimableByPhone(row, opts.callerPhone) || isClaimableByCode(row, opts.code);
}

/** Unguessable, URL-safe, single-use share token. */
export function generateClaimCode(): string {
  return randomBytes(18).toString("base64url");
}

/** Strip server-side-only fields so a player row is never leaked to clients. */
export function publicPlayer<T extends Record<string, unknown>>(
  row: T,
): Omit<T, "invitedPhone" | "claimCode"> {
  const rest = { ...row };
  delete (rest as Record<string, unknown>).invitedPhone;
  delete (rest as Record<string, unknown>).claimCode;
  return rest as Omit<T, "invitedPhone" | "claimCode">;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server run test`
Expected: PASS — all claim describe-blocks green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/claim.ts artifacts/api-server/src/lib/claim.test.ts
git commit -m "feat(api): claim safety primitives (phone/code guard, token, strip)"
```

---

## Task 3: Connections grouping (`src/lib/connections.ts`) — TDD

Pure grouping of co-player rows into accounts (by userId) and pending (by phone, else per trip+name). **Never emits a phone number.**

**Files:**
- Create: `artifacts/api-server/src/lib/connections.ts`
- Test: `artifacts/api-server/src/lib/connections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/connections.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupConnections, type CoPlayerRow } from "./connections";

function row(p: Partial<CoPlayerRow>): CoPlayerRow {
  return {
    playerId: 1, roundId: 1, tripId: 10, userId: null,
    name: "Dave", userFullName: null, invitedPhone: null, hasInvite: false,
    ...p,
  };
}

describe("groupConnections", () => {
  it("returns empty arrays for no rows", () => {
    assert.deepEqual(groupConnections([]), { accounts: [], pending: [] });
  });

  it("groups an account across rounds and counts distinct shared rounds", () => {
    const out = groupConnections([
      row({ playerId: 2, roundId: 100, userId: 5, userFullName: "Mike Real" }),
      row({ playerId: 2, roundId: 101, userId: 5, userFullName: "Mike Real" }),
    ]);
    assert.equal(out.accounts.length, 1);
    assert.equal(out.accounts[0]!.userId, 5);
    assert.equal(out.accounts[0]!.name, "Mike Real");
    assert.equal(out.accounts[0]!.sharedRounds, 2);
    assert.equal(out.pending.length, 0);
  });

  it("merges pending rows that share a phone across trips", () => {
    const out = groupConnections([
      row({ playerId: 3, roundId: 100, tripId: 10, invitedPhone: "+1555", name: "Dave" }),
      row({ playerId: 4, roundId: 200, tripId: 11, invitedPhone: "+1555", name: "Dave T" }),
    ]);
    assert.equal(out.pending.length, 1);
    assert.equal(out.pending[0]!.sharedRounds, 2);
    assert.deepEqual([...out.pending[0]!.playerIds].sort((a, b) => a - b), [3, 4]);
    assert.equal(out.pending[0]!.hasPhone, true);
    assert.equal(out.pending[0]!.tripId, 10); // representative (min-playerId) row's trip
  });

  it("does NOT merge same-named pending across different trips without a phone", () => {
    const out = groupConnections([
      row({ playerId: 3, roundId: 100, tripId: 10, name: "Dave" }),
      row({ playerId: 4, roundId: 200, tripId: 11, name: "Dave" }),
    ]);
    assert.equal(out.pending.length, 2);
  });

  it("flags hasInvite when a claim code exists and never leaks a phone", () => {
    const out = groupConnections([
      row({ playerId: 3, invitedPhone: "+1555", hasInvite: true }),
    ]);
    assert.equal(out.pending[0]!.hasInvite, true);
    assert.equal(JSON.stringify(out).includes("+1555"), false);
  });

  it("sorts accounts by sharedRounds descending", () => {
    const out = groupConnections([
      row({ playerId: 2, roundId: 1, userId: 5, userFullName: "One" }),
      row({ playerId: 3, roundId: 2, userId: 6, userFullName: "Two" }),
      row({ playerId: 3, roundId: 3, userId: 6, userFullName: "Two" }),
    ]);
    assert.deepEqual(out.accounts.map(a => a.userId), [6, 5]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server run test`
Expected: FAIL — `Cannot find module './connections'`.

- [ ] **Step 3: Write the minimal implementation**

Create `artifacts/api-server/src/lib/connections.ts`:

```ts
/** One co-player participation row (a placeholder/account assigned to a round I played). */
export type CoPlayerRow = {
  playerId: number;
  roundId: number;
  tripId: number | null;
  userId: number | null;
  name: string;                 // players.name (placeholder label)
  userFullName: string | null;  // linked user's profile name, when userId is set
  invitedPhone: string | null;  // SERVER-SIDE ONLY — used as a grouping key, never emitted
  hasInvite: boolean;           // a claim_code exists on the row
};

export type ConnectionAccount = {
  userId: number;
  name: string;
  sharedRounds: number;
};

export type ConnectionPending = {
  id: string;          // synthetic, PII-free client key
  name: string;
  tripId: number | null; // representative row's trip; phone-less groups are single-trip so this is unambiguous
  hasPhone: boolean;
  hasInvite: boolean;
  playerIds: number[];
  sharedRounds: number;
};

export type ConnectionsResult = {
  accounts: ConnectionAccount[];
  pending: ConnectionPending[];
};

export function groupConnections(rows: CoPlayerRow[]): ConnectionsResult {
  const accounts = new Map<number, { name: string; rounds: Set<number> }>();
  const pending = new Map<string, {
    name: string; tripId: number | null; hasPhone: boolean; hasInvite: boolean;
    playerIds: Set<number>; rounds: Set<number>; minPlayerId: number;
  }>();

  for (const r of rows) {
    if (r.userId !== null) {
      const a = accounts.get(r.userId) ?? { name: r.userFullName ?? r.name, rounds: new Set<number>() };
      a.rounds.add(r.roundId);
      accounts.set(r.userId, a);
      continue;
    }
    // Pending: group by phone when present, else by (tripId, lowercased name).
    // Solo (tripId null) without a phone stays per-row so distinct people never merge.
    const key = r.invitedPhone
      ? `phone:${r.invitedPhone}`
      : r.tripId === null
        ? `solo:${r.playerId}`
        : `trip:${r.tripId}:name:${r.name.trim().toLowerCase()}`;
    const p = pending.get(key) ?? {
      name: r.name, tripId: r.tripId, hasPhone: r.invitedPhone !== null, hasInvite: false,
      playerIds: new Set<number>(), rounds: new Set<number>(), minPlayerId: r.playerId,
    };
    p.playerIds.add(r.playerId);
    p.rounds.add(r.roundId);
    p.hasInvite = p.hasInvite || r.hasInvite;
    p.minPlayerId = Math.min(p.minPlayerId, r.playerId);
    pending.set(key, p);
  }

  return {
    accounts: [...accounts.entries()]
      .map(([userId, a]) => ({ userId, name: a.name, sharedRounds: a.rounds.size }))
      .sort((x, y) => y.sharedRounds - x.sharedRounds || x.userId - y.userId),
    pending: [...pending.values()]
      .map(p => ({
        id: `pending:${p.minPlayerId}`,
        name: p.name,
        tripId: p.tripId,
        hasPhone: p.hasPhone,
        hasInvite: p.hasInvite,
        playerIds: [...p.playerIds].sort((a, b) => a - b),
        sharedRounds: p.rounds.size,
      }))
      .sort((x, y) => y.sharedRounds - x.sharedRounds || x.playerIds[0]! - y.playerIds[0]!),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/connections.ts artifacts/api-server/src/lib/connections.test.ts
git commit -m "feat(api): connections grouping (accounts + pending, phone never emitted)"
```

---

## Task 4: OpenAPI spec + codegen

Add the write-only `invitedPhone` input field, the connection/claim/invite schemas, and the new paths. Then regenerate.

**Files:**
- Modify: [lib/api-spec/openapi.yaml](../../../lib/api-spec/openapi.yaml)
- Regenerated (do not hand-edit): `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

- [ ] **Step 1: Add `invitedPhone` to the two player request bodies**

In `components.schemas`, `CreatePlayerBody` (~line 1948) and `UpdatePlayerBody` (~line 1961) each currently list `name`/`handicap`/`userId` under `properties`. Add this property to **both** (do NOT add it to the `Player` response schema — that's what keeps it write-only):

```yaml
        invitedPhone:
          type: ["string", "null"]
          description: Optional phone (any format) reserving this row for a specific person; normalized server-side. Write-only — never returned.
```

- [ ] **Step 2: Add the new component schemas**

In `components.schemas`, after the `Buddy` schema (ends ~line 1559), add:

```yaml
    ConnectionAccount:
      type: object
      properties:
        userId: { type: integer }
        name: { type: string }
        sharedRounds: { type: integer }
      required: [userId, name, sharedRounds]

    ConnectionPending:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        tripId: { type: ["integer", "null"] }
        hasPhone: { type: boolean }
        hasInvite: { type: boolean }
        playerIds:
          type: array
          items: { type: integer }
        sharedRounds: { type: integer }
      required: [id, name, hasPhone, hasInvite, playerIds, sharedRounds]

    ConnectionsResponse:
      type: object
      properties:
        accounts:
          type: array
          items: { $ref: "#/components/schemas/ConnectionAccount" }
        pending:
          type: array
          items: { $ref: "#/components/schemas/ConnectionPending" }
      required: [accounts, pending]

    ClaimableRound:
      type: object
      properties:
        roundId: { type: integer }
        name: { type: string }
        date: { type: ["string", "null"] }
      required: [roundId, name]

    ClaimableItem:
      type: object
      properties:
        playerId: { type: integer }
        name: { type: string }
        tripId: { type: ["integer", "null"] }
        tripName: { type: ["string", "null"] }
        taggedBy: { type: ["string", "null"] }
        rounds:
          type: array
          items: { $ref: "#/components/schemas/ClaimableRound" }
      required: [playerId, name, rounds]

    ClaimPreview:
      type: object
      properties:
        playerId: { type: integer }
        name: { type: string }
        tripName: { type: ["string", "null"] }
        taggedBy: { type: ["string", "null"] }
        rounds:
          type: array
          items: { $ref: "#/components/schemas/ClaimableRound" }
      required: [playerId, name, rounds]

    ClaimRequestBody:
      type: object
      properties:
        accepts:
          type: array
          items: { type: integer }
        declines:
          type: array
          items: { type: integer }
        code: { type: ["string", "null"] }
      required: [accepts]

    ClaimSkip:
      type: object
      properties:
        playerId: { type: integer }
        reason: { type: string }
      required: [playerId, reason]

    ClaimResult:
      type: object
      properties:
        claimed:
          type: array
          items: { type: integer }
        skipped:
          type: array
          items: { $ref: "#/components/schemas/ClaimSkip" }
      required: [claimed, skipped]

    InviteResponse:
      type: object
      properties:
        code: { type: string }
        path: { type: string }
      required: [code, path]
```

- [ ] **Step 3: Add the new paths**

In the `paths:` section, after the `/users/me/buddies` block (ends ~line 446), add:

```yaml
  /users/me/connections:
    get:
      operationId: listMyConnections
      tags: [users]
      summary: People I've played with, split into accounts and pending placeholders
      security:
        - bearerAuth: []
      responses:
        "200":
          description: Connections
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ConnectionsResponse" }
        "401":
          description: Unauthorized

  /users/me/claimable:
    get:
      operationId: listMyClaimable
      tags: [users]
      summary: Player rows tagged to my verified phone that I can claim
      security:
        - bearerAuth: []
      responses:
        "200":
          description: Claimable items
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/ClaimableItem" }
        "401":
          description: Unauthorized

  /users/me/claims:
    post:
      operationId: submitClaims
      tags: [users]
      summary: Accept or decline tagged player rows (phone-matched or via a share code)
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ClaimRequestBody" }
      responses:
        "200":
          description: Claim result
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClaimResult" }
        "401":
          description: Unauthorized

  /claim/{code}:
    get:
      operationId: getClaimPreview
      tags: [players]
      summary: Public preview of what a share code claims
      parameters:
        - name: code
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Preview
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClaimPreview" }
        "404":
          description: Unknown or already-redeemed code

  /trips/{tripId}/players/{playerId}/invite:
    post:
      operationId: createPlayerInvite
      tags: [players]
      summary: Generate (or rotate) a single-use share code for an unclaimed player row
      security:
        - bearerAuth: []
      parameters:
        - name: tripId
          in: path
          required: true
          schema: { type: integer }
        - name: playerId
          in: path
          required: true
          schema: { type: integer }
      responses:
        "200":
          description: Invite code
          content:
            application/json:
              schema: { $ref: "#/components/schemas/InviteResponse" }
        "401":
          description: Unauthorized
        "403":
          description: Not a participant in this trip
        "409":
          description: Row already claimed
```

- [ ] **Step 4: Regenerate the client + validators**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: Orval regenerates `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`, then the bundled `typecheck:libs` passes. You should see new hooks (`useListMyConnections`, `useListMyClaimable`, `useSubmitClaims`, `useGetClaimPreview`, `useCreatePlayerInvite`) in the generated React Query files.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): connections, claim, and invite endpoints + invitedPhone input"
```

---

## Task 5: Players route — phone tagging, claim guard retrofit, response stripping, invite endpoint

**Files:**
- Modify: [artifacts/api-server/src/routes/players.ts](../../../artifacts/api-server/src/routes/players.ts)

- [ ] **Step 1: Update imports and the create/list handlers to tag phones and strip responses**

Replace the import block and the `GET`/`POST /trips/:tripId/players` handlers. New imports add `roundsTable`, `normalizePhone`, the claim lib, and `requireAuth`:

```ts
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, playersTable, usersTable, tripsTable, roundsTable, roundGroupAssignmentsTable } from "@workspace/db";
import { ser } from "../lib/serialize";
import { normalizePhone } from "../lib/otp";
import { isClaimableByPhone, generateClaimCode, publicPlayer } from "../lib/claim";
import {
  CreatePlayerBody,
  CreatePlayerParams,
  ListPlayersParams,
  ListPlayersResponse,
  UpdatePlayerBody,
  UpdatePlayerParams,
  UpdatePlayerResponse,
  DeletePlayerParams,
} from "@workspace/api-zod";
import { optionalAuth, type OptionallyAuthedRequest } from "../middlewares/optional-auth";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";

const router: IRouter = Router();

router.get("/trips/:tripId/players", async (req, res): Promise<void> => {
  const params = ListPlayersParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const players = await db.select().from(playersTable).where(eq(playersTable.tripId, params.data.tripId)).orderBy(playersTable.createdAt);
  res.json(ListPlayersResponse.parse(ser(players.map(publicPlayer))));
});

router.post("/trips/:tripId/players", optionalAuth, async (req: OptionallyAuthedRequest, res): Promise<void> => {
  const params = CreatePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // If caller is authed, auto-stamp the userId. Explicit body userId is also honored.
  const userId = parsed.data.userId ?? req.user?.id ?? null;
  // Optional phone tag: normalize to E.164; ignore garbage. Only meaningful on unclaimed rows.
  const invitedPhone = userId === null && parsed.data.invitedPhone
    ? normalizePhone(parsed.data.invitedPhone)
    : null;
  const [player] = await db.insert(playersTable).values({
    tripId: params.data.tripId,
    userId,
    name: parsed.data.name,
    handicap: parsed.data.handicap,
    invitedPhone,
  }).returning();
  res.status(201).json(publicPlayer(player));
});
```

- [ ] **Step 2: Retrofit the PATCH handler with the claim guard + phone tagging**

Replace the `PATCH /trips/:tripId/players/:playerId` handler. The key change: linking `userId` now also requires `isClaimableByPhone(existingRow, callerPhone)`, closing the picker hole. `invitedPhone` may be set/cleared only on an unclaimed row by an authed caller.

```ts
router.patch("/trips/:tripId/players/:playerId", optionalAuth, async (req: OptionallyAuthedRequest, res): Promise<void> => {
  const params = UpdatePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Load the existing row first — the claim guard needs its invited_phone / user_id.
  const [existing] = await db.select().from(playersTable)
    .where(and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId)));
  if (!existing) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.handicap !== undefined) updateData.handicap = parsed.data.handicap;

  // Linking a row to a user is explicit AND gated by the claim guard: a tagged row is
  // reserved for its phone, so a self-claim only succeeds on an open or phone-matched row.
  if (parsed.data.userId !== undefined && req.user) {
    if (parsed.data.userId === null) {
      updateData.userId = null;
    } else if (parsed.data.userId === req.user.id) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
      if (u && isClaimableByPhone(existing, u.phone)) {
        updateData.userId = req.user.id;
        // Claiming adopts the caller's profile name unless they also sent a name edit.
        if (parsed.data.name === undefined) updateData.name = u.fullName;
        updateData.invitedPhone = null;
        updateData.claimCode = null;
      } else {
        res.status(403).json({ error: "This player is reserved for someone else" });
        return;
      }
    }
  }

  // Phone tag may only be set/cleared by an authed caller on an unclaimed row.
  if (parsed.data.invitedPhone !== undefined && req.user && existing.userId === null && updateData.userId === undefined) {
    updateData.invitedPhone = parsed.data.invitedPhone ? normalizePhone(parsed.data.invitedPhone) : null;
  }

  const [player] = await db.update(playersTable).set(updateData)
    .where(and(eq(playersTable.id, params.data.playerId), eq(playersTable.tripId, params.data.tripId)))
    .returning();
  res.json(UpdatePlayerResponse.parse(ser(publicPlayer(player))));
});
```

- [ ] **Step 3: Add the invite endpoint before `export default router`**

The endpoint is **player-id-centric**: it looks the row up by `playerId` alone and derives the trip from the row, so the client never needs a correct `tripId` path value (it still passes the route's `:tripId`, but it's ignored). This also handles solo (tripless) rows.

```ts
router.post("/trips/:tripId/players/:playerId/invite", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const playerId = Number(req.params.playerId);
  const me = req.user!.id;
  if (!Number.isFinite(playerId)) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!row) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  if (row.userId !== null) {
    res.status(409).json({ error: "Already claimed" });
    return;
  }

  // Participant check: trip creator OR a linked player in the trip OR the creator of a
  // round that includes this player (covers solo/tripless rows too).
  let isParticipant = false;
  if (row.tripId !== null) {
    const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, row.tripId));
    const myPlayers = await db.select({ id: playersTable.id }).from(playersTable)
      .where(and(eq(playersTable.tripId, row.tripId), eq(playersTable.userId, me)));
    isParticipant = trip?.createdByUserId === me || myPlayers.length > 0;
  }
  if (!isParticipant) {
    const mine = await db.select({ id: roundsTable.id })
      .from(roundGroupAssignmentsTable)
      .innerJoin(roundsTable, eq(roundsTable.id, roundGroupAssignmentsTable.roundId))
      .where(and(eq(roundGroupAssignmentsTable.playerId, playerId), eq(roundsTable.createdByUserId, me)));
    isParticipant = mine.length > 0;
  }
  if (!isParticipant) {
    res.status(403).json({ error: "Not a participant in this trip" });
    return;
  }

  const code = generateClaimCode();
  await db.update(playersTable).set({ claimCode: code }).where(eq(playersTable.id, playerId));
  res.json({ code, path: `/claim/${code}` });
});
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual check (start the API, use a dev token from the top of this plan)**

```bash
# Create a trip + a tagged placeholder, confirm the response has NO invitedPhone:
curl -s -X POST localhost:3000/api/trips -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Test Trip"}'        # note the trip id as $TRIP
curl -s -X POST localhost:3000/api/trips/$TRIP/players -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Dave","handicap":12,"invitedPhone":"(555) 123-0002"}'
# Expected: JSON player WITHOUT an invitedPhone/claimCode field.
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/players.ts
git commit -m "feat(api): phone-tag players, gate self-claim by phone, invite codes, strip responses"
```

---

## Task 6: Connections + claim routes

A new focused router holding the four read/claim endpoints. Registered **before** the users router so the `/users/me/*` paths resolve cleanly.

**Files:**
- Create: `artifacts/api-server/src/routes/connections.ts`
- Modify: [artifacts/api-server/src/routes/index.ts](../../../artifacts/api-server/src/routes/index.ts)

- [ ] **Step 1: Create the router**

Create `artifacts/api-server/src/routes/connections.ts`:

```ts
import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, playersTable, usersTable, tripsTable, roundsTable, roundGroupAssignmentsTable,
} from "@workspace/db";
import { requireAuth, type AuthedRequest } from "../middlewares/require-auth";
import { optionalAuth, type OptionallyAuthedRequest } from "../middlewares/optional-auth";
import { groupConnections, type CoPlayerRow } from "../lib/connections";
import { canClaim } from "../lib/claim";

const router: IRouter = Router();

// GET /users/me/connections — co-players grouped into accounts + pending.
router.get("/users/me/connections", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;
  const rows = await db.execute<{
    player_id: number; round_id: number; trip_id: number | null;
    user_id: number | null; name: string; user_full_name: string | null;
    invited_phone: string | null; has_invite: boolean;
  }>(sql`
    WITH my_player_ids AS (
      SELECT id FROM ${playersTable} WHERE user_id = ${me}
    ),
    my_round_ids AS (
      SELECT DISTINCT round_id FROM ${roundGroupAssignmentsTable}
      WHERE player_id IN (SELECT id FROM my_player_ids)
    )
    SELECT
      p.id AS player_id, a.round_id AS round_id, p.trip_id AS trip_id,
      p.user_id AS user_id, p.name AS name, u.full_name AS user_full_name,
      p.invited_phone AS invited_phone, (p.claim_code IS NOT NULL) AS has_invite
    FROM ${roundGroupAssignmentsTable} a
    JOIN ${playersTable} p ON p.id = a.player_id
    LEFT JOIN ${usersTable} u ON u.id = p.user_id
    WHERE a.round_id IN (SELECT round_id FROM my_round_ids)
      AND p.id NOT IN (SELECT id FROM my_player_ids)
  `);

  const coRows: CoPlayerRow[] = (rows.rows ?? []).map(r => ({
    playerId: r.player_id, roundId: r.round_id, tripId: r.trip_id,
    userId: r.user_id, name: r.name, userFullName: r.user_full_name,
    invitedPhone: r.invited_phone, hasInvite: r.has_invite,
  }));
  res.json(groupConnections(coRows)); // invited_phone consumed for grouping, never emitted
});

// Build claimable/preview context (trip name, rounds, tagger) for a set of player rows.
async function claimContext(playerIds: number[]) {
  if (playerIds.length === 0) return new Map<number, { tripId: number | null; tripName: string | null; taggedBy: string | null; rounds: { roundId: number; name: string; date: string | null }[] }>();
  const assigns = await db.select({
    playerId: roundGroupAssignmentsTable.playerId,
    roundId: roundsTable.id, roundName: roundsTable.name, date: roundsTable.date,
    tripId: roundsTable.tripId, tripName: tripsTable.name,
    taggedBy: usersTable.fullName,
  })
    .from(roundGroupAssignmentsTable)
    .innerJoin(roundsTable, eq(roundsTable.id, roundGroupAssignmentsTable.roundId))
    .leftJoin(tripsTable, eq(tripsTable.id, roundsTable.tripId))
    .leftJoin(usersTable, eq(usersTable.id, roundsTable.createdByUserId))
    .where(inArray(roundGroupAssignmentsTable.playerId, playerIds));

  const map = new Map<number, { tripId: number | null; tripName: string | null; taggedBy: string | null; rounds: { roundId: number; name: string; date: string | null }[] }>();
  for (const a of assigns) {
    const e = map.get(a.playerId) ?? { tripId: a.tripId, tripName: a.tripName, taggedBy: a.taggedBy, rounds: [] };
    e.rounds.push({ roundId: a.roundId, name: a.roundName, date: a.date });
    map.set(a.playerId, e);
  }
  return map;
}

// GET /users/me/claimable — rows tagged to MY phone (auto-discovery on sign-in).
router.get("/users/me/claimable", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, me));
  if (!u) { res.json([]); return; }
  const rows = await db.select().from(playersTable)
    .where(and(eq(playersTable.invitedPhone, u.phone), sql`${playersTable.userId} IS NULL`));
  const ctx = await claimContext(rows.map(r => r.id));
  res.json(rows.map(r => {
    const c = ctx.get(r.id);
    return {
      playerId: r.id, name: r.name,
      tripId: c?.tripId ?? r.tripId ?? null, tripName: c?.tripName ?? null,
      taggedBy: c?.taggedBy ?? null, rounds: c?.rounds ?? [],
    };
  }));
});

// POST /users/me/claims — accept/decline, re-validated server-side per row.
router.post("/users/me/claims", requireAuth, async (req: AuthedRequest, res): Promise<void> => {
  const me = req.user!.id;
  const accepts: number[] = Array.isArray(req.body?.accepts) ? req.body.accepts : [];
  const declines: number[] = Array.isArray(req.body?.declines) ? req.body.declines : [];
  const code: string | null = typeof req.body?.code === "string" ? req.body.code : null;

  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, me));
  if (!u) { res.status(401).json({ error: "Unknown user" }); return; }

  const claimed: number[] = [];
  const skipped: { playerId: number; reason: string }[] = [];

  for (const playerId of accepts) {
    const [row] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!row) { skipped.push({ playerId, reason: "not_found" }); continue; }
    if (!canClaim(row, { callerPhone: u.phone, code })) {
      skipped.push({ playerId, reason: "not_authorized" });
      continue;
    }
    // Per-trip identity guard: don't create a second linked row for me in the same trip.
    if (row.tripId !== null) {
      const dupe = await db.select({ id: playersTable.id }).from(playersTable)
        .where(and(eq(playersTable.tripId, row.tripId), eq(playersTable.userId, me)));
      if (dupe.length > 0) { skipped.push({ playerId, reason: "already_in_trip" }); continue; }
    }
    await db.update(playersTable)
      .set({ userId: me, name: u.fullName, invitedPhone: null, claimCode: null })
      .where(eq(playersTable.id, playerId));
    claimed.push(playerId);
  }

  for (const playerId of declines) {
    await db.update(playersTable)
      .set({ invitedPhone: null, claimCode: null })
      .where(and(eq(playersTable.id, playerId), sql`${playersTable.userId} IS NULL`));
  }

  res.json({ claimed, skipped });
});

// GET /claim/:code — public preview of what a share code grants.
router.get("/claim/:code", optionalAuth, async (req: OptionallyAuthedRequest, res): Promise<void> => {
  const code = String(req.params.code);
  const [row] = await db.select().from(playersTable)
    .where(and(eq(playersTable.claimCode, code), sql`${playersTable.userId} IS NULL`));
  if (!row) { res.status(404).json({ error: "This invite is no longer valid" }); return; }
  const ctx = await claimContext([row.id]);
  const c = ctx.get(row.id);
  res.json({
    playerId: row.id, name: row.name,
    tripName: c?.tripName ?? null, taggedBy: c?.taggedBy ?? null, rounds: c?.rounds ?? [],
  });
});

export default router;
```

- [ ] **Step 2: Register the router before `usersRouter`**

In [index.ts](../../../artifacts/api-server/src/routes/index.ts), add the import and `router.use(...)` line **before** `usersRouter`:

```ts
import connectionsRouter from "./connections";
```

and in the `router.use(...)` block, place it just before `router.use(usersRouter);`:

```ts
router.use(connectionsRouter);
router.use(usersRouter);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual check (continuing from Task 5's $TRIP / Dave row)**

```bash
# Generate an invite for Dave's row (note Dave's playerId as $PID):
curl -s -X POST localhost:3000/api/trips/$TRIP/players/$PID/invite -H "authorization: Bearer $TOKEN"
# → {"code":"...","path":"/claim/..."} ; copy code as $CODE
# Public preview, no auth:
curl -s localhost:3000/api/claim/$CODE
# → {"playerId":...,"name":"Dave",...} with NO phone/code echoed.

# Sign in as Dave with the tagged number to see claimable + claim it:
#   request+verify OTP for +15551230002 → $DAVE_TOKEN
curl -s localhost:3000/api/users/me/claimable -H "authorization: Bearer $DAVE_TOKEN"   # lists Dave's row
curl -s -X POST localhost:3000/api/users/me/claims -H "authorization: Bearer $DAVE_TOKEN" \
  -H 'content-type: application/json' -d "{\"accepts\":[$PID]}"                          # {"claimed":[$PID],"skipped":[]}
# A DIFFERENT signed-in user must NOT be able to claim $PID:
curl -s -X POST localhost:3000/api/users/me/claims -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"accepts\":[$PID]}"                          # {"claimed":[],"skipped":[{...,"not_authorized"|"already...}]}
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/connections.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): connections + claimable/claims/claim-preview endpoints"
```

---

## Task 7: Frontend — Connections tab + list

**Files:**
- Create: `artifacts/golf-scorecard/src/components/connections-list.tsx`
- Modify: [artifacts/golf-scorecard/src/pages/my-golf.tsx](../../../artifacts/golf-scorecard/src/pages/my-golf.tsx)

- [ ] **Step 1: Create the Connections list component**

Create `artifacts/golf-scorecard/src/components/connections-list.tsx`:

```tsx
import { Link } from "wouter";
import { useListMyConnections, getListMyConnectionsQueryKey } from "@workspace/api-client-react";

const BRASS = "hsl(42 52% 59%)";
const FAINT = "hsl(42 25% 55%)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "·";
}

export function ConnectionsList() {
  const { data, isLoading } = useListMyConnections({
    query: { queryKey: getListMyConnectionsQueryKey() },
  });

  if (isLoading) {
    return <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>Loading…</div>;
  }
  const accounts = data?.accounts ?? [];
  const pending = data?.pending ?? [];
  if (accounts.length === 0 && pending.length === 0) {
    return (
      <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>
        No connections yet. Players you tag in rounds show up here — invite them to claim their scores.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-8">
      {accounts.length > 0 && (
        <section>
          <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: FAINT }}>On the app</h2>
          <ul className="space-y-2">
            {accounts.map(a => (
              <li key={`user:${a.userId}`}>
                <Link href={`/users/${a.userId}`} className="flex items-center gap-3 py-2">
                  <span className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
                        style={{ background: "hsl(158 35% 20%)", color: BRASS }}>{initials(a.name)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{a.name}</span>
                    <span className="block text-xs font-sans" style={{ color: FAINT }}>{a.sharedRounds} round{a.sharedRounds === 1 ? "" : "s"} together</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: FAINT }}>Not on the app yet</h2>
          <ul className="space-y-2">
            {pending.map(p => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
                      style={{ background: "hsl(42 20% 86%)", color: "hsl(42 30% 38%)" }}>{initials(p.name)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{p.name}</span>
                  <span className="block text-xs font-sans" style={{ color: FAINT }}>{p.sharedRounds} round{p.sharedRounds === 1 ? "" : "s"} together</span>
                </span>
                {/* Invite affordances added in Task 8 */}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the third tab into my-golf**

In [my-golf.tsx](../../../artifacts/golf-scorecard/src/pages/my-golf.tsx):

1. Add the import: `import { ConnectionsList } from "@/components/connections-list";`
2. Change the `Tab` type (line 10) to: `type Tab = "rounds" | "trips" | "connections";`
3. Replace the `tab` resolver (lines 25-29) so it recognizes `connections`:

```tsx
  const tab: Tab = useMemo(() => {
    const search = location.includes("?") ? location.slice(location.indexOf("?")) : "";
    const t = new URLSearchParams(search).get("tab");
    return t === "trips" ? "trips" : t === "connections" ? "connections" : "rounds";
  }, [location]);
```

4. Replace `setTab` (lines 32-34):

```tsx
  function setTab(next: Tab) {
    navigate(next === "rounds" ? "/my-golf" : `/my-golf?tab=${next}`, { replace: true });
  }
```

5. Add the tab button after the Trips button (line 75):

```tsx
            <TabButton active={tab === "connections"} onClick={() => setTab("connections")}>Connections</TabButton>
```

6. Replace the content switch (lines 81-85) so connections render:

```tsx
        {tab === "rounds" ? <MyRoundsList /> : tab === "connections" ? <ConnectionsList /> : (
          <div className="px-6 py-6">
            <MyTripsList session={session} />
          </div>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual UI smoke**

Run `pnpm run dev`, sign in, open `/my-golf?tab=connections`. Expected: the Connections tab is active; people from your rounds appear under "On the app" / "Not on the app yet" (or the empty-state copy if you have none yet).

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/components/connections-list.tsx artifacts/golf-scorecard/src/pages/my-golf.tsx
git commit -m "feat(ui): Connections tab listing co-players (accounts + pending)"
```

---

## Task 8: Frontend — phone-tag field on add-player + share/add-phone on pending connections

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx)
- Modify: `artifacts/golf-scorecard/src/components/connections-list.tsx`

- [ ] **Step 1: Add an optional phone field to the trip-hub add-player form**

In [trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx):

1. Add state beside the other player-form state (after line 134, `setNewPlayerHcp`):

```tsx
  const [newPlayerPhone, setNewPlayerPhone] = useState("");
```

2. Update `handleAddPlayer` (lines 163-174) to pass the phone and reset it:

```tsx
    createPlayer.mutate(
      { tripId, data: { name: newPlayerName.trim(), handicap: parseHandicap(newPlayerHcp), invitedPhone: newPlayerPhone.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) });
          queryClient.invalidateQueries({ queryKey: getGetTripLeaderboardQueryKey(tripId) });
          setShowAddPlayer(false);
          setNewPlayerName("");
          setNewPlayerHcp("18");
          setNewPlayerPhone("");
        },
      }
    );
```

3. In the add-player form JSX (the block guarded by `showAddPlayer`), add a phone input mirroring the existing name/handicap inputs. Place it after the handicap input, before the submit button:

```tsx
          <input
            type="tel"
            inputMode="tel"
            value={newPlayerPhone}
            onChange={(e) => setNewPlayerPhone(e.target.value)}
            placeholder="Phone to invite (optional)"
            className="w-full rounded-md border px-3 py-2 text-sm font-sans"
            style={{ borderColor: "hsl(42 20% 80%)" }}
          />
```

*(Match the exact `className`/`style` of the sibling name input already in that form so it looks native.)*

- [ ] **Step 2: Add share + add-phone affordances to pending connections**

Replace `artifacts/golf-scorecard/src/components/connections-list.tsx` with the version below — it adds, per pending person, a **Share invite** button (generates a code via the first playerId, builds the absolute URL, uses the Web Share API with clipboard fallback) and an **Add phone** inline input (PATCHes `invitedPhone`).

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyConnections, getListMyConnectionsQueryKey,
  useCreatePlayerInvite, useUpdatePlayer,
} from "@workspace/api-client-react";

const BRASS = "hsl(42 52% 59%)";
const FAINT = "hsl(42 25% 55%)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "·";
}

function shareUrl(code: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${window.location.origin}${base}claim/${code}`;
}

type Pending = { id: string; name: string; tripId: number | null; hasPhone: boolean; hasInvite: boolean; playerIds: number[]; sharedRounds: number };

function PendingRow({ p }: { p: Pending }) {
  const qc = useQueryClient();
  const createInvite = useCreatePlayerInvite();
  const updatePlayer = useUpdatePlayer();
  const [phone, setPhone] = useState("");
  const [showPhone, setShowPhone] = useState(false);
  const playerId = p.playerIds[0]!;
  // The invite route is player-id-centric (ignores tripId); the phone PATCH needs the real
  // trip, which is unambiguous here because "Add phone" only shows for phone-less groups,
  // and those are grouped per-trip. Fall back to 0 only to satisfy the route's path param.
  const tripId = p.tripId ?? 0;

  async function onShare() {
    const resp = await createInvite.mutateAsync({ tripId, playerId });
    const url = shareUrl(resp.code);
    try {
      if (navigator.share) await navigator.share({ title: "Claim your golf scores", url });
      else await navigator.clipboard.writeText(url);
    } catch { /* user cancelled share */ }
    qc.invalidateQueries({ queryKey: getListMyConnectionsQueryKey() });
  }

  function onSavePhone() {
    if (!phone.trim()) return;
    updatePlayer.mutate(
      { tripId, playerId, data: { invitedPhone: phone.trim() } },
      { onSuccess: () => { setShowPhone(false); setPhone(""); qc.invalidateQueries({ queryKey: getListMyConnectionsQueryKey() }); } },
    );
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
              style={{ background: "hsl(42 20% 86%)", color: "hsl(42 30% 38%)" }}>{initials(p.name)}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{p.name}</span>
          <span className="block text-xs font-sans" style={{ color: FAINT }}>
            {p.sharedRounds} round{p.sharedRounds === 1 ? "" : "s"} together{p.hasInvite ? " · invite sent" : ""}
          </span>
        </span>
        <button type="button" onClick={onShare} disabled={createInvite.isPending}
                className="text-[11px] font-sans font-semibold uppercase tracking-wider px-2 py-1 rounded-md"
                style={{ color: BRASS, border: `1px solid ${BRASS}` }}>
          {createInvite.isPending ? "…" : "Share"}
        </button>
        {!p.hasPhone && (
          <button type="button" onClick={() => setShowPhone(v => !v)}
                  className="text-[11px] font-sans px-2 py-1" style={{ color: FAINT }}>Add phone</button>
        )}
      </div>
      {showPhone && (
        <div className="flex gap-2 mt-2 pl-12">
          <input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)}
                 placeholder="Their phone number"
                 className="flex-1 rounded-md border px-3 py-1.5 text-sm font-sans" style={{ borderColor: "hsl(42 20% 80%)" }} />
          <button type="button" onClick={onSavePhone} disabled={updatePlayer.isPending}
                  className="text-[11px] font-sans font-semibold uppercase tracking-wider px-2 rounded-md"
                  style={{ background: BRASS, color: "hsl(38 30% 12%)" }}>Save</button>
        </div>
      )}
    </li>
  );
}

export function ConnectionsList() {
  const { data, isLoading } = useListMyConnections({ query: { queryKey: getListMyConnectionsQueryKey() } });

  if (isLoading) return <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>Loading…</div>;
  const accounts = data?.accounts ?? [];
  const pending = data?.pending ?? [];
  if (accounts.length === 0 && pending.length === 0) {
    return (
      <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>
        No connections yet. Players you tag in rounds show up here — invite them to claim their scores.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-8">
      {accounts.length > 0 && (
        <section>
          <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: FAINT }}>On the app</h2>
          <ul className="space-y-2">
            {accounts.map(a => (
              <li key={`user:${a.userId}`}>
                <Link href={`/users/${a.userId}`} className="flex items-center gap-3 py-2">
                  <span className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
                        style={{ background: "hsl(158 35% 20%)", color: BRASS }}>{initials(a.name)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{a.name}</span>
                    <span className="block text-xs font-sans" style={{ color: FAINT }}>{a.sharedRounds} round{a.sharedRounds === 1 ? "" : "s"} together</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: FAINT }}>Not on the app yet</h2>
          <ul className="space-y-1">
            {pending.map(p => (<PendingRow key={p.id} p={p} />))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

*(The invite endpoint built in Task 5 is already player-id-centric and handles solo rows, so the `tripId` passed here doesn't need to be correct — `p.tripId` is supplied for the phone-PATCH, which is unambiguous for phone-less pending groups.)*

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual UI smoke**

`pnpm run dev`: in the trip hub, add a player with a phone → confirm no error. On `/my-golf?tab=connections`, a pending person shows **Share** (produces a `/claim/<code>` URL via share sheet/clipboard) and **Add phone** (saves, row flips to having a phone).

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/trip-hub.tsx artifacts/golf-scorecard/src/components/connections-list.tsx
git commit -m "feat(ui): phone-tag on add-player; share invite + add-phone on connections"
```

---

## Task 9: Frontend — claim-review modal + `/claim/:code` landing page

**Files:**
- Create: `artifacts/golf-scorecard/src/components/claim-review-modal.tsx`
- Create: `artifacts/golf-scorecard/src/pages/claim-landing.tsx`
- Modify: [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx)

- [ ] **Step 1: Create the claim-review modal (auto-discovery on sign-in)**

Create `artifacts/golf-scorecard/src/components/claim-review-modal.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyClaimable, getListMyClaimableQueryKey, useSubmitClaims,
  getListMyConnectionsQueryKey,
} from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/auth";

const NAV_BG = "hsl(158 65% 9%)";
const BRASS = "hsl(42 52% 59%)";
const CREAM = "hsl(42 45% 88%)";

export function ClaimReviewModal() {
  const session = useAuthSession();
  const qc = useQueryClient();
  const submit = useSubmitClaims();
  const [dismissed, setDismissed] = useState(false);

  const { data: claimable } = useListMyClaimable({
    query: { queryKey: getListMyClaimableQueryKey(), enabled: !!session },
  });

  const items = claimable ?? [];
  if (!session || dismissed || items.length === 0) return null;

  function resolve(accepts: number[], declines: number[]) {
    submit.mutate({ data: { accepts, declines } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMyClaimableQueryKey() });
        qc.invalidateQueries({ queryKey: getListMyConnectionsQueryKey() });
        setDismissed(true);
      },
    });
  }

  const allIds = items.map(i => i.playerId);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: "hsla(158,40%,6%,0.7)" }}>
      <div className="w-full max-w-md rounded-xl p-6" style={{ background: NAV_BG, border: "1px solid hsl(158 40% 18%)" }}>
        <h2 className="font-serif text-xl" style={{ color: BRASS }}>You were tagged in {items.length} round{items.length === 1 ? "" : "s"}</h2>
        <p className="text-sm font-sans mt-1 mb-4" style={{ color: CREAM }}>Claim your scores so they show up on your profile.</p>
        <ul className="space-y-2 mb-5 max-h-64 overflow-auto">
          {items.map(i => (
            <li key={i.playerId} className="text-sm font-sans" style={{ color: CREAM }}>
              <span className="font-semibold">{i.rounds[0]?.name ?? i.name}</span>
              {i.tripName ? <span style={{ color: BRASS }}> · {i.tripName}</span> : null}
              {i.taggedBy ? <span className="block text-xs" style={{ color: "hsl(42 25% 65%)" }}>tagged by {i.taggedBy}</span> : null}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button type="button" disabled={submit.isPending} onClick={() => resolve(allIds, [])}
                  className="flex-1 rounded-full py-2.5 text-xs font-sans font-semibold uppercase tracking-wider"
                  style={{ background: BRASS, color: "hsl(38 30% 12%)" }}>Claim all</button>
          <button type="button" disabled={submit.isPending} onClick={() => resolve([], allIds)}
                  className="rounded-full px-4 py-2.5 text-xs font-sans uppercase tracking-wider"
                  style={{ color: CREAM, border: "1px solid hsl(158 40% 25%)" }}>Not me</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the `/claim/:code` landing page**

Create `artifacts/golf-scorecard/src/pages/claim-landing.tsx`:

```tsx
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetClaimPreview, getGetClaimPreviewQueryKey, useSubmitClaims } from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";

const NAV_BG = "hsl(158 65% 9%)";
const BRASS = "hsl(42 52% 59%)";
const CREAM = "hsl(42 45% 88%)";

export default function ClaimLandingPage() {
  const { code } = useParams<{ code: string }>();
  const session = useAuthSession();
  const submit = useSubmitClaims();
  const [, navigate] = useLocation();
  const [done, setDone] = useState(false);

  const { data: preview, isLoading, isError } = useGetClaimPreview(code, {
    query: { queryKey: getGetClaimPreviewQueryKey(code) },
  });

  function claim() {
    if (!preview) return;
    submit.mutate({ data: { accepts: [preview.playerId], code } }, {
      onSuccess: () => { setDone(true); navigate("/my-golf?tab=connections", { replace: true }); },
    });
  }

  return (
    <div className="min-h-dvh grid place-items-center p-6" style={{ background: NAV_BG }}>
      <div className="w-full max-w-md text-center">
        {isLoading && <p className="font-sans text-sm" style={{ color: CREAM }}>Loading…</p>}
        {isError && <p className="font-sans text-sm" style={{ color: CREAM }}>This invite is no longer valid.</p>}
        {preview && (
          <>
            <h1 className="font-serif text-2xl mb-2" style={{ color: BRASS }}>Claim {preview.name}’s scores</h1>
            <p className="font-sans text-sm mb-6" style={{ color: CREAM }}>
              {preview.rounds[0]?.name ?? "A round"}{preview.tripName ? ` · ${preview.tripName}` : ""}
              {preview.taggedBy ? ` — tagged by ${preview.taggedBy}` : ""}
            </p>
            {session ? (
              <button type="button" onClick={claim} disabled={submit.isPending || done}
                      className="rounded-full px-6 py-3 text-xs font-sans font-semibold uppercase tracking-wider"
                      style={{ background: BRASS, color: "hsl(38 30% 12%)" }}>
                {done ? "Claimed" : "Yes, this is me"}
              </button>
            ) : (
              <SignInModal open onClose={() => navigate("/", { replace: true })}
                           onSignedIn={claim} title="Sign in to claim your scores" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

*(If `SignInModal`'s `onSignedIn` doesn't fire post-auth in this flow, the page re-renders with `session` set and the user taps "Yes, this is me" — either path works.)*

- [ ] **Step 3: Mount the route and the global modal in App.tsx**

In [App.tsx](../../../artifacts/golf-scorecard/src/App.tsx):

1. Add imports:

```tsx
import ClaimLandingPage from "@/pages/claim-landing";
import { ClaimReviewModal } from "@/components/claim-review-modal";
```

2. Add the public route inside `<Switch>` (before the catch-all `NotFound`, after line 248's `/privacy`):

```tsx
        <Route path="/claim/:code" component={ClaimLandingPage} />
```

3. Render the modal inside `Router()` right after `<NavBar />`:

```tsx
      <NavBar />
      <ClaimReviewModal />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual end-to-end smoke**

`pnpm run dev`. As user A: create a round, tag "Dave" with phone `+15551230002`. Open the Connections tab → Share Dave → copy the `/claim/<code>` URL. In a fresh browser/incognito open that URL → preview shows "Claim Dave's scores" → sign in as `+15551230002` (code `000000`) → claim → lands on Connections. Separately, signing in as `+15551230002` *without* the link should pop the **ClaimReviewModal** automatically (phone-matched discovery). Verify a *different* phone sees neither the link claim succeed (server returns `not_authorized`) nor the auto-modal.

- [ ] **Step 6: Commit**

```bash
git add artifacts/golf-scorecard/src/components/claim-review-modal.tsx artifacts/golf-scorecard/src/pages/claim-landing.tsx artifacts/golf-scorecard/src/App.tsx
git commit -m "feat(ui): claim-review modal + /claim/:code landing page"
```

---

## Final verification

- [ ] **Run the full suite**

```bash
pnpm run typecheck                              # all packages
pnpm --filter @workspace/api-server run test    # claim + connections unit tests green
```

- [ ] **Security spot-check (the whole point):** Confirm that a signed-in user whose phone does **not** match a tag, and who has **no** share code, receives `not_authorized` from `POST /users/me/claims` for that row, and that the picker (`PATCH .../players/:id` with `userId`) returns `403` for a phone-reserved row. Both are exercised in Task 6 Step 4 — re-run them.

---

## Self-review notes (author)

- **Spec coverage:** core guard (Tasks 2, 5, 6) ✓; `invited_phone`/`claim_code` columns (Task 1) ✓; Connections derivation reusing the buddies pattern but via group assignments + including placeholders (Tasks 3, 6) ✓; phone tagging on create/update + share invite (Tasks 5, 8) ✓; review-&-confirm claim, phone + code paths, server re-validation (Tasks 6, 9) ✓; `/claim/:code` preview (Tasks 6, 9) ✓; name adoption at claim (Tasks 5, 6) ✓; per-trip identity guard (Task 6) ✓; never serialize phone/code (Tasks 2, 5, 6) ✓; codegen/contract (Task 4) ✓; UI surfaces (Tasks 7–9) ✓.
- **Deferred per spec:** external history / "played with me" feed and reach-out — not in this plan. ✓
- **Type consistency:** `ClaimRow`, `CoPlayerRow`, `publicPlayer`, `canClaim`, `groupConnections`, and the generated hook names (`useListMyConnections`, `useListMyClaimable`, `useSubmitClaims`, `useGetClaimPreview`, `useCreatePlayerInvite`) are used consistently across tasks.
