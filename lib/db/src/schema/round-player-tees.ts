import { pgTable, integer, real, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roundsTable } from "./rounds";
import { playersTable } from "./players";

// Sparse per-player tee overrides within a round. A player with NO row plays the
// round default tee (rounds.teeBox/courseRating/courseSlope/par/holeHcp). A row
// carries that player's COMPLETE tee card. Cascade-deletes with its round/player.
export const roundPlayerTeesTable = pgTable("round_player_tees", {
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  teeBox: text("tee_box"),
  courseRating: real("course_rating"),
  courseSlope: integer("course_slope"),
  par: jsonb("par").notNull().$type<number[]>(),
  holeHcp: jsonb("hole_hcp").notNull().$type<number[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.roundId, t.playerId] }),
]);

export const insertRoundPlayerTeeSchema = createInsertSchema(roundPlayerTeesTable).omit({ createdAt: true, updatedAt: true });
export type InsertRoundPlayerTee = z.infer<typeof insertRoundPlayerTeeSchema>;
export type RoundPlayerTee = typeof roundPlayerTeesTable.$inferSelect;
