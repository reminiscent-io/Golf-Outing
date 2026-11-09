import type { IncomingMessage, ServerResponse } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { missingRequiredEnv, runStartupMigrations } from "./lib/startup";

// Vercel Function entry. Vercel calls the default export once per request;
// there is no listen() and no long-lived interval. The hourly auto-close
// sweeper is replaced by a Vercel Cron hitting GET /api/cron/auto-close
// (see routes/cron.ts and scripts/vercel-build.mjs).

const missingEnv = missingRequiredEnv();
if (missingEnv.length > 0) {
  // Throwing at module load fails every invocation with this message in the
  // function logs, the serverless equivalent of index.ts refusing to boot.
  throw new Error(
    `Missing required environment variable(s): ${missingEnv.join(", ")}`,
  );
}

// Run once per function instance. A failure is retried on the next request
// instead of poisoning the instance.
let migrations: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (!migrations) {
    migrations = runStartupMigrations().catch((err) => {
      migrations = null;
      throw err;
    });
  }
  return migrations;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await ensureMigrated();
  } catch (err) {
    logger.error({ err }, "Startup migrations failed");
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Service unavailable" }));
    return;
  }
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
