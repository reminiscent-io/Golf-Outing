import { isNotNull, eq } from "drizzle-orm";
import { db, pool, usersTable, userHandicapHistoryTable } from "@workspace/db";

async function main() {
  const users = await db
    .select({ id: usersTable.id, handicap: usersTable.handicap })
    .from(usersTable)
    .where(isNotNull(usersTable.handicap));

  let inserted = 0;
  let skipped = 0;
  for (const u of users) {
    if (u.handicap == null) continue;
    const [existing] = await db
      .select({ id: userHandicapHistoryTable.id })
      .from(userHandicapHistoryTable)
      .where(eq(userHandicapHistoryTable.userId, u.id))
      .limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(userHandicapHistoryTable).values({
      userId: u.id,
      handicap: u.handicap,
      source: "initial",
    });
    inserted++;
  }

  console.log(`Scanned ${users.length} user(s); inserted ${inserted}, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
