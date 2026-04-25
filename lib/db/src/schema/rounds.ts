import { pgTable, text, serial, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tripsTable } from "./trips";

export const roundsTable = pgTable("rounds", {
  id: serial("id").primaryKey(),
  tripId: integer("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  course: text("course"),
  date: text("date"),
  par: jsonb("par").notNull().$type<number[]>().default([4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4]),
  holeHcp: jsonb("hole_hcp").notNull().$type<number[]>().default([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]),
  gamesConfig: jsonb("games_config").notNull().$type<GamesConfig>().default({
    stableford: true,
    skins: true,
    nassau: true,
    netStroke: true,
    bestBall: false,
    bestBallTeams: [],
    matchPlay: false,
    matchPlayMatches: [],
    scramble: false,
    scrambleType: null,
  }),
  handicapMode: text("handicap_mode", { enum: ["net", "gross"] }).notNull().default("net"),
  teeBox: text("tee_box"),
  courseRating: real("course_rating"),
  courseSlope: integer("course_slope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ScrambleType = "fourMan" | "twoMan";

export type GamesConfig = {
  stableford: boolean;
  skins: boolean;
  nassau: boolean;
  netStroke: boolean;
  bestBall: boolean;
  bestBallTeams?: Array<{ id: string; name: string; playerIds: number[] }>;
  matchPlay: boolean;
  matchPlayMatches?: Array<{ id: string; playerA: number; playerB: number }>;
  scramble?: boolean;
  scrambleType?: ScrambleType | null;
};

export const insertRoundSchema = createInsertSchema(roundsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRound = z.infer<typeof insertRoundSchema>;
export type Round = typeof roundsTable.$inferSelect;
