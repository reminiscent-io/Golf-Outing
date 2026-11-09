import app from "./app";
import { logger } from "./lib/logger";
import { startAutoCloseSweeper } from "./lib/auto-close";
import { missingRequiredEnv, runStartupMigrations } from "./lib/startup";

// Long-running server entry (local dev, Replit). Vercel uses ./serverless.ts.

// Fail-fast: refuse to start if required secrets are absent.
// This prevents the server from booting into an insecure state where forged
// JWT tokens or missing Twilio credentials would silently bypass authentication.
const missingEnv = missingRequiredEnv();
if (missingEnv.length > 0) {
  // Use process.stderr.write so this is always visible regardless of log config
  process.stderr.write(
    `FATAL: Missing required environment variable(s): ${missingEnv.join(", ")}. Server will not start.\n`
  );
  process.exit(1);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runStartupMigrations()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      // Sweep overdue rounds now and hourly so they close ~a day after their date.
      startAutoCloseSweeper();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup migrations failed");
    process.exit(1);
  });
