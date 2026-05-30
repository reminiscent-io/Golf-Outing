import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrate } from "./migrate-retire-personal-trips";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

describe("migrate-retire-personal-trips", () => {
  it("is idempotent — running twice on a clean DB reports zero work", async () => {
    if (!TEST_DATABASE_URL) {
      console.log("Skipping: set TEST_DATABASE_URL to run integration test");
      return;
    }
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      // First pass migrates whatever's there.
      await migrate(pool);
      // Second pass should be a no-op.
      const summary = await migrate(pool);
      assert.equal(summary.tripsRetired, 0);
      assert.equal(summary.roundsDetached, 0);
      assert.equal(summary.playersDetached, 0);
      assert.equal(summary.followsRemoved, 0);
    } finally {
      await pool.end();
    }
  });
});
