# ⛳ Card Caddie

Live scoring for golf trips. Everyone scores from their phone. Leaderboards update in real time.

## What It Does

Card Caddie runs your golf trip. Create a trip, add players, schedule rounds, and let the whole group score from their phones. Handicap-adjusted net scoring and four formats (Stableford, Skins, Nassau, Net Stroke) calculate automatically, and leaderboards refresh as scores come in.

## Features

- **Trip & round management** with player rosters and per-round group assignments
- **18-hole grid entry** optimized for thumb-typing on the course
- **Handicap-adjusted net scoring** using WHS Course Handicap
- **Four scoring formats**: Stableford, Skins (with carry), Nassau, Net Stroke
- **Live leaderboards** that auto-refresh as scores post
- **Solo rounds** outside any trip, and **scramble rounds** with team scoring
- **Per-player tees** with group-relative net adjustment
- **Social feed** (buddies / mine / all tabs) with round kudos and comments
- **Connections**: follow other golfers, claim pre-created players by phone tag at `/claim/:code`
- **Privacy controls**: public/private rounds and profiles, opt-in phone discoverability
- **Phone + OTP auth** via Twilio Verify, with 30-day session tokens
- **Course lookup** powered by GolfCourseAPI for tees, pars, and handicap data

## Tech Stack

**Frontend**
- React 19 + Vite 7
- Wouter for routing
- TanStack Query
- Tailwind CSS 4 + shadcn/ui (new-york variant)

**Backend**
- Express 5 + Pino logging
- Drizzle ORM
- PostgreSQL

**Infrastructure**
- pnpm workspace (Node 24, TypeScript 5.9)
- OpenAPI YAML as the source of truth, with Orval generating React Query hooks and Zod v4 validators
- Twilio for SMS-based OTP auth
- Deployed on Replit (autoscale)

## Project Structure

```
lib/
├── api-spec/         OpenAPI YAML (source of truth for the HTTP API)
├── api-client-react/ Orval-generated React Query hooks + customFetch
├── api-zod/          Orval-generated Zod validators
└── db/               Drizzle schema and Postgres pool

artifacts/
├── api-server/       Express API server (routes, scoring algorithms)
└── golf-scorecard/   Main React app
```

Internal packages are imported as `@workspace/<name>` via `workspace:*`. Catalog dependencies are pinned centrally in `pnpm-workspace.yaml`.

## Getting Started

### Prerequisites

- Node 24
- pnpm (the `preinstall` hook rejects npm and yarn)
- PostgreSQL database

### Install

```bash
pnpm install
```

### Environment

Create a `.env` at the repo root:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
PORT=8080

# Course data
GOLF_COURSE_API_KEY=your_key

# Auth
JWT_SECRET=your_long_random_secret

# SMS OTP via Twilio Verify (required in production)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
```

Twilio Verify owns OTP generation, delivery, and validation. If the Twilio variables are unset, the server still boots in dev but skips OTP sends and rejects every code — there is no bypass code, so signing in requires real Twilio credentials. In production the server refuses to start without them.

### Push the schema

```bash
pnpm --filter @workspace/db run push
```

There's no `migrations/` directory. Schema changes go through `db push`. Edit `lib/db/src/schema/*.ts` and re-push.

### Run

```bash
# Both servers at once (sources .env, runs API + UI)
pnpm run dev

# Or individually
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/golf-scorecard run dev
```

## Common Commands

```bash
pnpm run typecheck                              # typecheck all packages
pnpm run build                                  # typecheck then build everything
pnpm --filter @workspace/api-spec run codegen   # regenerate API client + validators after editing OpenAPI
pnpm --filter @workspace/db run push            # push Drizzle schema to DATABASE_URL
```

## Scoring

All scoring logic lives server-side in `artifacts/api-server/src/lib/scoring.ts` so leaderboards stay consistent across clients.

| Format | Description |
|---|---|
| **Stableford** | Points-based, configurable allocation |
| **Skins** | Hole-by-hole, carries on ties |
| **Nassau** | Front 9, back 9, overall |
| **Net Stroke** | Handicap-adjusted stroke play |

## Auth Model

A user identity (phone number + full name) is verified by 6-digit SMS code and represented by a 30-day JWT stored in `localStorage` under `auth:session`. A signed-in user can have one **player** per trip, with potentially different display names across friend groups. Players are linked to users via `players.user_id`.

## Conventions

- **Zod imports**: code imports from `zod/v4` even though the package is zod ^3. This is the v4-compat entry and matches `drizzle-zod` usage. Don't "fix" it.
- **Supply-chain guard**: `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (24 hours). Leave it alone.
- **Generated code is checked in**: `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` come from OpenAPI. Edit the spec, not the output.
- **Linux-only binaries**: native binary overrides for non-`linux-x64` are intentional for Replit deploy. Don't remove them.

---

Built by [Kevin Lowe](https://www.linkedin.com/in/kevin-lowe-5ab08164/) at [Reminiscent](https://reminiscent.io).
