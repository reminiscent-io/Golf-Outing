import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Add column (nullable for backfill).
    await client.query(`
      ALTER TABLE round_group_assignments
      ADD COLUMN IF NOT EXISTS slot_index integer
    `);

    // 2. Backfill: rank by player_id within each (round_id, group_number).
    //    Scoped to rows where slot_index IS NULL so re-runs don't clobber
    //    any user-rearranged slot ordering from the UI.
    await client.query(`
      WITH ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY round_id, group_number
            ORDER BY player_id
          ) AS rn
        FROM round_group_assignments
        WHERE slot_index IS NULL
      )
      UPDATE round_group_assignments rga
      SET slot_index = ranked.rn
      FROM ranked
      WHERE rga.id = ranked.id
    `);

    // 3. Delete overflow rows (groups that had >4 players today).
    const overflow = await client.query(
      `DELETE FROM round_group_assignments WHERE slot_index > 4 RETURNING id`
    );
    console.log(`Deleted ${overflow.rowCount ?? 0} overflow assignment(s).`);

    // 4. Make NOT NULL and add unique index.
    await client.query(`
      ALTER TABLE round_group_assignments
      ALTER COLUMN slot_index SET NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS round_group_slot_unique
      ON round_group_assignments (round_id, group_number, slot_index)
    `);

    await client.query("COMMIT");
    console.log("Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
