# Moving from Replit to Vercel

One Vercel project serves both halves on one domain, same as Replit did:

- `/api/*` goes to a single Vercel Function running the existing Express app (`artifacts/api-server/src/serverless.ts`).
- Everything else is the static Vite build, with an `index.html` fallback for client-side routes.

`vercel.json` points the build at `scripts/vercel-build.mjs`, which writes `.vercel/output/` in Vercel's Build Output API format. No dashboard build settings are needed.

Vercel does not host Postgres itself, so the database moves to Neon (or Supabase; anything that gives you a `DATABASE_URL` works).

## 1. Create the database

1. Vercel dashboard → Storage → Create → Neon. Connect it to the project. This adds `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` to the project's env vars.
2. Keep `DATABASE_URL` on the **pooled** host (`-pooler` in the hostname). Serverless instances each open their own `pg.Pool`, and the direct endpoint runs out of connections fast.
3. Enable trigram search once:

```bash
psql "$NEON_DIRECT_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

## 2. Copy the data from Replit

Run the dump from the Replit shell, where `DATABASE_URL` already points at the Replit database. Do it right before you switch traffic so nothing written in between gets lost.

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl -Fc -f golf.dump
```

Download `golf.dump`, then restore into Neon with the **unpooled** URL (`pg_restore` doesn't work through PgBouncer):

```bash
pg_restore --no-owner --no-acl -d "$NEON_DIRECT_URL" golf.dump
```

Confirm the schema matches the code (this should report no changes):

```bash
DATABASE_URL="$NEON_DIRECT_URL" pnpm --filter @workspace/db run push
```

## 3. Set environment variables

Project → Settings → Environment Variables, for Production and Preview:

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL (set by the integration) |
| `JWT_SECRET` | **Copy the Replit value.** A new secret invalidates every existing 30-day session. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Same as Replit. The function refuses to start without them. |
| `GOLF_COURSE_API_KEY` | Same as Replit |
| `CRON_SECRET` | New random value, e.g. `openssl rand -hex 32`. Vercel sends it to the auto-close cron. |
| `LOG_LEVEL` | Optional |

Don't set `PORT` or `NODE_ENV`. The function sets `NODE_ENV=production` itself.

## 4. Import and deploy

1. Vercel → Add New → Project → import `reminiscent-io/golf-outing`. Leave Root Directory at the repo root, and leave Framework Preset as "Other". `vercel.json` sets install and build.
2. Deploy. Smoke test the preview URL:
   - `GET /api/healthz` returns `{"status":"ok"}`
   - Sign in with a real phone number
   - Open a trip and enter a score
   - Hard-refresh a deep link like `/trips/1` (checks the SPA fallback)
3. Project → Settings → Cron Jobs should list `/api/cron/auto-close` once a production deploy exists.

## 5. Cut over

- **Custom domain:** add it in Vercel, then repoint DNS. Users stay signed in because `localStorage` is per-origin and the origin doesn't change.
- **Moving off a `*.replit.app` URL:** every user signs in again on the new domain, and "which player am I" per-trip picks (`auth:trip:{tripId}`) reset. Shared trip links pointing at the old URL break unless Replit keeps serving a redirect.

Once Vercel is live and stable, stop the Replit deployment so two copies aren't writing to two databases.

## What behaves differently on Vercel

- **Auto-close runs daily (07:15 UTC) instead of hourly.** Hobby plans allow one cron run per day. Rounds still close the day after their date with a backdated `completedAt`, so feed order is unchanged. On Pro, change `AUTO_CLOSE_SCHEDULE` in `scripts/vercel-build.mjs` to `"15 * * * *"`.
- **No post-merge `db push`.** Replit's `[postMerge]` hook pushed schema changes automatically. On Vercel, run `pnpm --filter @workspace/db run push` against Neon yourself **before** merging a PR that changes `lib/db/src/schema/`.
- **OTP rate limit is per instance.** The 1-per-30s / 5-per-15m limiter in `routes/auth.ts` lives in memory, and concurrent instances don't share it. Twilio Verify's own per-number limits still apply. Moving the limiter into Postgres would make it global again.
- **Course lookup cache is per instance**, so GolfCourseAPI sees somewhat more calls.

## Replit leftovers to delete after cutover

`.replit`, `.replitignore`, `replit.md`, `artifacts/*/.replit-artifact/`, `scripts/post-merge.sh`, and the `@replit/vite-plugin-*` dependencies and imports in `artifacts/golf-scorecard/vite.config.ts`. They're kept for now so Replit can serve traffic until the switch. The linux-x64-only binary overrides in `package.json` / `pnpm-workspace.yaml` are fine to keep, because Vercel builds on linux-x64 (glibc).
