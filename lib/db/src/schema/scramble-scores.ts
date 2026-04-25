import { pgTable, serial, integer, jsonb, timestamp, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roundsTable } from "./rounds";

// One row per scramble team:
//   - 4-man: one row per group, teamSide = "G" (whole group)
//   - 2-man: two rows per group, teamSide = "A" (slots 1-2) or "B" (slots 3-4)
export const scrambleScoresTable = pgTable("scramble_scores", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  groupNumber: integer("group_number").notNull(),
  teamSide: text("team_side", { enum: ["A", "B", "G"] }).notNull(),
  holeScores: jsonb("hole_scores").notNull().$type<(number | null)[]>().default(Array(18).fill(null)),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  scrambleRoundGroupTeamUnique: uniqueIndex("scramble_round_group_team_unique").on(t.roundId, t.groupNumber, t.teamSide),
}));

export const insertScrambleScoreSchema = createInsertSchema(scrambleScoresTable).omit({ id: true, updatedAt: true });
export type InsertScrambleScore = z.infer<typeof insertScrambleScoreSchema>;
export type ScrambleScore = typeof scrambleScoresTable.$inferSelect;
