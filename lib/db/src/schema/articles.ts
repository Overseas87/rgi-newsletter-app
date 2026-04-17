import { pgTable, text, serial, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  url: text("url").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  author: text("author"),
  authorType: text("author_type"),
  platform: text("platform", { enum: ["news", "twitter", "linkedin"] }).default("news"),
  isEmergingSignal: boolean("is_emerging_signal").notNull().default(false),
  isPrimarySignal: boolean("is_primary_signal").notNull().default(false),
  relevancyScore: real("relevancy_score").notNull().default(0),
  topicTags: text("topic_tags").array().notNull().default([]),
  teaserSummary: text("teaser_summary"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
  content: text("content"),
  status: text("status", { enum: ["pending", "selected", "dismissed"] }).notNull().default("pending"),
  disciplineAlignment: text("discipline_alignment"),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({ id: true, scrapedAt: true });
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
