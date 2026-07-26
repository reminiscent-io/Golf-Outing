import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { startAutoCloseSweeper } from "./lib/auto-close";
import { verifyConfigStatus } from "./lib/twilio";

// Fail-fast: refuse to start if required secrets are absent.
// This prevents the server from booting into an insecure state where forged
// JWT tokens or missing Twilio credentials would silently bypass authentication.
const REQUIRED_ENV: string[] = ["JWT_SECRET"];
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION) {
  REQUIRED_ENV.push("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID");
}
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  // Use process.stderr.write so this is always visible regardless of log config
  process.stderr.write(
    `FATAL: Missing required environment variable(s): ${missingEnv.join(", ")}. Server will not start.\n`
  );
  process.exit(1);
}

// Report Twilio Verify config at boot so a broken sign-in is diagnosable from
// the startup logs alone, without waiting for a user to hit a 5xx.
const verifyConfig = verifyConfigStatus();
if (!verifyConfig.configured) {
  logger.warn(
    { missing: verifyConfig.missing },
    "Twilio Verify is NOT configured — OTP sends are skipped and all codes are rejected"
  );
} else {
  logger.info("Twilio Verify credentials present");
}
for (const warning of verifyConfig.warnings) {
  logger.warn({ warning }, "Twilio Verify credential looks wrong");
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

async function runStartupMigrations() {
  const client = await pool.connect();
  try {
    // Add slot_index column if it's missing
    const colRes = await client.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'round_group_assignments' AND column_name = 'slot_index'
    `);
    const columnExists = Number(colRes.rows[0]?.count ?? 0) > 0;
    if (!columnExists) {
      await client.query(`DELETE FROM round_group_assignments`);
      await client.query(`ALTER TABLE round_group_assignments ADD COLUMN slot_index integer NOT NULL DEFAULT 1`);
      await client.query(`ALTER TABLE round_group_assignments ALTER COLUMN slot_index DROP DEFAULT`);
    }

    // Create the unique index — if it can't be created due to stale duplicate data,
    // clear the table first (data without a valid slot_index is unusable anyway).
    const idxRes = await client.query<{ count: string }>(`
      SELECT COUNT(*) as count FROM pg_indexes
      WHERE tablename = 'round_group_assignments' AND indexname = 'round_group_slot_unique'
    `);
    const indexExists = Number(idxRes.rows[0]?.count ?? 0) > 0;
    if (!indexExists) {
      await client.query(`DELETE FROM round_group_assignments`);
      await client.query(`
        CREATE UNIQUE INDEX round_group_slot_unique
          ON round_group_assignments (round_id, group_number, slot_index)
      `);
    }

    logger.info("Startup migrations complete");
  } finally {
    client.release();
  }
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
