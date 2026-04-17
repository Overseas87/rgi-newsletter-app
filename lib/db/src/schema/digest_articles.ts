import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const digestArticlesTable = pgTable("digest_articles", {
  id: serial("id").primaryKey(),
  articleType: text("article_type", { enum: ["daily_brief", "topic_article"] }).notNull().default("topic_article"),
  headline: text("headline").notNull(),
  body: text("body").notNull(),
  executiveSummary: text("executive_summary").array().notNull().default([]),
  rgiTake: text("rgi_take").notNull(),
  keyTakeaways: text("key_takeaways").array().notNull().default([]),
  topicTags: text("topic_tags").array().notNull().default([]),
  sourceArticleIds: integer("source_article_ids").array().notNull().default([]),
  relevancyScore: real("relevancy_score"),
  status: text("status", { enum: ["draft", "pending_review", "approved", "rejected", "regenerating"] }).notNull().default("pending_review"),
  editorNotes: text("editor_notes"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  discipline: text("discipline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDigestArticleSchema = createInsertSchema(digestArticlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDigestArticle = z.infer<typeof insertDigestArticleSchema>;
export type DigestArticle = typeof digestArticlesTable.$inferSelect;
