import { pgTable, text, serial, integer, real, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  // Reserve this row for a specific person. E.164, normalized via normalizePhone.
  // null = open placeholder (claimable by anyone via the picker). Write-only; never serialized to clients.
  invitedPhone: text("invited_phone"),
  // Single-use share-link token. Cleared on claim. Write-only; never serialized to clients.
  claimCode: text("claim_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // At most one solo-player row per user (rows where tripId IS NULL).
  uniqueIndex("players_solo_per_user").on(t.userId).where(sql`${t.tripId} IS NULL`),
  // Sign-in claimable lookup: rows tagged to a phone. Partial — we only ever look up
  // non-null phones, and untagged/claimed rows (the majority) need not be indexed.
  index("players_invited_phone_idx").on(t.invitedPhone).where(sql`${t.invitedPhone} IS NOT NULL`),
  // Share-code lookup. Partial so the many NULLs don't collide on a unique index.
  uniqueIndex("players_claim_code_idx").on(t.claimCode).where(sql`${t.claimCode} IS NOT NULL`),
]);

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
