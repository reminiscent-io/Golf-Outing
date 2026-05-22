import { pgTable, text, serial, real, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  fullName: text("full_name").notNull(),
  handicap: real("handicap"),
  discoverableByPhone: boolean("discoverable_by_phone").notNull().default(false),
  profileVisibility: text("profile_visibility", { enum: ["public", "private"] }).notNull().default("public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => [
  // Trigram index for fuzzy name search. The pg_trgm extension is enabled in Task 7.
  // gin_trgm_ops is required: text has no default operator class for GIN.
  index("users_full_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
