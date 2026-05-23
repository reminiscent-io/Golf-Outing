import { pgTable, serial, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userHandicapHistoryTable = pgTable("user_handicap_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  handicap: real("handicap").notNull(),
  source: text("source", { enum: ["manual", "ghin", "initial"] }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("user_handicap_history_user_recorded_idx").on(t.userId, t.recordedAt.desc()),
]);

export type UserHandicapHistory = typeof userHandicapHistoryTable.$inferSelect;
