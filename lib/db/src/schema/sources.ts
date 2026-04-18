import { pgTable, text, serial, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const SOURCE_TYPES = ["rss", "website", "twitter", "linkedin", "institutional", "corporate", "market"] as const;

export const sourcesTable = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type", { enum: SOURCE_TYPES }).notNull().default("rss"),
  tier: integer("tier").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  authorName: text("author_name"),
  authorType: text("author_type"),
  authorityLevel: integer("authority_level").default(3),
  description: text("description"),
  // Editorial weight (0.5–2.0): scales how much this source's authority influences article scoring.
  // 1.0 = standard, 2.0 = double authority contribution, 0.5 = halved.
  weight: real("weight").notNull().default(1.0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSourceSchema = createInsertSchema(sourcesTable).omit({ id: true, createdAt: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sourcesTable.$inferSelect;
