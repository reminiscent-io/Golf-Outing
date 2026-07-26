# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Golf Trip Live Scorecard — a full-stack live scoring app (trips, rounds, 18-hole grid entry, handicap-adjusted net scoring, auto-refreshing leaderboards, Stableford / Skins / Nassau / Net Stroke). See [replit.md](replit.md) for a higher-level product summary.

## Stack & package manager

- **pnpm workspace** (Node 24, TypeScript 5.9). The `preinstall` hook **rejects npm/yarn** — always use `pnpm`.
- **Frontend** (`artifacts/golf-scorecard`): React 19 + Vite 7 + Wouter + TanStack Query + Tailwind 4 + shadcn/ui (new-york style, `@/*` alias → `src/*`).
- **Backend** (`artifacts/api-server`): Express 5 + Pino + Drizzle ORM → PostgreSQL. Bundled to a single ESM file by [build.mjs](artifacts/api-server/build.mjs) using esbuild + esbuild-plugin-pino.
- **API contract**: OpenAPI YAML is the source of truth → Orval generates React Query hooks and Zod validators into `lib/api-client-react` and `lib/api-zod`.

## Workspace layout

| Package | Purpose |
|---|---|
| [lib/api-spec/openapi.yaml](lib/api-spec/openapi.yaml) | **Source of truth** for the HTTP API. Edit this, then run codegen. |
| [lib/api-client-react](lib/api-client-react/) | Orval-generated React Query hooks + shared [customFetch](lib/api-client-react/src/custom-fetch.ts) (handles base URL, auth header, JSON/text/blob parsing, `ApiError`). |
| [lib/api-zod](lib/api-zod/) | Orval-generated Zod v4 validators (coerces query/param/body, `useDates`, `useBigInt`). |
| [lib/db](lib/db/) | Drizzle schema + `pg.Pool`. Tables: `users`, `user_handicap_history`, `user_follows`, `user_trip_follows`, `trips`, `players` (incl. `invited_phone`/`claim_code` for phone-tag claiming), `rounds`, `round_group_assignments`, `round_group_completions`, `scores`, `scramble_scores`, `round_kudos`, `round_comments`, `round_player_tees`. |
| [artifacts/api-server](artifacts/api-server/) | Express server, routes in `src/routes/`, scoring algorithms in [src/lib/scoring.ts](artifacts/api-server/src/lib/scoring.ts). |
| [artifacts/golf-scorecard](artifacts/golf-scorecard/) | Main React app. Routes in [App.tsx](artifacts/golf-scorecard/src/App.tsx): `/` (feed when signed in, landing otherwise), `/landing`, `/my-golf`, `/me/trips` (redirect), `/trips`, `/trips/new`, `/trips/:tripId`, `/trips/:tripId/rounds/:roundId`, `/rounds/:roundId` (solo round), `/profile`, `/users/:userId`, `/claim/:code`, `/privacy`. |
| [scripts](scripts/) | One-off tsx scripts (e.g. `test-golf-course-api`). |

Catalog dependencies (`react`, `vite`, `zod`, etc.) are pinned centrally in [pnpm-workspace.yaml](pnpm-workspace.yaml) and referenced as `"catalog:"` in each package.json — bump versions there, not in individual packages. Internal packages are imported as `@workspace/<name>` via `workspace:*`.

TypeScript uses `customConditions: ["workspace"]` in [tsconfig.base.json](tsconfig.base.json), so workspace packages export `src/*.ts` **directly** (no build step needed for consumption). Only `lib/db`, `lib/api-client-react`, and `lib/api-zod` participate in project-reference builds (see root [tsconfig.json](tsconfig.json)).

## Commands

Top-level:
- `pnpm run typecheck` — typecheck all packages (project references + per-package `tsc --noEmit`).
- `pnpm run build` — typecheck then build every package that has a `build` script.

Codegen (run after editing the OpenAPI spec):
- `pnpm --filter @workspace/api-spec run codegen` — regenerates `api-client-react` and `api-zod`, then typechecks.

Database (Drizzle uses **push**, not migrations — dev workflow only):
- `pnpm --filter @workspace/db run push` — push schema to `DATABASE_URL`.
- `pnpm --filter @workspace/db run push-force` — same with `--force`.

Running locally:
- Both servers at once: `pnpm run dev` — runs [scripts/dev-local.sh](scripts/dev-local.sh), which sources `.env` and launches API on `API_PORT` (or `PORT`, default 3000) and UI on `UI_PORT` (default 5173).
- API server: `pnpm --filter @workspace/api-server run dev` — builds with esbuild then `node dist/index.mjs`. Requires `DATABASE_URL` and `PORT`.
- Scorecard UI: `pnpm --filter @workspace/golf-scorecard run dev` — requires `PORT` (enforced only for `vite serve`, not `vite build`).

Per-package typecheck: `pnpm --filter <name> run typecheck`.

## Environment variables

See [.env](.env) for the local set. Required:
- `DATABASE_URL` — Postgres connection string (thrown at import time if missing in `lib/db` or `drizzle.config.ts`).
- `PORT` — required for both the API server's `listen()` and the scorecard's `vite serve`/`preview`.
- `GOLF_COURSE_API_KEY` — server-side key for [GolfCourseAPI](https://api.golfcourseapi.com/v1); the browser never sees it. The `/api/course-lookup/*` routes in [courses.ts](artifacts/api-server/src/routes/courses.ts) proxy, normalize (always length-18 `par`/`holeHcp` arrays), and cache the upstream.

Auth (phone+OTP sign-in):
- `JWT_SECRET` — HMAC secret used to sign 30d session JWTs in [jwt.ts](artifacts/api-server/src/lib/jwt.ts). Required at startup in **all** environments — the server exits if it's missing (see `REQUIRED_ENV` in [index.ts](artifacts/api-server/src/index.ts)).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` — Twilio Verify credentials used by [twilio.ts](artifacts/api-server/src/lib/twilio.ts). Verify owns code generation, SMS delivery, and validation; we only call `startVerification` / `checkVerification`. If any are unset, the dev server still boots but **skips OTP sends and rejects every code** — fail-closed, no bypass code — so signing in locally requires real Twilio credentials. In production all three are required at startup.

Debugging sign-in: `pnpm --filter @workspace/scripts run twilio-doctor [+15551234567]` checks the credentials and the Verify service (no SMS, no charge) and, given a number, sends a real code and prints Twilio's exact error code. Verify failures are classified in [twilio.ts](artifacts/api-server/src/lib/twilio.ts) (`classifyTwilioError`) and mapped to status codes in [verify-response.ts](artifacts/api-server/src/lib/verify-response.ts), so a bad number is a 400, missing credentials a 500, Twilio's per-number send cap a 429, unreachable Twilio a 504, and only unclassified Twilio failures a 502. The server logs `twilioCode` plus an operator `hint` on every failure; API responses never carry that detail.

Optional: `BASE_PATH` (Vite base for subpath deploys, defaults `/`), `LOG_LEVEL`, `NODE_ENV`, `REPL_ID` (enables Replit cartographer/dev-banner plugins when non-production).

## Conventions to respect

- **Zod v4**: code imports from `zod/v4` even though the package is zod ^3 — this is the v4-compat entry and matches `drizzle-zod` usage. Don't "fix" this to `from "zod"`.
- **Supply-chain guard**: [pnpm-workspace.yaml](pnpm-workspace.yaml) sets `minimumReleaseAge: 1440` (24h). **Do not disable or lower it.** Add to `minimumReleaseAgeExclude` only for trusted publishers when urgently needed.
- **Linux-only binaries**: the root [package.json](package.json) overrides strip every non-`linux-x64` native binary (esbuild, lightningcss, rollup, tailwind oxide, etc.). This is intentional for Replit deploy. Don't remove these overrides.
- **Auth is phone+OTP**: A single user identity (phone number, full name) is verified by 6-digit SMS code and represented by a 30d JWT stored in `localStorage` key `auth:session` (see [auth.ts](artifacts/golf-scorecard/src/lib/auth.ts)). The web app wires the bearer via `setAuthTokenGetter` on module load. A signed-in user can have one **player** per trip (different display names per friend group), linked via `players.user_id`. The legacy per-trip `{ playerId, playerName }` localStorage (`auth:trip:{tripId}`) still drives "which player am I in this trip" via [useTripIdentity](artifacts/golf-scorecard/src/lib/trip-identity.ts).
- **Schema changes are push-based**: there's no `migrations/` directory. Edit `lib/db/src/schema/*.ts`, then `pnpm --filter @workspace/db run push`. The Replit `[postMerge]` hook in [.replit](.replit) runs [scripts/post-merge.sh](scripts/post-merge.sh), which re-runs `db push` automatically after every merge.
- **Generated code is checked in**: `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` are regenerated from OpenAPI; don't hand-edit. If something's wrong, edit the spec or the orval config.
- **Scoring logic lives server-side** in [scoring.ts](artifacts/api-server/src/lib/scoring.ts) — WHS Course Handicap, Stableford, Skins (with carry), Nassau. Keep it there so leaderboards stay consistent across clients.
- **Social & visibility model**: rounds either belong to a trip or stand alone — `rounds.trip_id` is nullable, and a null `trip_id` is a **solo round** (surfaced at `/rounds/:roundId`). Rounds have `visibility: public|private` and `completedAt` — both gate feed inclusion. Users have `profileVisibility: public|private` and `discoverableByPhone` — gate the profile page and phone-number search. Round attribution flows through `players.user_id` (per-trip identity) plus `rounds.created_by_user_id` (creator). The feed (`/feed?tab=buddies|mine|all`, see [feed.ts](artifacts/api-server/src/routes/feed.ts)) paginates on `coalesce(completedAt, updatedAt)` with a `before` cursor.
- **Phone-tag claiming & connections**: players can be pre-created with `invited_phone` + a `claim_code`; a phone-verified user claims them at `/claim/:code` (see [connections.ts](artifacts/api-server/src/routes/connections.ts)). Phone numbers are never emitted in API responses.
- **Trigram name search**: `users.full_name` has a GIN index using `gin_trgm_ops` (see [users.ts](lib/db/src/schema/users.ts)). The index requires the `pg_trgm` extension — `db push` does **not** create extensions, so run `CREATE EXTENSION IF NOT EXISTS pg_trgm;` against `DATABASE_URL` once per database before pushing.
- **Auth middleware**: routes requiring a signed-in user import `requireAuth` from [require-auth.ts](artifacts/api-server/src/middlewares/require-auth.ts) (sets `req.user.id`); routes that branch on optional auth use `optional-auth.ts`.

## Replit notes

This repo runs on Replit ([.replit](.replit), `deploymentTarget = "autoscale"`). The `[agent] expertMode = true` flag means Replit's agent is configured to trust manual package-manager operations — pnpm is the sole allowed tool. Port 8080 is the external entry; ports 8081 and 20768 are also mapped.
