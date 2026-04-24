import { pgTable, serial, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { roundsTable } from "./rounds";
import { playersTable } from "./players";

export const roundGroupAssignmentsTable = pgTable("round_group_assignments", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => playersTable.id, { onDelete: "cascade" }),
  groupNumber: integer("group_number").notNull(),
  slotIndex: integer("slot_index").notNull(),
}, (t) => ({
  roundPlayerUnique: uniqueIndex("round_player_unique").on(t.roundId, t.playerId),
  roundGroupSlotUnique: uniqueIndex("round_group_slot_unique").on(t.roundId, t.groupNumber, t.slotIndex),
}));

export type RoundGroupAssignment = typeof roundGroupAssignmentsTable.$inferSelect;
