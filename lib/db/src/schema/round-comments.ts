import { pgTable, serial, integer, text, timestamp, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { roundsTable } from "./rounds";

export const roundCommentsTable = pgTable("round_comments", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Self-reference — Drizzle requires the explicit AnyPgColumn cast on the lambda.
  parentCommentId: integer("parent_comment_id").references((): AnyPgColumn => roundCommentsTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("round_comments_round_created_idx").on(t.roundId, t.createdAt),
  index("round_comments_parent_idx").on(t.parentCommentId),
]);

export type RoundComment = typeof roundCommentsTable.$inferSelect;
