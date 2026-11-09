#!/usr/bin/env node
// Vercel build: compiles the web app and API, then lays them out in Vercel's
// Build Output API format (https://vercel.com/docs/build-output-api) so the
// deploy is one project on one domain, with the same /api path split Replit
// used:
//
//   .vercel/output/static/              <- Vite build of golf-scorecard (SPA)
//   .vercel/output/functions/api.func/  <- esbuild bundle of api-server (Express)
//   .vercel/output/config.json          <- routes, cache headers, cron
//
// Run from the repo root: `node scripts/vercel-build.mjs` (vercel.json does).
import { execSync } from "node:child_process";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".vercel/output");
const webDist = path.join(root, "artifacts/golf-scorecard/dist/public");
const apiDist = path.join(root, "artifacts/api-server/dist");
const funcDir = path.join(out, "functions/api.func");

// Daily at 07:15 UTC. Rounds close the day after their date and get a
// backdated completedAt, so one sweep a day is enough (Hobby plan allows one
// cron run per day; on Pro this can go hourly: "15 * * * *").
const AUTO_CLOSE_SCHEDULE = "15 7 * * *";

function run(cmd, env = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}

run("pnpm --filter @workspace/golf-scorecard run build", { BASE_PATH: "/" });
run("pnpm --filter @workspace/api-server run build", { NODE_ENV: "production" });

await rm(out, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });

await cp(webDist, path.join(out, "static"), { recursive: true });

// The function gets serverless.mjs plus pino's worker files that esbuild
// emitted next to it. index.mjs (the long-running server) stays out.
for (const name of await readdir(apiDist)) {
  if (name.startsWith("index.mjs")) continue;
  await cp(path.join(apiDist, name), path.join(funcDir, name));
}

await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "serverless.mjs",
      launcherType: "Nodejs",
      // Express parses bodies itself; Vercel's req/res helpers would get in
      // its way.
      shouldAddHelpers: false,
      shouldAddSourcemapSupport: true,
      maxDuration: 30,
      // Set before the bundle loads so pino skips its pino-pretty transport.
      environment: { NODE_ENV: "production" },
    },
    null,
    2,
  ),
);

await writeFile(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Vite fingerprints everything under /assets, so it never changes.
        {
          src: "^/assets/(.*)$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        // The service worker and app shell must be revalidated or clients get
        // stuck on an old build.
        {
          src: "^/(sw\\.js|manifest\\.webmanifest|index\\.html)?$",
          headers: { "cache-control": "public, max-age=0, must-revalidate" },
          continue: true,
        },
        // Every /api request goes to the single Express function, which sees
        // the original path and routes it the same way it did on Replit.
        { src: "^/api(/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        // SPA fallback: Wouter handles /trips/:id etc. client-side.
        { src: "^/(.*)$", dest: "/index.html" },
      ],
      crons: [{ path: "/api/cron/auto-close", schedule: AUTO_CLOSE_SCHEDULE }],
    },
    null,
    2,
  ),
);

console.log(`Build output written to ${path.relative(root, out)}`);
