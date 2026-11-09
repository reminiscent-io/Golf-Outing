import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Names of required environment variables that are missing. JWT_SECRET is
 * always required; Twilio Verify credentials are required in production so a
 * misconfigured deploy can't boot into a state that silently rejects or
 * bypasses sign-in.
 */
export function missingRequiredEnv(): string[] {
  const required = ["JWT_SECRET"];
  if (process.env.NODE_ENV === "production") {
    required.push("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID");
  }
  return required.filter((key) => !process.env[key]);
}

/**
 * One-off fixes for databases created before `slot_index` existed. On a
 * database created by `db push` from the current schema both checks are
 * no-ops.
 */
export async function runStartupMigrations(): Promise<void> {
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
