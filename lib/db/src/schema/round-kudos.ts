import { pgTable, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { roundsTable } from "./rounds";

export const roundKudosTable = pgTable("round_kudos", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roundId] }),
  // Feed and social-aggregate queries count by roundId — keep that path indexed.
  index("round_kudos_round_idx").on(t.roundId),
]);

export type RoundKudos = typeof roundKudosTable.$inferSelect;
