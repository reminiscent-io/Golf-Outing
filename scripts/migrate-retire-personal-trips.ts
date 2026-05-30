/*
 * One-shot migration: retire kind='personal' trips.
 *
 * For each personal trip:
 *  - delete its user_trip_follows rows (defensive)
 *  - null out its rounds.trip_id (the rounds become solo)
 *  - null out its players.trip_id (the player row becomes the user's solo player)
 *  - delete the trip row
 *
 * Idempotent: running again finds zero personal trips.
 *
 * Run: pnpm tsx scripts/migrate-retire-personal-trips.ts
 */
import { Pool } from "pg";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

export type MigrationSummary = {
  tripsRetired: number;
  roundsDetached: number;
  playersDetached: number;
  followsRemoved: number;
};

export async function migrate(pool: Pool): Promise<MigrationSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tripsRes = await client.query<{ id: number }>(
      "SELECT id FROM trips WHERE kind = 'personal'",
    );
    const ids = tripsRes.rows.map(r => r.id);
    if (ids.length === 0) {
      await client.query("COMMIT");
      return { tripsRetired: 0, roundsDetached: 0, playersDetached: 0, followsRemoved: 0 };
    }

    const followsRes = await client.query(
      "DELETE FROM user_trip_follows WHERE trip_id = ANY($1::int[])",
      [ids],
    );
    const followsRemoved = followsRes.rowCount ?? 0;

    const roundsRes = await client.query(
      "UPDATE rounds SET trip_id = NULL WHERE trip_id = ANY($1::int[])",
      [ids],
    );
    const roundsDetached = roundsRes.rowCount ?? 0;

    const playersRes = await client.query(
      "UPDATE players SET trip_id = NULL WHERE trip_id = ANY($1::int[])",
      [ids],
    );
    const playersDetached = playersRes.rowCount ?? 0;

    const tripsDeleteRes = await client.query(
      "DELETE FROM trips WHERE id = ANY($1::int[])",
      [ids],
    );
    const tripsRetired = tripsDeleteRes.rowCount ?? 0;

    await client.query("COMMIT");
    return { tripsRetired, roundsDetached, playersDetached, followsRemoved };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const summary = await migrate(pool);
    console.log("Migration complete:", JSON.stringify(summary));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
