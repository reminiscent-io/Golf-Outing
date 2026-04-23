# Workspace

## Overview

Golf Trip Live Scorecard — a full-stack app for live golf scoring with friends. Built as a pnpm workspace monorepo with TypeScript.

## Project: Golf Trip Scorecard

A live golf scorecard app supporting:
- Multiple golf trips with player management
- Per-round score entry (18-hole grid, mobile-friendly)
- Handicap-adjusted net scoring
- Game modes: Stableford, Skins, Nassau, Net Stroke
- Live leaderboard (auto-refreshes every 10s across all devices)
- Trip-wide standings aggregated across rounds

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (Wouter routing, TanStack Query)
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Fonts**: Fraunces (serif), Manrope (sans-serif)
- **Colors**: Forest green / cream / brass (heritage golf theme)

## Key Files

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — DB tables: trips, players, rounds, scores
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/scoring.ts` — Golf scoring algorithms
- `artifacts/golf-scorecard/src/pages/` — Frontend pages

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
