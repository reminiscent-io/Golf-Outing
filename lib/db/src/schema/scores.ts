import { pgTable, serial, integer, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roundsTable } from "./rounds";
import { playersTable } from "./players";

export const scoresTable = pgTable("scores", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  holeScores: jsonb("hole_scores").notNull().$type<(number | null)[]>().default(Array(18).fill(null)),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("scores_round_player_unique").on(t.roundId, t.playerId),
]);

export const insertScoreSchema = createInsertSchema(scoresTable).omit({ id: true, updatedAt: true });
export type InsertScore = z.infer<typeof insertScoreSchema>;
export type Score = typeof scoresTable.$inferSelect;
