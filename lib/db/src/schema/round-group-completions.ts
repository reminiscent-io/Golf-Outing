import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { roundsTable } from "./rounds";
import { usersTable } from "./users";

// Tracks completion per foursome/group within a round. A round can have
// multiple groups sharing the same scorecard; each group marks its own round
// complete independently so finishing one group never flips another group's
// (or the whole round's) status. The round-level `rounds.completedAt` is only
// rolled up to "final" once every assigned group has a row here.
export const roundGroupCompletionsTable = pgTable("round_group_completions", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  groupNumber: integer("group_number").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => ({
  roundGroupUnique: uniqueIndex("round_group_completion_unique").on(t.roundId, t.groupNumber),
}));

export type RoundGroupCompletion = typeof roundGroupCompletionsTable.$inferSelect;
