import { sql } from "drizzle-orm";
import { db, roundsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Auto-close rounds whose scheduled date is in the past.
 *
 * A round with a `date` of e.g. `2026-06-05` automatically closes (gets a
 * `completedAt`) starting the following calendar day — i.e. one day after the
 * round's date. `completedAt` is set to the logical close instant (midnight at
 * the start of the day after the round's date) rather than `now()`, so feed
 * ordering — which sorts on `coalesce(completedAt, updatedAt)` — stays
 * chronological even when the sweep runs long after the round ended (e.g. after
 * the autoscale instance has been idle).
 *
 * The `date` column is free-form text, so we only touch rows whose value is a
 * strict `YYYY-MM-DD` string; that guard guarantees the `::date` cast cannot
 * error on malformed input. Returns the number of rounds closed.
 */
export async function autoCloseOverdueRounds(): Promise<number> {
  const closed = await db
    .update(roundsTable)
    .set({
      completedAt: sql`(${roundsTable.date}::date + interval '1 day')`,
      updatedAt: new Date(),
    })
    .where(
      sql`${roundsTable.completedAt} is null
        and ${roundsTable.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and ${roundsTable.date}::date < current_date`,
    )
    .returning({ id: roundsTable.id });

  if (closed.length > 0) {
    logger.info({ count: closed.length }, "Auto-closed overdue rounds");
  }
  return closed.length;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Run an initial sweep, then keep sweeping on an interval. The interval is
 * `unref`'d so it never keeps the process alive on its own. Safe to call once
 * at startup. Failures are logged and swallowed so a transient DB hiccup never
 * crashes the server.
 */
export function startAutoCloseSweeper(intervalMs: number = ONE_HOUR_MS): void {
  const sweep = () => {
    autoCloseOverdueRounds().catch((err) => {
      logger.error({ err }, "Auto-close sweep failed");
    });
  };
  sweep();
  setInterval(sweep, intervalMs).unref();
}
