import { pgTable, text, serial, integer, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tripsTable } from "./trips";
import { usersTable } from "./users";

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  tripId: integer("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  handicap: real("handicap").notNull().default(18),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // At most one solo-player row per user (rows where tripId IS NULL).
  uniqueIndex("players_solo_per_user").on(t.userId).where(sql`${t.tripId} IS NULL`),
]);

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
