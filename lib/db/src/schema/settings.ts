import { pgTable, text, serial, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  relevancyThreshold: real("relevancy_threshold").notNull().default(7.0),
  scrapeIntervalHours: integer("scrape_interval_hours").notNull().default(24),
  scrapeTimeUtc: text("scrape_time_utc").notNull().default("11:00"),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
