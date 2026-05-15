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
| [lib/db](lib/db/) | Drizzle schema + `pg.Pool`. Tables: `trips`, `players`, `rounds`, `scores`, `round_group_assignments`. |
| [artifacts/api-server](artifacts/api-server/) | Express server, routes in `src/routes/`, scoring algorithms in [src/lib/scoring.ts](artifacts/api-server/src/lib/scoring.ts). |
| [artifacts/golf-scorecard](artifacts/golf-scorecard/) | Main React app. Routes: `/`, `/trips/:tripId`, `/trips/:tripId/rounds/:roundId`. |
| [artifacts/mockup-sandbox](artifacts/mockup-sandbox/) | Standalone Vite app for design mockups (served at `/__mockup`). Not used at runtime. |
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
- API server: `pnpm --filter @workspace/api-server run dev` — builds with esbuild then `node dist/index.mjs`. Requires `DATABASE_URL` and `PORT`.
- Scorecard UI: `pnpm --filter @workspace/golf-scorecard run dev` — requires `PORT` (enforced only for `vite serve`, not `vite build`).
- Mockup sandbox: `pnpm --filter @workspace/mockup-sandbox run dev`.

Per-package typecheck: `pnpm --filter <name> run typecheck`.

## Environment variables

See [.env](.env) for the local set. Required:
- `DATABASE_URL` — Postgres connection string (thrown at import time if missing in `lib/db` or `drizzle.config.ts`).
- `PORT` — required for both the API server's `listen()` and the scorecard's `vite serve`/`preview`.
- `GOLF_COURSE_API_KEY` — server-side key for [GolfCourseAPI](https://api.golfcourseapi.com/v1); the browser never sees it. The `/api/course-lookup/*` routes in [courses.ts](artifacts/api-server/src/routes/courses.ts) proxy, normalize (always length-18 `par`/`holeHcp` arrays), and cache the upstream.

Auth (phone+OTP sign-in):
- `JWT_SECRET` — HMAC secret used to sign 30d session JWTs in [jwt.ts](artifacts/api-server/src/lib/jwt.ts). Must be set in production; defaults to a placeholder in dev (warn if relying on the placeholder).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` — Twilio Verify credentials used by [twilio.ts](artifacts/api-server/src/lib/twilio.ts). Verify owns code generation, SMS delivery, and validation; we only call `startVerification` / `checkVerification`. If any are unset, the server accepts the dev code `000000` and skips the Twilio round-trip (useful in dev).

Optional: `BASE_PATH` (Vite base for subpath deploys, defaults `/`), `LOG_LEVEL`, `NODE_ENV`, `REPL_ID` (enables Replit cartographer/dev-banner plugins when non-production).

## Conventions to respect

- **Zod v4**: code imports from `zod/v4` even though the package is zod ^3 — this is the v4-compat entry and matches `drizzle-zod` usage. Don't "fix" this to `from "zod"`.
- **Supply-chain guard**: [pnpm-workspace.yaml](pnpm-workspace.yaml) sets `minimumReleaseAge: 1440` (24h). **Do not disable or lower it.** Add to `minimumReleaseAgeExclude` only for trusted publishers when urgently needed.
- **Linux-only binaries**: the root [package.json](package.json) overrides strip every non-`linux-x64` native binary (esbuild, lightningcss, rollup, tailwind oxide, etc.). This is intentional for Replit deploy. Don't remove these overrides.
- **Auth is phone+OTP**: A single user identity (phone number, full name) is verified by 6-digit SMS code and represented by a 30d JWT stored in `localStorage` key `auth:session` (see [auth.ts](artifacts/golf-scorecard/src/lib/auth.ts)). The web app wires the bearer via `setAuthTokenGetter` on module load. A signed-in user can have one **player** per trip (different display names per friend group), linked via `players.user_id`. The legacy per-trip `{ playerId, playerName }` localStorage (`auth:trip:{tripId}`) still drives "which player am I in this trip" via [useTripIdentity](artifacts/golf-scorecard/src/lib/trip-identity.ts).
- **Schema changes are push-based**: there's no `migrations/` directory. Edit `lib/db/src/schema/*.ts`, then `pnpm --filter @workspace/db run push`. The Replit `[postMerge]` hook in [.replit](.replit) runs [scripts/post-merge.sh](scripts/post-merge.sh), which re-runs `db push` automatically after every merge.
- **Generated code is checked in**: `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` are regenerated from OpenAPI; don't hand-edit. If something's wrong, edit the spec or the orval config.
- **Scoring logic lives server-side** in [scoring.ts](artifacts/api-server/src/lib/scoring.ts) — WHS Course Handicap, Stableford, Skins (with carry), Nassau. Keep it there so leaderboards stay consistent across clients.

## Replit notes

This repo runs on Replit ([.replit](.replit), `deploymentTarget = "autoscale"`). The `[agent] expertMode = true` flag means Replit's agent is configured to trust manual package-manager operations — pnpm is the sole allowed tool. Port 8080 is the external entry; ports 8081 and 20768 are also mapped.
