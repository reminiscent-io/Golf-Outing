import { pgTable, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userFollowsTable = pgTable("user_follows", {
  followerId: integer("follower_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  followedId: integer("followed_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.followerId, t.followedId] }),
  // Reverse-lookup: "who follows :userId" needs an index keyed on followedId.
  index("user_follows_followed_idx").on(t.followedId),
]);

export type UserFollow = typeof userFollowsTable.$inferSelect;
