import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tripsTable } from "./trips";

export const userTripFollowsTable = pgTable("user_trip_follows", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tripId: integer("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.tripId] }),
]);

export type UserTripFollow = typeof userTripFollowsTable.$inferSelect;
